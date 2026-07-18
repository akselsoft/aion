// Built-in policy helpers. Return objects with a verify(ctx) => { ok, reason } API.

function sigVerifier() {
  // Placeholder: assume signature not enforced here; do verification in fetch step if needed.
  return {
    name: 'sigVerifier',
    verify() {
      return { ok: true, reason: 'signature check not implemented' };
    }
  };
}

function personaMatch() {
  return {
    name: 'personaMatch',
    verify(ctx) {
      const want = ctx.config.persona || ctx.config.implementation; // legacy fallback
      const got = ctx.licenseJson?.persona;
      const ok = !want || !got || String(want) === String(got);
      return { ok, reason: ok ? 'persona matches' : `persona mismatch: want ${want}, got ${got}` };
    }
  };
}

function timeWindowWithGrace() {
  return {
    name: 'timeWindowWithGrace',
    verify(ctx) {
      const now = new Date();
      const nbf = ctx.licenseJson?.nbf ? new Date(ctx.licenseJson.nbf) : null;
      const exp = ctx.licenseJson?.exp ? new Date(ctx.licenseJson.exp) : null;
      const grace = Number(ctx.licenseJson?.grace_days || 0);
      const expWithGrace = exp ? new Date(exp.getTime() + grace * 24 * 60 * 60 * 1000) : null;

      if (nbf && now < nbf) return { ok: false, reason: 'license not yet valid' };
      if (expWithGrace && now > expWithGrace) return { ok: false, reason: 'license expired (grace exceeded)' };
      return { ok: true, reason: 'within validity window' };
    }
  };
}

function hostClaimsOrMatch() {
  return {
    name: 'hostClaimsOrMatch',
    verify(ctx) {
      const ent = (ctx.licenseJson?.entitlements && ctx.licenseJson.entitlements[0]) || {};
      const fps = Array.isArray(ent.allowed_fingerprints) ? ent.allowed_fingerprints : [];
      const hns = Array.isArray(ent.allowed_hostnames) ? ent.allowed_hostnames : [];
      const fpOk = fps.length === 0 || fps.includes(ctx.hostFacts.fingerprint);
      const hnOk = hns.length === 0 || hns.includes(ctx.hostFacts.hostname);
      const ok = fpOk || hnOk; // OR semantics by default
      return { ok, reason: ok ? 'host matched' : 'host mismatch' };
    }
  };
}

module.exports = { sigVerifier, personaMatch, timeWindowWithGrace, hostClaimsOrMatch };

