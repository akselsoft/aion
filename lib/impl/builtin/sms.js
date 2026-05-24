// sms.js
// Responder engine that sends SMS/text messages.
// Supports Twilio (most common) and Vonage/Nexmo.
const fs = require('fs');
const path = require('path');
const { resolveConfigPath } = require('../../utils/paths');

module.exports = {
  async run(ctx, engineCfg, personaCfg) {
    const projectRoot = personaCfg.__projectRoot || process.cwd();
    const provider = engineCfg.provider || 'twilio'; // 'twilio' or 'vonage'
    
    // Get SMS configuration
    const recipientPhone = resolveRecipient(engineCfg);
    const fromPhone = engineCfg.from || process.env.SMS_FROM;
    
    if (!recipientPhone) {
      console.error('❌ SMS responder: no recipient specified. Set "phoneNumber" or "to" in engine config, or SMS_TO in .env');
      return;
    }

    // Extract message content
    const message = extractMessage(ctx.passedFiles, engineCfg);
    
    if (!message) {
      console.warn('⚠️ SMS responder: no content to send');
      return;
    }

    // Enforce SMS character limit (160 for standard, 1600 for concatenated)
    const maxLength = engineCfg.maxLength || 160;
    const truncatedMessage = message.substring(0, maxLength);
    if (message.length > maxLength) {
      console.warn(`⚠️ Message truncated from ${message.length} to ${maxLength} characters`);
    }

    const sendLimit = resolveMaxDailySends(engineCfg);
    const statePath = resolveSendStatePath(projectRoot, engineCfg);
    const limitKey = sendLimitKey(provider, recipientPhone, engineCfg);
    if (engineCfg.dryRun !== true && sendLimit !== null) {
      const status = getDailySendStatus(statePath, limitKey);
      if (status.count >= sendLimit) {
        console.log(`📵 SMS responder: daily send limit reached for ${recipientPhone} (${status.count}/${sendLimit}). Not calling ${provider}.`);
        return {
          provider,
          to: recipientPhone,
          from: fromPhone || null,
          body: truncatedMessage,
          skipped: true,
          reason: 'daily-send-limit',
          date: status.date,
          count: status.count,
          maxDailySends: sendLimit
        };
      }
    }

    if (engineCfg.dryRun === true) {
      console.log(`📱 SMS dry run (${provider}) to ${recipientPhone}: ${truncatedMessage}`);
      return {
        provider,
        to: recipientPhone,
        from: fromPhone || null,
        body: truncatedMessage,
        dryRun: true
      };
    }

    try {
      let result;
      if (provider === 'vonage') {
        result = await sendViaVonage(recipientPhone, fromPhone, truncatedMessage, engineCfg);
      } else {
        result = await sendViaTwilio(recipientPhone, fromPhone, truncatedMessage, engineCfg);
      }
      if (sendLimit !== null) {
        const status = recordDailySend(statePath, limitKey);
        console.log(`📊 SMS responder: daily send count for ${recipientPhone} is now ${status.count}/${sendLimit}.`);
      }
      return result;
    } catch (err) {
      console.error(`❌ SMS responder failed: ${err.message}`);
    }
  }
};

function resolveRecipient(engineCfg) {
  return engineCfg.phoneNumber
    || engineCfg.to
    || engineCfg.recipientPhone
    || engineCfg.recipient
    || process.env.SMS_TO;
}

function resolveMaxDailySends(engineCfg) {
  const value = engineCfg.maxDailySends ?? engineCfg.maxDailySend ?? engineCfg.dailySendLimit;
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
}

function resolveSendStatePath(projectRoot, engineCfg) {
  const configured = engineCfg.sendStateFile || engineCfg.sendLimitStateFile || engineCfg.dailySendStateFile;
  if (!configured) return path.join(projectRoot, 'outputs', 'sms-send-state.json');
  if (path.isAbsolute(configured) || String(configured).startsWith('~')) {
    return resolveConfigPath(projectRoot, configured);
  }
  return path.join(projectRoot, 'outputs', configured);
}

function sendLimitKey(provider, recipientPhone, engineCfg) {
  return [
    provider || 'twilio',
    normalizePhoneForKey(recipientPhone),
    engineCfg.inputType || engineCfg.name || 'all'
  ].join('|');
}

function normalizePhoneForKey(value) {
  return String(value || '').replace(/[^\d+]/g, '');
}

