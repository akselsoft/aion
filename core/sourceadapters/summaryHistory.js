// core/sourceAdapters/summaryHistory.js
const fs = require('fs');
const path = require('path');
const { getHistoryDir, getOutputDir } = require('../utils/outputPaths');

function summarizeRecentMetrics(projectRoot, config = {}, count = 3) {
    const outputsDir = getOutputDir(projectRoot, config);
    if (!fs.existsSync(outputsDir)) return '';
    const folders = fs.readdirSync(outputsDir)
        .filter(name => /^iteration-\d+$/.test(name))
        .sort((a, b) => {
            const n1 = parseInt(a.match(/\d+/)[0]);
            const n2 = parseInt(b.match(/\d+/)[0]);
            return n2 - n1; // descending
        })
        .slice(0, count);

    const rows = [];
    for (const folder of folders) {
        const metricsPath = path.join(outputsDir, folder, 'artifacts', 'metrics.json');
        if (!fs.existsSync(metricsPath)) continue;
        const metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf-8'));
        rows.push({
            iteration: metrics.iteration || folder,
            featuresDone: metrics.featuresCompleted || 0,
            storiesDone: metrics.storiesCompleted || 0,
            bugsDone: metrics.bugsCompleted || 0,
            effort: metrics.effortCompleted || 0,
            team: metrics.teamMembers || '-'
        });
    }

    const table = [
        `### 📊 Recent Iteration Metrics\n`,
        `| Iteration | Features Done | Stories Done | Bugs Done | Effort | Team Size |`,
        `|-----------|----------------|--------------|-----------|--------|------------|`,
        ...rows.map(r =>
            `| ${r.iteration} | ${r.featuresDone} | ${r.storiesDone} | ${r.bugsDone} | ${r.effort} | ${r.team} |`
        )
    ].join('\n');

    return table + '\n\n';
}

module.exports = async function summaryHistoryLoader(projectRoot, src, fullConfig = {}) {
    const summaryPath = path.join(getHistoryDir(projectRoot, fullConfig), 'summary-brief.md');

    if (!fs.existsSync(summaryPath)) {
        console.warn(`📭 No previous summary found at: ${summaryPath}`);
        return null; // returning null or undefined is OK for skipped sources
    }

    const content = fs.readFileSync(summaryPath, 'utf-8');

    const metricsTable = summarizeRecentMetrics(projectRoot, fullConfig, 3);
    let finalSummaryBrief = (metricsTable ? metricsTable : 'no past metrics') + '\n\n' + content;
    console.log(`📖 Loaded previous summary`, finalSummaryBrief);

    if (!content || content === 'undefined') {
        console.warn(`⚠️ No valid content in summary history at: ${summaryPath}`);
        return null;
    }
    return {
        name: 'Previous Summary',
        type: 'summaryHistory',
        prompt: src.prompt || 'This was the summary generated during the previous run.',
        documents: [
            {
                name: 'summary-brief.md',
                type: 'markdown',
                content: finalSummaryBrief,
                source: 'summaryHistory'
            }
        ]
    };
};
