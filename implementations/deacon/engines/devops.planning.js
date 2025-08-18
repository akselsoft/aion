const fs = require('fs');
const path = require('path');
const { logInfo } = require('../../../core/utils/logger');

module.exports = async function devopsPlanningEngine(data, config, projectRoot) {
    logInfo('📈 Running devops.planning engine...');
    logInfo('Received data sections:', data);

    const getSection = (name) => data.find(d => d.name === name)?.documents?.[0]?.content || '';

    const summary = getSection('workitems-summary');
    const planning = getSection('planning');
    const summaryBrief = fs.existsSync(path.join(projectRoot, 'history', 'summary-brief.md'))
        ? fs.readFileSync(path.join(projectRoot, 'history', 'summary-brief.md'), 'utf-8')
        : '';
    const metrics = fs.existsSync(path.join(projectRoot, 'shared', 'artifacts', 'metrics.json'))
        ? JSON.parse(fs.readFileSync(path.join(projectRoot, 'shared', 'artifacts', 'metrics.json'), 'utf-8'))
        : null;

    // Basic synthesis (can evolve later)
    const planningInsights = [
        `## 📌 Planning Insights\n`,
        `Based on current work item summary:\n\n${summary}`,
        `\n\n---\n\nCurrent feature planning suggestions:\n\n${planning}`,
        metrics
            ? `\n\n---\n\nRecent delivery trends suggest a cadence of ~${metrics.avgStories} stories and ~${metrics.avgBugs} bugs per iteration.`
            : '',
        summaryBrief ? `\n\n---\n\nPrevious context:\n\n${summaryBrief}` : ''
    ].join('\n');

    // Write output
    const outDir = path.join(projectRoot, 'shared', 'artifacts');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'planning-synthesis.md');
    fs.writeFileSync(outPath, planningInsights, 'utf-8');

    data.push({
        name: 'devops-planning-synthesis',
        type: 'insight',
        prompt: 'Forward-looking planning analysis based on metrics, work item load, and past iteration brief.',
        documents: [
            {
                filename: 'planning-synthesis.md',
                content: planningInsights
            }
        ]
    });

    logInfo(`🧠 DevOps planning synthesis written to ${path.relative(projectRoot, outPath)}`);
    return data;
};