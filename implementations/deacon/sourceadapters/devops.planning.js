const path = require('path');
const fs = require('fs');
const { runWIQL } = require('../libs/devops.query');
const { fetchWorkItemsWithParents } = require('../libs/devops.workitems');
const { isWorkItemCompleted } = require('../libs/azurefunctions');

const DEFAULT_SCORE_THRESHOLD = 30;
// --- keep existing imports and helpers ---

// Identify vague reason
// Drop-in replacement for your current vague check
function vagueReason(title = '', description = '') {
    const t = (title || '').trim();
    const d = (description || '').trim();

    // A) short titles are always vague
    if (!t || t.length < 20) return 'Title Too Short';

    // B) explicit TBD
    if (/\b(TBD|to be determined)\b/i.test(t) || /\b(TBD|to be determined)\b/i.test(d)) {
        return 'Contains TBD';
    }

    // C) stricter rule for vague verbs unless there's measurable detail
    const VAGUE_VERBS = ['improve', 'update', 'refactor', 'review', 'research', 'investigate', 'cleanup'];
    const hasVagueVerb = VAGUE_VERBS.some(v => new RegExp(`\\b${v}\\b`, 'i').test(t));

    // Measurable/target escape hatch
    const HAS_METRIC = /\b(\d+%|\d+\s?(ms|s|sec|seconds|minutes)|response\s*time|load\s*time|latency|throughput|qps|rps|error\s*rate|accuracy|precision|recall|memory|cpu|p\d{2}\s*latency|to\s*\d+\s?ms|under\s*\d+\s?ms|by\s*\d+%)\b/i.test(t);

    // If using a vague verb, require length >= 30 OR a metric
    if (hasVagueVerb && t.length < 30 && !HAS_METRIC) {
        return 'Vague verb without detail';
    }

    // D) fallback: other non‑specific wording in title/description
    const NONSPECIFIC = /\b(various|misc(ellaneous)?|improvement|analysis|look into|fix issue|bugfix)\b/i;
    if (NONSPECIFIC.test(t) || NONSPECIFIC.test(d)) {
        return 'Non-specific wording';
    }

    return null;
}
// Group vague items by reason, sort by area
function groupVagueItems(items) {
    const grouped = {};
    for (const i of items) {
        const reason = vagueReason(i.fields?.['System.Title'], i.fields?.['System.Description']);
        if (!reason) continue;
        if (!grouped[reason]) grouped[reason] = [];
        grouped[reason].push({
            id: i.id,
            title: i.fields?.['System.Title'],
            area: i.fields?.['System.AreaPath'],
            type: i.fields?.['System.WorkItemType'],
            priority: i.fields?.['Microsoft.VSTS.Common.Priority'] || 2
        });
    }
    for (const reason in grouped) {
        grouped[reason].sort((a, b) => (a.area || '').localeCompare(b.area || ''));
    }
    return grouped;
}

// NEW: extract "area segment" (2nd piece of Area Path) like Maestro, Portal, Internal
function areaSegment(areaPath = '') {
    const parts = String(areaPath).split('\\');
    // If path looks like MaestroPortalo\Portal, return "Portal"; otherwise fallback to last piece or the whole path
    return parts[1] || parts[parts.length - 1] || areaPath || 'Unknown';
}

// NEW: count priorities by area for a given item list
function countByAreaAndPriority(items) {
    const map = {};
    for (const i of items) {
        const seg = areaSegment(i.fields?.['System.AreaPath']);
        const p = i.fields?.['Microsoft.VSTS.Common.Priority'] || 2;
        if (!map[seg]) map[seg] = { 1: 0, 2: 0, 3: 0, 4: 0 };
        map[seg][p] = (map[seg][p] || 0) + 1;
    }
    return map;
}

// NEW: format area/priority counts as markdown bullets
function formatAreaBreakdown(areaCounts, title = 'By Area (priority counts)') {
    const lines = Object.entries(areaCounts)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([seg, counts]) => {
            const parts = [1, 2, 3, 4].map(p => `P${p}: ${counts[p] || 0}`).join(', ');
            return `- ${seg}: ${parts}`;
        });
    return [`### ${title}`, ...lines].join('\n');
}

// NEW: basic vagueness heuristic (explainable and cheap)
// We look at short titles, placeholders, and non-specific verbs.
const VAGUE_PATTERNS = [
    /\b(tbd|to be determined|various|misc(ellaneous)?|cleanup|review|update|refactor|improve|improvement|research|analysis|investigate|look into|fix issue|bugfix)\b/i,
    /^(improve|update|refactor|review|research|analysis|investigate)\b/i,
    /\?$/, // ends with a question
];

function findVagueReason(title = '', description = '') {
    const t = title.trim();
    const d = (description || '').trim();

    if (t.length < 15) return 'Title too short to be actionable';
    if (/\b(TBD|to be determined)\b/i.test(t) || /\b(TBD|to be determined)\b/i.test(d)) return 'Contains TBD / unspecified details';

    for (const pat of VAGUE_PATTERNS) {
        if (pat.test(t) || pat.test(d)) {
            return 'Non-specific wording (needs clearer outcome/criteria)';
        }
    }

    return null; // not vague
}

