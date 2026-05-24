const os = require('os');

function getHostFacts() {
  const hostname = os.hostname();
  // Fingerprint strategy can evolve; use env for now to avoid privileged ops.
  const fingerprint = process.env.AION_HOST_FINGERPRINT || 'unknown-fingerprint';
  return { hostname, fingerprint };
}

module.exports = { getHostFacts };

