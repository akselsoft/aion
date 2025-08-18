// implementations/deacon/sourceAdapters/devops.pullrequests.js

const path = require('path');
const fs = require('fs');
const { getAllIterations, getCurrentIteration, getPullRequestsForIteration } = require('../libs/azureIteration');
const { logInfo } = require('../../../core/utils/logger');

function analyzePullRequests(prs = []) {
    if (!prs.length) return { summary: 'No pull requests found.', stats: {} };

    const durations = prs.map(pr => {
        const created = new Date(pr.creationDate);
        const closed = pr.closedDate ? new Date(pr.closedDate) : new Date();
        return {
            id: pr.pullRequestId,
            title: pr.title,
            duration: (closed - created) / (1000 * 60 * 60 * 24), // in days
            createdBy: pr.createdBy?.displayName || 'Unknown',
            tags: pr.labels?.map(l => l.name) || []
        };
    });

    const avgDaysOpen =
        durations.reduce((sum, d) => sum + d.duration, 0) / durations.length;

    const sorted = [...durations].sort((a, b) => a.duration - b.duration);
    const shortest = sorted[0];
    const longest = sorted[sorted.length - 1];

    const contributors = {};
    for (const d of durations) {
        contributors[d.createdBy] = (contributors[d.createdBy] || 0) + 1;
    }
    const topContributors = Object.entries(contributors)
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => `- ${name}: ${count} PRs`);

    // tag counts (case-insensitive normalize)
    const tagCounts = {};
    for (const d of durations) {
        if (d.tags.length === 0) {
            tagCounts['(untagged)'] = (tagCounts['(untagged)'] || 0) + 1;
        } else {
            for (const t of d.tags) {
                const key = t.toLowerCase();
                tagCounts[key] = (tagCounts[key] || 0) + 1;
            }
        }
    }

    const tagLines = Object.entries(tagCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([tag, count]) => `- ${tag}: ${count}`);

    const allTags = Object.keys(tagCounts).filter(t => t !== '(untagged)');

    const summary = `During this iteration:
- ${prs.length} pull requests were found.
- Average time to close: **${avgDaysOpen.toFixed(1)} days**.
- Shortest open PR: **"${shortest.title}"** (#${shortest.id}) – ${shortest.duration.toFixed(1)} days.
- Longest open PR: **"${longest.title}"** (#${longest.id}) – ${longest.duration.toFixed(1)} days.
- Top contributors:
${topContributors.join('\n')}
- Tags used: ${allTags.length ? allTags.join(', ') : 'None'}

**By tag**
${tagLines.length ? tagLines.join('\n') : '(no tags)'}
`;

    return {
        summary,
        stats: {
            count: prs.length,
            avgDaysOpen,
            shortest,
            longest,
            topContributors,
            tagCounts,               // <- new
            tags: allTags
        }
    };
}

module.exports = async function loadPullRequests(projectRoot, sourceConfig, fullConfig) {
    let iteration;
    if (sourceConfig.iteration) {
        const all = await getAllIterations();
        iteration = all.find(i => i.name === sourceConfig.iteration || i.path.endsWith(`\\${sourceConfig.iteration}`));
        if (!iteration) throw new Error(`Iteration "${sourceConfig.iteration}" not found.`);
        logInfo(`📦 Using custom iteration: ${iteration.name} (${iteration.path})`);
    } else {
        iteration = await getCurrentIteration();
        logInfo(`📦 Using current iteration: ${iteration.name} (${iteration.path})`);
    }

    const pullRequests = await getPullRequestsForIteration(iteration);


    const outDir = path.join(projectRoot, 'shared', 'artifacts', sourceConfig.name || 'pullrequests');
    fs.mkdirSync(outDir, { recursive: true });

    const rawPath = path.join(outDir, 'pullrequests.json');
    fs.writeFileSync(rawPath, JSON.stringify(pullRequests, null, 2), 'utf-8');
    logInfo(`📁 Saved ${pullRequests.length} PRs to ${path.relative(projectRoot, rawPath)}`);

    const analysis = analyzePullRequests(pullRequests);

    const doc = {
        filename: 'pullrequests-summary.md',
        content: `### Pull Requests\n\n${analysis.summary}`
    };

    return {
        name: sourceConfig.name || 'devops pullrequests',
        type: sourceConfig.type,
        prompt: `Summarize pull request activity during the current iteration.`,
        documents: [doc]
    };
};