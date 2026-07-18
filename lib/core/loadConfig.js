const fs = require('fs');
const path = require('path');

function readJson(p) {
  const raw = fs.readFileSync(p, 'utf-8');
  return JSON.parse(raw);
}

async function loadConfig(inputPath) {
  // input can be a directory (project root) or a JSON file
  let projectRoot = inputPath;
  let configPath = null;

  const stat = fs.existsSync(inputPath) ? fs.statSync(inputPath) : null;
  if (!stat) throw new Error(`Path not found: ${inputPath}`);

  if (stat.isDirectory()) {
    const personaJson = path.join(inputPath, 'persona.json');
    const legacyJson = path.join(inputPath, 'config.json');
    if (fs.existsSync(personaJson)) {
      configPath = personaJson;
    } else if (fs.existsSync(legacyJson)) {
      configPath = legacyJson;
    } else {
      throw new Error(`No persona.json or config.json found in ${inputPath}`);
    }
  } else {
    configPath = inputPath;
    projectRoot = path.dirname(inputPath);
  }

  // Convert to absolute path (fixes relative path resolution issues)
  projectRoot = path.resolve(projectRoot);

  const cfg = readJson(configPath);

  // Support aliases for params: accept pipeline or flow
  if (!cfg.params) {
    cfg.params = cfg.pipeline || cfg.flow || cfg.steps || null;
  }

  // Decide mode: persona when explicitly persona.json OR when a persona key is present without legacy markers
  const isPersonaFile = path.basename(configPath).toLowerCase() === 'persona.json';
  const likelyPersona = isPersonaFile || (!!cfg.persona && !cfg.implementation);

  // Normalize persona defaults only when in persona mode
  if (likelyPersona) {
    if (!cfg.persona) {
      cfg.persona = 'free';
      cfg.free = (cfg.free !== false);
      cfg.__inferred_persona = 'default_free';
    }
    cfg.__mode = 'persona';
  } else {
    cfg.__mode = 'legacy';
  }

  // Attach project root and config path for downstream use
  cfg.__projectRoot = projectRoot;
  cfg.__configPath = configPath;
  return cfg;
}

module.exports = { loadConfig };
