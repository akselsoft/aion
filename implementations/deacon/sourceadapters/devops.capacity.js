const path = require('path');
const fs = require('fs');
const { getCurrentIteration, getAllIterations, getCapacityForIteration } = require('../libs/azureIteration');
const { logInfo } = require('../../../core/utils/logger');

module.exports = async function loadDevOpsCapacity(projectRoot, sourceConfig, fullConfig) {

    const allIters = await getAllIterations();
    const today = new Date();
    const sorted = allIters
        .filter(i => i.attributes && i.attributes.startDate && i.attributes.finishDate &&
            new Date(i.attributes.finishDate) < today)
        .sort((a, b) => new Date(b.attributes.startDate) - new Date(a.attributes.startDate));

    const topThree = sorted.slice(0, 3);
    const latestIter = topThree[0];

    const sharedBase = path.join(projectRoot, 'shared', 'artifacts', sourceConfig.name || 'capacity');
    const iterFolderName = `iteration-${latestIter.name.match(/\d+/)?.[0] || latestIter.name}`;
    const outBase = path.join(projectRoot, 'outputs', iterFolderName, 'artifacts');

    fs.mkdirSync(sharedBase, { recursive: true });
    fs.mkdirSync(outBase, { recursive: true });

    const capacityByIter = [];

    const currentIteration = await getCurrentIteration();
    const capacity = await getCapacityForIteration(currentIteration.id);
    const sharedIterDir = path.join(sharedBase, currentIteration.name.replace(/[^\w-]/g, '_'));
    fs.mkdirSync(sharedIterDir, { recursive: true });

    fs.writeFileSync(
        path.join(sharedIterDir, 'capacity.json'),
        JSON.stringify(capacity, null, 2),
        'utf-8'
    );
        capacityByIter.push({ name: currentIteration.name, members: capacity });
    
    console.log(`📊 [deacon] Saved capacity data for current iteration.`);


    for (const iter of topThree) {
        const cap = await getCapacityForIteration(iter.id);

        // Save to shared
        const sharedIterDir = path.join(sharedBase, iter.name.replace(/[^\w-]/g, '_'));
        fs.mkdirSync(sharedIterDir, { recursive: true });
        const sharedCapFile = path.join(sharedIterDir, 'capacity.json');
        fs.writeFileSync(sharedCapFile, JSON.stringify(cap, null, 2), 'utf-8');

        capacityByIter.push({ name: iter.name, members: cap });
        logInfo(`📊 Saved capacity data for ${iter.name} to ${path.relative(projectRoot, sharedCapFile)}`);
    }


    // === Markdown Summary ===
    const allMembers = [...new Set(capacityByIter.flatMap(i => i.members.map(m => m.teamMember.displayName)))];

    let markdown = `### Capacity Trend (Last 3 Iterations)\n\n| Member | ${capacityByIter.map(i => i.name).join(' | ')} |\n|--------|${capacityByIter.map(() => '------').join('|')}|\n`;

    for (const member of allMembers) {
        const row = capacityByIter.map(i => {
            const entry = i.members.find(m => m.teamMember.displayName === member);
            const total = entry?.activities?.reduce((sum, a) => sum + a.capacityPerDay * (a.daysPerWeek || 5), 0) || 0;
            return `${total}h`;
        }).join(' | ');
        markdown += `| ${member} | ${row} |\n`;
    }

    // Write summary to artifacts for LLM input
    fs.writeFileSync(path.join(outBase, 'capacity-summary.md'), markdown, 'utf-8');
    logInfo(`📊 Saved capacity data to ${path.join(outBase, "capacity-summary.md")}`);
    return {
        name: sourceConfig.name || 'devops capacity',
        type: sourceConfig.type,
        prompt: `Summarize the team's workload capacity trend over the last three iterations.`,
        documents: [
            {
                filename: 'capacity-summary.md',
                content: markdown
            }
        ]
    };
};