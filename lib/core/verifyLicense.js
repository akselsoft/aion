const fs = require('fs');
const path = require('path');
const { fetchAndVerifySignedLicense } = require('../security/licenseFetch');
const { buildNotAuthorizedConfig } = require('../security/notAuthorized');
const { getHostFacts } = require('../security/hostFacts');
const { evaluatePolicies } = require('../security/policyRunner');
const builtins = require('../security/builtins');

async function verifyLicense(config) {
  if (!config || config.free === true) return config;

  // Accept inline license JSON too
  let licenseJson = config.license || config.licenseJson || null;

  // Try to load from local file path if provided
  if (!licenseJson && config.licenseURL) {
    const url = String(config.licenseURL);
    const looksLocal = url.startsWith('.') || url.startsWith('/') || (!/^https?:/i.test(url) && fs.existsSync(url));
    if (looksLocal) {
      const abs = path.isAbsolute(url) ? url : path.resolve(config.__projectRoot || process.cwd(), url);
      try {
        licenseJson = JSON.parse(fs.readFileSync(abs, 'utf-8'));
      } catch (e) {
        // ignore; fall back to remote fetch stub
      }
    }
  }

  // If still nothing, fall back to remote fetch stub (will return not ok by default)
  if (!licenseJson && config.licenseURL) {
    try {
      const { ok, mergedOverrides, meta, license } = await fetchAndVerifySignedLicense(config);
      if (ok) {
        return { ...config, ...mergedOverrides, __license: { state: 'valid', ...meta } };
      }
      licenseJson = license || null; // carry for diagnostics if present
    } catch {
      // continue
    }
  }

  if (!licenseJson) {
    // No license to validate
    return buildNotAuthorizedConfig(config, {
      reason: 'License not found',
      code: 'LICENSE_MISSING'
    });
  }

  // Compose policy set: vendor module or built-ins
  let policies = [
    builtins.sigVerifier(),
    builtins.personaMatch(),
    builtins.timeWindowWithGrace(),
    builtins.hostClaimsOrMatch()
  ];

  if (config.licensePolicy) {
    try {
      const root = config.__projectRoot || process.cwd();
      const cand = path.isAbsolute(config.licensePolicy)
        ? config.licensePolicy
        : path.resolve(root, config.licensePolicy);
      const vendor = require(cand);
      if (Array.isArray(vendor) && vendor.length) policies = vendor;
    } catch (e) {
      // use built-ins
    }
  }

  const ctx = { config, licenseJson, hostFacts: getHostFacts() };
  const verdict = await evaluatePolicies(policies, ctx);
  if (!verdict.ok) {
    return buildNotAuthorizedConfig(config, {
      reason: verdict.results.find(r => !r.ok)?.reason || 'policy denied',
      code: 'LICENSE_DENIED'
    });
  }

  // Merge overrides if present
  const overrides = licenseJson.overrides || {};
  const meta = {
    persona: licenseJson.persona,
    rev: licenseJson.rev,
    exp: licenseJson.exp,
    nbf: licenseJson.nbf
  };
  return { ...config, ...overrides, __license: { state: 'valid', ...meta } };
}

module.exports = { verifyLicense };
