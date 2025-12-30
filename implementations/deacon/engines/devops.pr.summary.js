// implementations/deacon/analyzers/devops.pr.summary.js
const fs = require('fs');
const path = require('path');

// async function chatgptEngine(data, config, projectRoot) {

module.exports = async function makePRSummaryMD(engineData, cfg, projectRoot = {}) {
    const getPaths = (v) => {
        if (!v) return ['artifacts/prs/prs-summary.json'];
        if (Array.isArray(v)) return v;
        return [v];
    };

    let prPath = cfg.prsSummaryPath || 'artifacts/prs/prs-summary.json';
    prPath = path.join(projectRoot, prPath);

    const inputs = getPaths(prPath).map(p =>
        path.isAbsolute(p) ? p : path.join(projectRoot, p)
    );
    const outDir = path.join(projectRoot, cfg.outDir || 'artifacts/prs');
    const outFile = path.join(outDir, cfg.fileName || 'PR-Summary.md');
    fs.mkdirSync(outDir, { recursive: true });

    const data = JSON.parse(fs.readFileSync(prPath, 'utf8'));
    const prs = data.prs || [];

    const fileToPRs = new Map();
    for (const pr of prs) {
        for (const f of (pr.files || [])) {
            const rec = fileToPRs.get(f) || { count: 0, prs: [] };
            rec.count += 1;
            rec.prs.push(pr.id);
            fileToPRs.set(f, rec);
        }
    }

    const totalPRs = prs.length;
    const totalFiles = fileToPRs.size;

    const multiTouched = Array.from(fileToPRs.entries())
        .filter(([, rec]) => rec.count > 1)
        .map(([file, rec]) => ({ file, count: rec.count, prs: rec.prs }))
        .sort((a, b) => b.count - a.count || a.file.localeCompare(b.file));

    const md = [
        `# PR Summary`,
        ``,
        `**Window:** ${data.sinceDate || 'n/a'} → ${data.untilDate || 'n/a'}`,
        ``,
        `- **Total PRs:** ${totalPRs}`,
        `- **Total unique files touched:** ${totalFiles}`,
        ``,
        `## Files touched by more than one PR`,
        multiTouched.length === 0
            ? `_None in this window._`
            : `| File | PR count | PR IDs |\n|---|---:|---|\n` +
            multiTouched.map(r => `| \`${r.file}\` | ${r.count} | ${r.prs.slice(0, 25).join(', ')} |`).join('\n')
    ].join('\n');

    fs.writeFileSync(outFile, md, 'utf8');
    console.log(`PR Summary written to ${outFile}`);

    return {
        name: 'pr-summary-md',
        documents: [{
            path: path.relative(projectRoot, outFile),
            contentType: 'text/markdown',
            content: md
        }]
    };
};