function scoreItem(item) {
    const fields = item.fields || {};
    const type = fields['System.WorkItemType'];
    const priority = fields['Microsoft.VSTS.Common.Priority'] || 2;
    const created = new Date(fields['System.CreatedDate']);
    const updated = new Date(fields['System.ChangedDate'] || created);
    const now = new Date();

    const ageDays = (now - created) / (1000 * 60 * 60 * 24);
    const lastUpdatedDays = (now - updated) / (1000 * 60 * 60 * 24);

    // Priority is weighted heavier — P1 = 60, P2 = 40, P3 = 20
    const prioScore = (4 - priority) * 20;

    // Recent changes are helpful but limited to 15 points
    const recentBoost = Math.max(0, 30 - lastUpdatedDays) * 0.5; // Max 15

    // Slight preference for newer items (max 10 points)
    const ageScore = Math.min(1, 90 / ageDays) * 10;

    // Effort modifier: lower effort = higher score
    let effort = 3; // Default if unknown
    if (type === 'Feature') {
        effort = fields['Microsoft.VSTS.Scheduling.Effort'] || 3;
    } else if (type === 'Bug') {
        effort = 2; // assumed effort for bugs
    }

    const effortBonus = {
        1: 3,
        2: 2,
        3: 1,
        4: 0,
        5: -2
    }[effort] || 0;

    const totalScore = prioScore + recentBoost + ageScore + effortBonus;

    return Math.round(totalScore);
}
function summarizePartialFeatures(features, storiesByParent) {
    const partials = [];

    for (const feature of features) {
        const id = feature.id;
        const children = storiesByParent[id] || [];
        if (children.length < 2) continue;

        const done = children.filter(isWorkItemCompleted);
        const notDone = children.filter(c => !isWorkItemCompleted(c));

        if (done.length && notDone.length) {
            partials.push({
                id,
                title: feature.fields['System.Title'],
                doneCount: done.length,
                pendingCount: notDone.length,
                total: children.length
            });
        }
    }

    return partials;
}

function countByPriority(items) {
    const counts = {};
    for (const item of items) {
        const p = item.fields['Microsoft.VSTS.Common.Priority'] || 2;
        counts[p] = (counts[p] || 0) + 1;
    }
    return counts;
}

function formatPriorityBreakdown(name, counts) {
    const parts = Object.entries(counts)
        .sort((a, b) => a[0] - b[0])
        .map(([prio, count]) => `P${prio}: ${count}`)
        .join(', ');
    return `- ${name}: ${parts}`;
}

