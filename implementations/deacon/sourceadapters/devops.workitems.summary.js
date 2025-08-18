// Refactored version of devops.workitems.summary.js
// Combined compact semantic summary with estimation/utilization metrics

const path = require('path');
const fs = require('fs');
const { runWIQL } = require('../libs/devops.query');
const { fetchWorkItemsWithParents, attachEffortMetrics } = require('../libs/devops.workitems');
const { getAllIterations, getCurrentIteration } = require('../libs/azureIteration');
const { logInfo } = require('../../../core/utils/logger');
const { generateTitleKeywordMap } = require('../libs/keywordHeatMap');

function buildWeeklyIntakeSummary(enrichedWorkItems, iteration) {
    const start = new Date(iteration.attributes?.startDate || iteration.startDate);
    const end = new Date(iteration.attributes?.finishDate || iteration.finishDate);
    const days = 24 * 60 * 60 * 1000;

    const tasks = (enrichedWorkItems || []).filter(w =>
        (w.fields?.['System.WorkItemType'] || '').toLowerCase() === 'task'
    );

    const getCreated = w => new Date(w.fields?.['System.CreatedDate']);
    const getAct = w => w.fields?.['Microsoft.VSTS.Common.Activity'] || 'Unassigned';
    const getEstHrs = w => Number(w._metrics?.estimatedHours ?? 0);
    const getActHrs = w => Number(w._metrics?.actualHours ?? 0);

    // checkpoints: Sprint Start, then each week-end until finish
    const checkpoints = [{ label: 'Sprint Start', date: new Date(start), idx: -1 }];
    for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 7 * days)) {
        const cap = new Date(Math.min(end.getTime(), d.getTime() + 7 * days - 1));
        if (cap > start) checkpoints.push({
            label: `Week ${checkpoints.length} End`,
            date: cap,
            idx: checkpoints.length - 1
        });
    }

    const carryIn = tasks.filter(t => getCreated(t) <= start);
    const rows = [];
    let prevTotal = carryIn.length;

    const agg = items => {
        const byActivity = {};
        let est = 0, act = 0;
        for (const t of items) {
            const a = getAct(t);
            if (!byActivity[a]) byActivity[a] = { count: 0, est: 0, act: 0 };
            byActivity[a].count += 1;
            byActivity[a].est += getEstHrs(t);
            byActivity[a].act += Math.max(0, getActHrs(t));
            est += getEstHrs(t);
            act += Math.max(0, getActHrs(t));
        }
        return {
            est: Math.round(est * 100) / 100,
            act: Math.round(act * 100) / 100,
            byActivity: Object.fromEntries(
                Object.entries(byActivity).map(([k, v]) => [k, {
                    count: v.count,
                    est: Math.round(v.est * 100) / 100,
                    act: Math.round(v.act * 100) / 100
                }])
            )
        };
    };

    // Sprint Start
    {
        const a = agg(carryIn);
        rows.push({
            checkpoint: 'Sprint Start',
            tasksAtStart: carryIn.length,
            tasksAdded: 0,
            estHours: a.est, actualHours: a.act,
            byActivity: a.byActivity
        });
    }

    // Weekly checkpoints
    for (let i = 1; i < checkpoints.length; i++) {
        const prev = checkpoints[i - 1].date, cur = checkpoints[i].date;
        const added = tasks.filter(t => {
            const c = getCreated(t);
            return c > prev && c <= cur;
        });

        const toDate = tasks.filter(t => getCreated(t) <= cur);
        const a = agg(toDate);

        const totalNow = prevTotal + added.length;
        rows.push({
            checkpoint: checkpoints[i].label,
            tasksAtStart: totalNow,
            tasksAdded: added.length,
            estHours: a.est, actualHours: a.act,
            byActivity: a.byActivity
        });
        prevTotal = totalNow;
    }

    // quick scope-creep %
    const startRow = rows[0], endRow = rows[rows.length - 1] || rows[0];
    const creepPct = startRow.tasksAtStart
        ? Math.round(((endRow.tasksAtStart - startRow.tasksAtStart) / startRow.tasksAtStart) * 100)
        : 0;

    // render markdown
    const lines = [];
    lines.push('### 📈 Task Intake Over Sprint (Weekly)');
    lines.push('');
    lines.push(`*Scope creep:* **${creepPct}%** (tasks from start → end)`);
    lines.push('');
    lines.push('| Checkpoint | Tasks Present | Tasks Added | Est. Hours (cum) | Actual Hours (cum) | Top Activities |');
    lines.push('|---|---:|---:|---:|---:|---|');
    for (const r of rows) {
        const topActs = Object.entries(r.byActivity)
            .sort((a, b) => b[1].est - a[1].est)
            .slice(0, 3)
            .map(([k, v]) => `${k} (${v.count}/${v.est}h)`).join(', ');
        lines.push(`| ${r.checkpoint} | ${r.tasksAtStart} | ${r.tasksAdded} | ${r.estHours} | ${r.actualHours} | ${topActs} |`);
    }
    lines.push('');
    lines.push('> Note: Hours are cumulative up to each checkpoint. Tasks = *Task* items only.');

    return { rows, creepPct, markdown: lines.join('\n') };
}

