const axios = require('axios');
const { BASE_URL, getAuthHeader, TEAM } = require('./azurefunctions');


const FIELDS = [
    "System.Id",
    "System.Title",
    "System.State",
    "System.WorkItemType",
    "System.AssignedTo",
    "System.AreaPath",
    "System.Tags",
    "System.CreatedDate",
    "Microsoft.VSTS.Scheduling.OriginalEstimate",
    "Microsoft.VSTS.Scheduling.CompletedWork",
    "Microsoft.VSTS.Scheduling.Effort",
    "Microsoft.VSTS.Common.Priority",
    "Microsoft.VSTS.Common.Activity",
    "Microsoft.VSTS.Common.ResolvedDate",
    "Microsoft.VSTS.Common.ClosedDate",
    "Microsoft.VSTS.Common.ActivatedDate"
];
const MAX_BATCH = 200;

// Simple chunker
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Minimal retry wrapper for transient errors (429/503)
async function requestWithRetry(fn, { retries = 3, baseDelayMs = 500 } = {}) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      const status = err?.response?.status;
      if (attempt >= retries || !(status === 429 || status === 503)) throw err;
      const delay = baseDelayMs * Math.pow(2, attempt);
      await new Promise(r => setTimeout(r, delay));
      attempt++;
    }
  }
}

async function fetchWorkItemsByIds(ids, opts = {}) {
  if (!ids || !ids.length) return [];

  const {
    chunkSize = MAX_BATCH,
    concurrency = 4,                 // keep it polite
    errorPolicy = 'Omit',            // ignore missing/denied items
    expand = undefined               // e.g., 'Relations','Fields','Links','All'
  } = opts;

  const url = `${BASE_URL.replace(`/${TEAM}/_apis`, '')}/_apis/wit/workitemsbatch?api-version=7.0`;
  const batches = chunk(ids, Math.min(chunkSize, MAX_BATCH));

  // Run with limited concurrency (no extra deps)
  const results = [];
  let idx = 0;

  async function worker() {
    while (idx < batches.length) {
      const myIndex = idx++;
      const batchIds = batches[myIndex];

      const res = await requestWithRetry(() =>
        axios.post(
          url,
          { ids: batchIds, fields: FIELDS, errorPolicy, ...(expand ? { $expand: expand } : {}) },
          getAuthHeader()
        )
      );

      // Collect
      results.push(...(res.data?.value || []));
    }
  }

  // spawn workers
  const workers = Array.from({ length: Math.min(concurrency, batches.length) }, worker);
  await Promise.all(workers);

  // Reorder to match the original ids (API may return out of order)
  const byId = new Map(results.map(wi => [wi.id, wi]));
  return ids.map(id => byId.get(id)).filter(Boolean);
}
async function fetchParentRelations(ids) {
    const promises = ids.map(id =>
        axios.get(`${BASE_URL.replace(`/${TEAM}/_apis`, '')}/_apis/wit/workitems/${id}?api-version=7.0&$expand=relations`, getAuthHeader())
            .then(res => res.data)
    );

    return Promise.all(promises);
}

async function fetchWorkItemsWithParents(ids) {
    const basicItems = await fetchWorkItemsByIds(ids);
    const detailedItems = await fetchParentRelations(ids);

    for (const item of basicItems) {
        const detailed = detailedItems.find(d => d.id === item.id);
        const parentRel = detailed?.relations?.find(r => r.rel === 'System.LinkTypes.Hierarchy-Reverse');
        if (parentRel) {
            item.parentID = parseInt(parentRel.url.split('/').pop());
        }
    }

    return basicItems;
}

function attachEffortMetrics(item) {
    const estimate = item.fields["Microsoft.VSTS.Scheduling.OriginalEstimate"] || 0;
    const actual = item.fields["Microsoft.VSTS.Scheduling.CompletedWork"] || 0;
    const effort = item.fields["Microsoft.VSTS.Scheduling.Effort"] || 0;
    const priority = item.fields["Microsoft.VSTS.Common.Priority"] || 3;
    const created = new Date(item.fields["System.CreatedDate"]);
    const resolved = item.fields["Microsoft.VSTS.Common.ResolvedDate"]
        ? new Date(item.fields["Microsoft.VSTS.Common.ResolvedDate"])
        : null;
    const activated = item.fields["Microsoft.VSTS.Common.ActivatedDate"]
        ? new Date(item.fields["Microsoft.VSTS.Common.ActivatedDate"])
        : null;
    const now = new Date();

    const ageDays = (now - created) / (1000 * 60 * 60 * 24);
    const cycleTimeDays = resolved && activated
        ? (resolved - activated) / (1000 * 60 * 60 * 24)
        : null;

    const overrunPct = (estimate > 0 && actual > 0)
        ? (actual / estimate) * 100
        : null;


    item._metrics = {
        estimatedHours: estimate,
        actualHours: actual,
        effortPoints: effort,
        priority,
        ageDays,
        cycleTimeDays,
        overrunPct,
        utilizationPct: (estimate > 0 && actual > 0) ? (actual / estimate) * 100 : null,
        isOverrun: (estimate > 0 && actual > estimate) ? true : false,
    };

    return item;
}

module.exports = {
    fetchWorkItemsByIds,
    fetchParentRelations,
    fetchWorkItemsWithParents,
    attachEffortMetrics // 👈 this was missing
};