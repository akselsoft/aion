const fs = require('fs');
const path = require('path');

// Basic defaults; can be overridden by config.keywordExtraction
const DEFAULTS = {
  minCountThreshold: 2,
  stopwords: [
    'the','and','for','with','this','that','from','into','also','was','are','but','not','have','has','had','all','any','can','will','just','being','been','then','now','you','your','to','of','in','on','at','by','it','as','or','is','be','we','our','a','an'
  ],
  // Conversational fillers and contractions fragments
  filler: [
    'like','yeah','right','ok','okay','yep','nope','uh','um','kinda','sorta','gonna','wanna','gotta','guy','guys',
    'don','cant','doesn','isn','shouldn','wouldn','couldn','ain','ll','re','ve','im','id','ya','tho','tho','hmm','huh'
  ],
  // Generic persona/domain phrases frequently seen across projects; extend/override via config.keywordExtraction
  keywordPhrases: [
    'product manager','project manager','engineering manager','customer support','customer success',
    'system administrator','site reliability','data analyst','data scientist','sales engineer',
    'end user','power user','beta tester','quality assurance','qa engineer','ux researcher',
    'service desk','help desk','operations team','security team','marketing manager',
    'account manager','solutions architect','program manager','release manager','product owner',
    'stakeholder','persona','admin portal','applicant portal'
  ],
  maxKeywords: 200
};