module.exports = async function loadDevOpsWorkItemSummary(projectRoot, sourceConfig, fullConfig) {
    const rawIter = sourceConfig.iteration;
    const allIters = await getAllIterations();
    let iteration = null;

    if (rawIter && !rawIter.includes('${')) {
        iteration = allIters.find(i => i.name === rawIter || i.path.endsWith(`\\${rawIter}`));
        if (!iteration) throw new Error(`Iteration "${rawIter}" not found in DevOps.`);
    } else {
        iteration = await getCurrentIteration();
    }

    const iterationPath = iteration.path;
    const iterFolderName = `iteration-${iteration.name.match(/\d+/)?.[0] || iteration.name}`;
    const outBase = path.join(projectRoot, 'outputs', iterFolderName, 'artifacts');
    fs.mkdirSync(outBase, { recursive: true });

    const wiql = `
    SELECT [System.Id] FROM WorkItems
    WHERE [System.IterationPath] = '${iterationPath}'
    AND [System.TeamProject] = '${process.env.AZURE_PROJECT}'
  `;

    const ids = await runWIQL(wiql);
    const workItems = await fetchWorkItemsWithParents(ids);
    const { isWorkItemCompleted } = require('../libs/azurefunctions');

    // Attach effort/utilization metrics
    const enrichedWorkItems = workItems.map(w => attachEffortMetrics(w));

    const summary = {
        UserStory: {},
        Bug: {},
        Feature: {},
        Tasks: {}
    };

    const contributorStats = {};
    const overruns = [];
    const metrics = {
        iteration: iteration.name,
        storiesCompleted: 0,
        bugsCompleted: 0,
        featuresCompleted: 0,
        effortCompleted: 0
    };

    for (const w of enrichedWorkItems) {
        const fields = w.fields || {};
        const type = fields['System.WorkItemType'];
        const state = fields['System.State'] || 'Unknown';
        const priority = fields['Microsoft.VSTS.Common.Priority'] ?? 'Unspecified';
        const assignee = fields['System.AssignedTo']?.displayName || 'Unassigned';
        const activity = fields['Microsoft.VSTS.Common.Activity'] || 'Unassigned';
        const area = fields['System.AreaPath'] || 'Unassigned';
        const m = w._metrics || {};



        // Grouping by type and priority
        if (type === 'User Story') {
            if (!summary.UserStory[priority]) summary.UserStory[priority] = {};
            if (!summary.UserStory[priority][state]) summary.UserStory[priority][state] = 0;
            summary.UserStory[priority][state]++;
            if (isWorkItemCompleted(w)) metrics.storiesCompleted++;
        } else if (type === 'Bug') {
            if (!summary.Bug[priority]) summary.Bug[priority] = {};
            if (!summary.Bug[priority][state]) summary.Bug[priority][state] = 0;
            summary.Bug[priority][state]++;
            if (isWorkItemCompleted(w)) metrics.bugsCompleted++;
        } else if (type === 'Feature') {
            if (!summary.Feature[state]) summary.Feature[state] = 0;
            summary.Feature[state]++;
            if (isWorkItemCompleted(w)) metrics.featuresCompleted++;
            metrics.effortCompleted += fields['Microsoft.VSTS.Scheduling.Effort'] || 0;
        } else if (type === 'Task') {
            if (!summary.Tasks[assignee]) summary.Tasks[assignee] = {};
            if (!summary.Tasks[assignee][activity]) summary.Tasks[assignee][activity] = {};
            if (!summary.Tasks[assignee][activity][state]) summary.Tasks[assignee][activity][state] = 0;
            if (!summary.Tasks[assignee][area]) summary.Tasks[assignee][area] = {};
            if (!summary.Tasks[assignee][area][state]) summary.Tasks[assignee][area][state] = 0;
            summary.Tasks[assignee][activity][state]++;
            summary.Tasks[assignee][area][state]++;

            if (!contributorStats[assignee]) {
                contributorStats[assignee] = {
                    tasks: 0,
                    utilization: [],
                    areas: {},
                    activities: {} // 👈 Add activities tracking
                };
            }
            if (!contributorStats[area]) {
                contributorStats[area] = {
                    tasks: 0,
                    utilization: [],
                    areas: {},
                    activities: {} // 👈 Add activities tracking
                };
            }

            contributorStats[assignee].tasks++;

            if (typeof m.utilizationPct === 'number') {
                contributorStats[assignee].utilization.push(m.utilizationPct);
            }

            // Add per-activity tracking
            if (!contributorStats[assignee].areas[area]) {
                contributorStats[assignee].areas[area] = {
                    tasks: 0,
                    estimated: 0,
                    actual: 0
                };
            }
            contributorStats[assignee].areas[area].tasks++;
            contributorStats[assignee].areas[area].estimated += m.estimatedHours || 0;
            contributorStats[assignee].areas[area].actual += m.actualHours || 0;


            // Add per-activity tracking
            if (!contributorStats[assignee].activities[activity]) {
                contributorStats[assignee].activities[activity] = {
                    tasks: 0,
                    estimated: 0,
                    actual: 0
                };
            }

            contributorStats[assignee].activities[activity].tasks++;
            contributorStats[assignee].activities[activity].estimated += m.estimatedHours || 0;
            contributorStats[assignee].activities[activity].actual += m.actualHours || 0;

            // Track overruns
            if (m.utilizationPct > 150) {
                overruns.push({
                    id: w.id,
                    activity: activity,
                    assignee: assignee,
                    title: fields['System.Title'],
                    estimated: m.estimatedHours,
                    actual: m.actualHours,
                    utilizationPct: m.utilizationPct
                });
            }
        }
    }

    let md = `### 📊 Summary by Work Item Type
`;
    const renderStateTable = (label, obj) => {
        md += `\n**${label}**\n\n`;
        md += `| Priority | State | Count |\n|----------|--------|--------|\n`;
        for (const [prio, stateObj] of Object.entries(obj)) {
            for (const [state, count] of Object.entries(stateObj)) {
                md += `| ${prio} | ${state} | ${count} |\n`;
            }
        }
    };

    renderStateTable('User Stories', summary.UserStory);
    renderStateTable('Bugs', summary.Bug);

    md += `\n**Features**\n\n| State | Count |\n|--------|--------|\n`;
    for (const [state, count] of Object.entries(summary.Feature)) {
        md += `| ${state} | ${count} |\n`;
    }

    md += `\n**Tasks by Contributor / Activity**\n\n| Assignee | Activity | State | Count |\n|----------|----------|--------|--------|\n`;
    for (const [who, acts] of Object.entries(summary.Tasks)) {
        for (const [act, states] of Object.entries(acts)) {
            for (const [st, ct] of Object.entries(states)) {
                md += `| ${who} | ${act} | ${st} | ${ct} |\n`;
            }
        }
    }

    if (overruns.length > 0) {
        md += `\n### ⏱️ Overrun Alert (150%+ Estimated Time)\n`;
        for (const t of overruns) {
            md += `- #${t.id} ${t.assignee} **${t.title}** → ${t.activity} Estimated: ${t.estimated}h, Actual: ${t.actual}h (**${Math.round(t.utilizationPct)}%**)\n`;
        }
    }
    md += `\n### 📊 Estimation Accuracy by Contributor and Activity\n`;
    md += `| Assignee | Activity | Tasks | Estimated (h) | Actual (h) | Utilization % |\n`;
    md += `|----------|----------|--------|----------------|-------------|----------------|\n`;

    for (const [assignee, stats] of Object.entries(contributorStats)) {
        for (const [activity, aStats] of Object.entries(stats.activities || {})) {
            const utilization = aStats.estimated > 0
                ? ((aStats.actual / aStats.estimated) * 100).toFixed(1)
                : '0.0';
            md += `| ${assignee} | ${activity} | ${aStats.tasks} | ${aStats.estimated.toFixed(2)} | ${aStats.actual.toFixed(2)} | ${utilization}% |\n`;
        }
    }

    metrics.areaBreakdown = {};
    for (const [assignee, stats] of Object.entries(contributorStats)) {
        for (const [area, aStats] of Object.entries(stats.areas || {})) {
            if (!metrics.areaBreakdown[area]) {
                metrics.areaBreakdown[area] = {
                    tasks: 0,
                    estimated: 0,
                    actual: 0
                };
            }
            metrics.areaBreakdown[area].tasks += aStats.tasks;
            metrics.areaBreakdown[area].estimated += aStats.estimated;
            metrics.areaBreakdown[area].actual += aStats.actual;
        }
    }

    for (const [activity, actStats] of Object.entries(metrics.areaBreakdown)) {
        actStats.utilizationPct = actStats.estimated > 0
            ? (actStats.actual / actStats.estimated) * 100
            : 0;
    }

    // ⬇️ Generate activity-level breakdown for metrics.json
    metrics.activityBreakdown = {};


    for (const [assignee, stats] of Object.entries(contributorStats)) {
        for (const [activity, aStats] of Object.entries(stats.activities || {})) {
            if (!metrics.activityBreakdown[activity]) {
                metrics.activityBreakdown[activity] = {
                    tasks: 0,
                    estimated: 0,
                    actual: 0
                };
            }
            metrics.activityBreakdown[activity].tasks += aStats.tasks;
            metrics.activityBreakdown[activity].estimated += aStats.estimated;
            metrics.activityBreakdown[activity].actual += aStats.actual;
        }
    }

    for (const [activity, actStats] of Object.entries(metrics.activityBreakdown)) {
        actStats.utilizationPct = actStats.estimated > 0
            ? (actStats.actual / actStats.estimated) * 100
            : 0;
    }

    const { rows: weeklyRows, creepPct, markdown: weeklyMd } =
        buildWeeklyIntakeSummary(enrichedWorkItems, iteration);

    // append to workitems-summary.md
    md += `\n\n${weeklyMd}\n`;

    fs.writeFileSync(path.join(outBase, 'workitems-summary.md'), md, 'utf-8');
    fs.writeFileSync(path.join(outBase, 'metrics.json'), JSON.stringify(metrics, null, 2), 'utf-8');
    fs.writeFileSync(path.join(outBase, 'raw.workitems.json'), JSON.stringify(enrichedWorkItems, null, 2), 'utf-8');
    fs.writeFileSync(
        path.join(outBase, 'weekly-intake.json'),
        JSON.stringify({ creepPct, rows: weeklyRows }, null, 2),
        'utf-8'
    );
    const keywordMap = generateTitleKeywordMap(workItems, fullConfig.keywordExtraction || {});
    fs.writeFileSync(path.join(outBase, 'title-keywords.json'), JSON.stringify(keywordMap, null, 2), 'utf-8');

    // no need to include the metrics in the output

    return {
        name: sourceConfig.name || 'devops work item summary',
        type: sourceConfig.type,
        prompt: sourceConfig.prompt || `Summarize work items in the current sprint by state, priority, and utilization. Call out significant overruns or underestimations.`,
        documents: [
            { filename: 'workitems-summary.md', content: md }
        ]
    };
};