module.exports = async function loadPlanningSuggestions(projectRoot, sourceConfig, fullConfig) {
    const outBase = path.join(projectRoot, 'shared', 'artifacts', sourceConfig.name || 'devops.planning');
    fs.mkdirSync(outBase, { recursive: true });

    const maxPriority = sourceConfig.maxPriority ?? 2;
    const scoreThreshold = sourceConfig.scoreThreshold ?? DEFAULT_SCORE_THRESHOLD;
    const prompt = sourceConfig.prompt?.trim() || 'Analyze work items for planning priority and recent activity.';

    const baseQuery = type => `
        SELECT [System.Id] FROM WorkItems
        WHERE [System.WorkItemType] = '${type}'
        AND [System.State] NOT IN ('Resolved', 'Closed', 'Removed')
        AND [Microsoft.VSTS.Common.Priority] <= ${maxPriority}
        AND [System.TeamProject] = '${process.env.AZURE_PROJECT}'
    `;

    const featureIds = await runWIQL(baseQuery('Feature'));
    const bugIds = await runWIQL(baseQuery('Bug'));
    const storyIds = await runWIQL(baseQuery('User Story'));

    const [features, bugs, stories] = await Promise.all([
        fetchWorkItemsWithParents(featureIds),
        fetchWorkItemsWithParents(bugIds),
        fetchWorkItemsWithParents(storyIds),
    ]);

    const featurePrioCounts = countByPriority(features);
    const bugPrioCounts = countByPriority(bugs);

    const priorityBreakdown = [
        formatPriorityBreakdown('Features', featurePrioCounts),
        formatPriorityBreakdown('Bugs', bugPrioCounts)
    ].join('\n');

    const storiesByFeature = {};
    for (const story of stories) {
        const parentId = story.parentID;
        if (!parentId) continue;
        storiesByFeature[parentId] = storiesByFeature[parentId] || [];
        storiesByFeature[parentId].push(story);
    }

    const partials = summarizePartialFeatures(features, storiesByFeature);

    const combined = [...features, ...bugs].map(item => {
        const score = scoreItem(item);
        return {
            id: item.id,
            title: item.fields['System.Title'],
            area: item.fields['System.AreaPath'],
            type: item.fields['System.WorkItemType'],
            priority: item.fields['Microsoft.VSTS.Common.Priority'] || 2,
            updated: item.fields['System.ChangedDate'],
            score,
        };
    }).filter(i => i.score >= scoreThreshold)
        .sort((a, b) => b.score - a.score);

    const shown = combined.slice(0, 10);
    let summaryTable = shown.length > 0 ? [
        `**Top ${shown.length} of ${combined.length} items above threshold (${scoreThreshold})**\n`,
        '| ID | Type | Title | Priority | Area | Score |',
        '|----|------|-------|----------|------|-------|',
        ...shown.map(i =>
            `| #${i.id} | ${i.type} | ${i.title} | P${i.priority} | ${i.area} | ${i.score} |`
        )
    ].join('\n') : '_⚠️ No high-priority features or bugs matched the threshold._';

    if (combined.length > 10) {
        summaryTable += `\n\n_Only top 10 items shown. ${combined.length - 10} more available in raw data._`;
    }
    const partialsSection = [
        `### ⚠️ Partial Feature Completions\n`,
        ...partials.map(p =>
            `- **#${p.id}** ${p.title} – ${p.doneCount} done / ${p.pendingCount} pending (total: ${p.total})`
        )
    ].join('\n');
    const areaCountsAll = countByAreaAndPriority([...features, ...bugs, ...stories]);

    const countsLine = `Found ${features.length} features, ${bugs.length} bugs, and ${stories.length} user stories.`;
    const vagueItems = [...features, ...bugs].map(item => {
        const title = item.fields?.['System.Title'] || '';
        const desc = item.fields?.['System.Description'] || '';
        const reason = findVagueReason(title, desc);
        if (reason) {
            return {
                id: item.id,
                type: item.fields?.['System.WorkItemType'],
                area: item.fields?.['System.AreaPath'],
                priority: item.fields?.['Microsoft.VSTS.Common.Priority'] || 2,
                title,
                reason
            };
        }
        return null;
    }).filter(Boolean);
    /* const planningSummary = [
        `### 🔮 Feature & Bug Planning Recommendations\n`, countsLine, '',
        summaryTable
    ].join('\n\n');
*/
    const areaBreakdownMd = formatAreaBreakdown(areaCountsAll);


    const vagueListMd = vagueItems.length
        ? [
            '### 📝 Vague items to refine',
            '',
            ...vagueItems
                .sort((a, b) => a.priority - b.priority || a.area.localeCompare(b.area))
                .map(v => `- **#${v.id}** (P${v.priority}, ${areaSegment(v.area)}, ${v.type}) – ${v.title} **→ ${v.reason}**`)
        ].join('\n')
        : '### 📝 Vague items to refine\n\n_None detected by the heuristic._';

    const vagueGroups = groupVagueItems([...features, ...bugs]);

    const vagueMdSections = Object.entries(vagueGroups)
        .map(([reason, items]) => [
            `### ${reason}`,
            ...items.map(v => `- **#${v.id}** (P${v.priority}, ${v.area}, ${v.type}) – ${v.title}`)
        ].join('\n'))
        .join('\n\n');

    const vagueSection = vagueMdSections || '### Vague Items\n\n_None detected by heuristic._';


    const planningSummary = [
        countsLine,                // already defined
        priorityBreakdown,         // existing global type breakdown
        areaBreakdownMd,           // NEW per‑area counts
        summaryTable,               // existing top N table
        vagueSection
    ].join('\n\n');

    const areaDetailMd = formatAreaBreakdown(areaCountsAll, '📍 By Area (priority counts)');

    const planningDetails = [
        `### 📋 Full Planning Dataset (Score ≥ ${scoreThreshold})\n`,
        countsLine,
        '',

        areaDetailMd,                     // NEW per‑area breakdown at the top
        '',
        [
            '| ID | Type | Title | Priority | Area | Score |',
            '|----|------|-------|----------|------|-------|',
            ...combined.map(i =>
                `| #${i.id} | ${i.type} | ${i.title} | P${i.priority} | ${i.area} | ${i.score} |`
            )
        ].join('\n'),
        '\n\n---\n\n',
        partialsSection,                  // existing partial feature completions
        '\n\n---\n\n',
        vagueSection                       // NEW: vagueness section
    ].join('\n');
    fs.writeFileSync(path.join(outBase, 'planning-summary.md'), planningSummary, 'utf-8');
    fs.writeFileSync(path.join(outBase, 'planning-details.md'), planningDetails, 'utf-8');

    console.log('✅ Scored Items:', combined.length);
    console.log(combined.map(i => `#${i.id} - ${i.score}`));

    return {
        name: sourceConfig.name || 'devops planning',
        type: sourceConfig.type,
        prompt,
        documents: [
            {
                filename: 'planning-summary.md',
                content: planningSummary
            }
        ]
    };
};