function getDailySendStatus(statePath, key, now = new Date()) {
  const state = readSendState(statePath);
  const date = localDateStamp(now);
  const entry = state[key];
  if (!entry || entry.date !== date) return { date, count: 0 };
  return { date, count: Number(entry.count) || 0 };
}

function recordDailySend(statePath, key, now = new Date()) {
  const state = readSendState(statePath);
  const date = localDateStamp(now);
  const current = state[key]?.date === date ? Number(state[key].count) || 0 : 0;
  state[key] = {
    date,
    count: current + 1,
    updatedAt: now.toISOString()
  };
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return { date, count: state[key].count };
}

function readSendState(statePath) {
  try {
    if (!fs.existsSync(statePath)) return {};
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function localDateStamp(date) {
  const d = date instanceof Date ? date : new Date(date);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function sendViaTwilio(to, from, message, engineCfg) {
  let twilio;
  try {
    twilio = require('twilio');
  } catch {
    throw new Error('twilio not installed. Run: npm install twilio');
  }

  const accountSid = engineCfg.accountSid || process.env.TWILIO_ACCOUNT_SID;
  const authToken = engineCfg.authToken || process.env.TWILIO_AUTH_TOKEN;
  const fromPhone = from || process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !fromPhone) {
    throw new Error('Twilio config incomplete. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER in .env');
  }

  const client = twilio(accountSid, authToken);
  
  const result = await client.messages.create({
    body: message,
    from: fromPhone,
    to: to,
  });

  console.log(`✅ SMS sent via Twilio to ${to}. SID: ${result.sid}`);
  return result;
}

async function sendViaVonage(to, from, message, engineCfg) {
  let { Vonage } = (() => {
    try {
      return require('@vonage/server-sdk');
    } catch {
      throw new Error('@vonage/server-sdk not installed. Run: npm install @vonage/server-sdk');
    }
  })();

  const apiKey = engineCfg.apiKey || process.env.VONAGE_API_KEY;
  const apiSecret = engineCfg.apiSecret || process.env.VONAGE_API_SECRET;
  const fromPhone = from || process.env.VONAGE_BRAND_NAME || 'AION';

  if (!apiKey || !apiSecret) {
    throw new Error('Vonage config incomplete. Set VONAGE_API_KEY, VONAGE_API_SECRET in .env');
  }

  const vonage = new Vonage({
    apiKey,
    apiSecret,
  });

  const result = await vonage.sms.send({
    to: to.replace(/^\+?/, '+'), // Ensure + prefix
    from: fromPhone,
    text: message,
  });

  if (result.messages[0]['status'] === '0') {
    console.log(`✅ SMS sent via Vonage to ${to}. Message ID: ${result.messages[0]['message-id']}`);
    return result;
  } else {
    throw new Error(`Vonage API error: ${result.messages[0]['error-text']}`);
  }
}

function extractMessage(passedFiles, engineCfg) {
  if (!Array.isArray(passedFiles) || passedFiles.length === 0) {
    return null;
  }

  const inputType = engineCfg.inputType; // Optional filter against passedFiles.type
  const template = engineCfg.template; // Optional message template

  // If template provided, use it
  if (template) {
    return String(template).trim();
  }

  // Otherwise extract from passedFiles
  const files = inputType
    ? passedFiles.filter(f => f.type === inputType)
    : passedFiles;

  if (files.length === 0) {
    if (inputType) {
      console.warn(`⚠️ SMS responder: no passedFiles with type="${inputType}"`);
    }
    return null;
  }

  const content = files
    .flatMap(file => extractItemContent(file))
    .map(stripMessageFormatting)
    .filter(Boolean)
    .join('\n\n');

  return content || null;
}

function extractItemContent(item) {
  const parts = [];

  if (typeof item.content === 'string') parts.push(item.content);
  if (typeof item.text === 'string') parts.push(item.text);

  for (const doc of item.documents || []) {
    if (typeof doc.content === 'string') parts.push(doc.content);
    else if (typeof doc.text === 'string') parts.push(doc.text);
  }

  return parts;
}

function stripMessageFormatting(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, '')        // Remove HTML
    .replace(/[#*_`\[\]\(\)]/g, '') // Remove common markdown markers
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports._private = {
  extractMessage,
  resolveRecipient,
  stripMessageFormatting,
  resolveMaxDailySends,
  resolveSendStatePath,
  sendLimitKey,
  getDailySendStatus,
  recordDailySend
};
