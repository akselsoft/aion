// recommendations.engine.js
// Post-processing engine that generates actionable insights from metrics.json and workitems-summary.md

const fs = require('fs');
const path = require('path');
const { logInfo } = require('../../../core/utils/logger');
console.log("✅ devops.recommendation.js loaded");

module.exports = async function runRecommendationsEngine(data, sourceConfig, projectRoot) {
    console.log("Running devops.recommendation engine with projectRoot:", projectRoot);
    console.log("🧪 Config :", sourceConfig);
    let finalSummary = ``;
    let iterations = []
    if (sourceConfig && sourceConfig.recommendations) {
        if (Array.isArray(sourceConfig.recommendations.iterations)) {
            iterations = sourceConfig.recommendations.iterations;
        } else if (typeof sourceConfig.recommendations.iterations === 'string') {
            iterations = [sourceConfig.recommendations];
        } else {
            console.warn('⚠️ Invalid recommendations configuration, expected array or string.');
        }

    }
    const iterBasePath = path.join(projectRoot, 'outputs');
    const iterationFolders = fs.readdirSync(iterBasePath).filter(f => f.startsWith('iteration-'));
    for (const folder of iterationFolders) {
        if (iterations.length > 0 && !iterations.includes(folder)) {
            // console.log(`Skipping ${folder}, not in configured iterations.`);
            continue;
        }
        console.log(`Processing iteration folder: ${folder}`);
        const artifactPath = path.join(iterBasePath, folder, 'artifacts');
        const metricsPath = path.join(artifactPath, 'metrics.json');
        const summaryPath = path.join(artifactPath, 'workitems-summary.md');
        const recPath = path.join(artifactPath, 'recommendations.md');

        if (!fs.existsSync(metricsPath) || !fs.existsSync(summaryPath)) {
            logInfo(`Skipping ${folder}, missing metrics or summary.`);
            continue;
        }

        const metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf-8'));
        let recommendations = `### 📌 Recommendations\n\n`;
        const activityBreakdown = metrics.activityBreakdown || {};

        // Deployment Overload
        const deployment = Object.entries(activityBreakdown).find(
            ([act, data]) => act.toLowerCase().includes('deploy') && data.utilizationPct > 200
        );
        if (deployment) {
            const [activity, data] = deployment;
            recommendations += `- **${activity} tasks show extremely high utilization at ${data.utilizationPct.toFixed(1)}%.**\n`;
            recommendations += `  → This suggests these are reactive or operational in nature. Consider moving such tasks to CAVCO or a dedicated ops team.\n\n`;
        }

        // Testing volatility
        const testing = activityBreakdown['Testing'];
        if (testing && testing.utilizationPct > 150) {
            recommendations += `- **Testing activity has high average utilization at ${testing.utilizationPct.toFixed(1)}%.**\n`;
            recommendations += `  → Consider reviewing estimate quality or if test execution tasks are under-scoped.\n\n`;
        }

        // Underutilization detection
        for (const [activity, data] of Object.entries(activityBreakdown)) {
            if (data.utilizationPct < 60 && data.tasks >= 3) {
                recommendations += `- **${activity} tasks appear underutilized at ${data.utilizationPct.toFixed(1)}%.**\n`;
                recommendations += `  → Consider whether these tasks are needed or if time logging is inconsistent.\n\n`;
            }
        }

        const areaBreakdown = metrics.areaBreakdown || {};

        // internal Overload
        const internal = Object.entries(areaBreakdown).find(
            ([act, data]) => act.toLowerCase().includes('internal') && data.utilizationPct > 150
        );
        if (internal) {
            const [activity, data] = internal;
            recommendations += `- **${activity} tasks show extremely high utilization at ${data.utilizationPct.toFixed(1)}%.**\n`;
            recommendations += `  → This suggests a higher degree of effort is being spent on non-client facing issues. Consider adjusting estimates or allocating a specific iteration to deal with technical debt\n\n`;
        }

        const maestro = Object.entries(areaBreakdown).find(
            ([act, data]) => act.toLowerCase().includes('\\maestro') && data.utilizationPct > 150
        );
        if (maestro) {
            const [activity, data] = maestro;
            recommendations += `- **${activity} tasks show extremely high utilization at ${data.utilizationPct.toFixed(1)}%.**\n`;
            recommendations += `  → This suggests these are reactive or operational in nature. Consider moving such tasks to CAVCO or a dedicated ops team.\n\n`;
        }

        const portal = Object.entries(areaBreakdown).find(
            ([act, data]) => act.toLowerCase().includes('\\portalo') && data.utilizationPct > 150
        );
        if (portal) {
            const [activity, data] = portal;
            recommendations += `- **${activity} tasks show extremely high utilization at ${data.utilizationPct.toFixed(1)}%.**\n`;
            recommendations += `  → This suggests these are reactive or operational in nature. Consider moving such tasks to CAVCO or a dedicated ops team.\n\n`;
        }

        const reporting = Object.entries(areaBreakdown).find(
            ([act, data]) => act.toLowerCase().includes('reporting') && data.utilizationPct > 150
        );
        if (reporting) {
            const [activity, data] = reporting;
            recommendations += `- **${activity} tasks show extremely high utilization at ${data.utilizationPct.toFixed(1)}%.**\n`;
            recommendations += `  → This suggests these are reactive or operational in nature. Consider moving such tasks to CAVCO or a dedicated ops team.\n\n`;
        }

        // Underutilization detection
        for (const [activity, data] of Object.entries(activityBreakdown)) {
            if (data.utilizationPct < 60 && data.tasks >= 3) {
                recommendations += `- **${activity} tasks appear underutilized at ${data.utilizationPct.toFixed(1)}%.**\n`;
                recommendations += `  → Consider whether these tasks are needed or if time logging is inconsistent.\n\n`;
            }
        }

        // Write to file
        console.log(`📝 Writing recommendations ${recommendations} to ${recPath}`);
        if (recommendations.trim() !== '### 📌 Recommendations') {
            console.log('🧪 recPath is:', recPath, '| Type:', typeof recPath);
            fs.writeFileSync(recPath, recommendations, 'utf-8');
            logInfo(`📄 Wrote recommendations for ${folder}`);
        }
        finalSummary = `## 📌 Recommendations for ${folder}\n\n` + recommendations;
    }

    console.log("Final summary:", finalSummary);
    fs.writeFileSync(path.join(projectRoot, 'shared', 'artifacts', 'iteration-recommendations.md'), finalSummary, 'utf-8');

    return {
        name: sourceConfig.name || 'devops recommendations engine',
        type: sourceConfig.type,
        documents: [{
            filename: 'iteration-recommendations.md',
            content: finalSummary
        }]
    };
};