function normalizeStr(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[_`~!@#$%^&*()+=\[\]{}|;:'",<>/?\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractKeywordsWithPhrases(text, cfg) {
  const stopwords = new Set((cfg.stopwords || DEFAULTS.stopwords).map(w => w.toLowerCase()));
  const phrases = (cfg.keywordPhrases || DEFAULTS.keywordPhrases)
    .map(p => normalizeStr(p))
    .filter(Boolean);

  const normalized = normalizeStr(text);
  const matchedPhrases = [];

  let working = normalized;
  for (const phrase of phrases) {
    if (!phrase) continue;
    if (working.includes(phrase)) {
      matchedPhrases.push(phrase);
      // Replace phrase with space to avoid double counting into solo words
      const esc = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      working = working.replace(new RegExp(esc, 'g'), ' ');
    }
  }

  const allowNumeric = cfg.allowNumeric === true;
  const isNumeric = (w) => /^\d+(?:[.,]\d+)?$/.test(w);
  const soloWords = working
    .split(' ')
    .filter(w => w && w.length > 2 && !stopwords.has(w) && /[a-z0-9]/.test(w))
    .filter(w => allowNumeric ? true : !isNumeric(w));

  return [...matchedPhrases, ...soloWords];
}

function tallyKeywords(sections, cfg) {
  const counts = Object.create(null);
  const perSection = Object.create(null);

  for (const section of sections || []) {
    const secName = section.name || section.type || 'unknown';
    const docs = Array.isArray(section.documents) ? section.documents : [];

    const contents = [];

    if (section.content) contents.push(section.content);
    for (const d of docs) {
      if (d && d.content) contents.push(d.content);
      if (d && d.filename) contents.push(String(d.filename)); // light title signal
    }

    const text = contents.join('\n\n');
    if (!text) continue;

    const tokens = extractKeywordsWithPhrases(text, cfg);
    if (!tokens.length) continue;

    if (!perSection[secName]) perSection[secName] = Object.create(null);

    for (const t of tokens) {
      counts[t] = (counts[t] || 0) + 1;
      perSection[secName][t] = (perSection[secName][t] || 0) + 1;
    }
  }

  const min = cfg.minCountThreshold ?? DEFAULTS.minCountThreshold;
  const maxKeywords = cfg.maxKeywords ?? DEFAULTS.maxKeywords;

  const total = Object.entries(counts)
    .filter(([, c]) => c >= min)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxKeywords)
    .map(([word, count]) => ({ word, count }));

  // Trim per-section maps to same top-N set to keep size reasonable
  const topSet = new Set(total.map(x => x.word));
  const perSectionTrimmed = Object.fromEntries(
    Object.entries(perSection).map(([sec, map]) => [
      sec,
      Object.fromEntries(
        Object.entries(map)
          .filter(([w]) => topSet.has(w))
          .sort((a, b) => b[1] - a[1])
      )
    ])
  );

  return { total, perSection: perSectionTrimmed };
}

function renderMarkdown(total, perSection) {
  const lines = [];
  lines.push('### 🔥 Keyword Heatmap (Global)');
  lines.push('');
  lines.push('| Keyword | Count | Bar |');
  lines.push('|---|---:|---|');

  const max = total.length ? total[0].count : 0;
  const bar = (c) => {
    if (!max) return '';
    const n = Math.max(1, Math.round((c / max) * 20));
    return '▮'.repeat(n);
  };

  for (const { word, count } of total) {
    lines.push(`| ${word} | ${count} | ${bar(count)} |`);
  }

  if (Object.keys(perSection).length) {
    lines.push('\n### 📚 Top Keywords by Section');
    for (const [sec, map] of Object.entries(perSection)) {
      lines.push(`\n**${sec}**`);
      lines.push('| Keyword | Count |');
      lines.push('|---|---:|');
      for (const [w, c] of Object.entries(map)) {
        lines.push(`| ${w} | ${c} |`);
      }
    }
  }

  return lines.join('\n') + '\n';
}

async function heatmapEngine(sections, config = {}, projectRoot = process.cwd()) {
  const userKE = config.keywordExtraction || {};
  const overwrite = userKE.overwrite === true;

  // Merge arrays depending on overwrite flag
  // Load stopwords from file if provided
  let fileStop = [];
  if (userKE.stopwordsFile) {
    try {
      const p = userKE.stopwordsFile;
      const abs = require('path').isAbsolute(p) ? p : require('path').join(projectRoot, p);
      const txt = fs.readFileSync(abs, 'utf8');
      fileStop = txt.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    } catch {}
  }

  const baseStops = [...(DEFAULTS.stopwords || []), ...(DEFAULTS.filler || [])];
  const mergedStopwords = overwrite
    ? (userKE.stopwords || []).concat(fileStop)
    : Array.from(new Set([...baseStops, ...((userKE.stopwords || []).map(String)), ...fileStop]));

  const mergedPhrases = overwrite
    ? (userKE.keywordPhrases || DEFAULTS.keywordPhrases)
    : Array.from(new Set([...(DEFAULTS.keywordPhrases || []), ...((userKE.keywordPhrases || []).map(p => String(p))) ]));

  // Scalars: user values override defaults regardless of overwrite
  const cfg = {
    ...DEFAULTS,
    ...userKE,
    stopwords: mergedStopwords,
    keywordPhrases: mergedPhrases
  };

  const { total, perSection } = tallyKeywords(sections, cfg);

  // Write outputs for inspection
  try {
    const outDir = path.join(projectRoot, 'outputs');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'keyword-heatmap.json'), JSON.stringify({ total, perSection }, null, 2), 'utf-8');
    fs.writeFileSync(path.join(outDir, 'keyword-heatmap.md'), renderMarkdown(total, perSection), 'utf-8');
  } catch (e) {
    console.warn(`[heatmap] Failed to write outputs: ${e.message}`);
  }

  const md = renderMarkdown(total, perSection);

  // Return as a new section to feed downstream engines
  return [{
    name: 'keyword-heatmap',
    type: 'analysis',
    prompt: config?.recommendations?.prompt || 'Use this heatmap to identify themes and priorities across the provided content.',
    documents: [
      { filename: 'keyword-heatmap.md', content: md },
      { filename: 'keyword-heatmap.json', content: JSON.stringify({ total, perSection }, null, 2) }
    ]
  }];
}

module.exports = heatmapEngine;
