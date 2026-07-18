async function fetchAndVerifySignedLicense(config) {
  // Placeholder: integrate with your signer/validator later.
  // Returning not ok by default keeps behavior safe until wired.
  return { ok: false, mergedOverrides: {}, meta: { reason: 'no-verifier' } };
}

module.exports = { fetchAndVerifySignedLicense };

