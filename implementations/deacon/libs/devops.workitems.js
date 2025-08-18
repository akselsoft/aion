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

async function fetchWorkItemsByIds(ids) {
    if (!ids.length) return [];

    const url = `${BASE_URL.replace(`/${TEAM}/_apis`, '')}/_apis/wit/workitemsbatch?api-version=7.0`;
    const res = await axios.post(url, {
        ids,
        fields: FIELDS
    }, getAuthHeader());

    return res.data.value;
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