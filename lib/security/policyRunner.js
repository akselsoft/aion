async function evaluatePolicies(policies = [], ctx = {}) {
  const results = [];
  for (const p of policies) {
    try {
      const out = await Promise.resolve(p.verify(ctx));
      results.push({ name: p.name || 'unnamed', ...out });
      if (!out.ok) {
        return { ok: false, results };
      }
    } catch (e) {
      results.push({ name: p.name || 'unnamed', ok: false, reason: e.message });
      return { ok: false, results };
    }
  }
  return { ok: true, results };
}

module.exports = { evaluatePolicies };

