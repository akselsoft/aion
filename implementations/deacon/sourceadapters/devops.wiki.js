// implementations/deacon/sourceAdapters/devops.wiki.js
const fs = require('fs');
const path = require('path');
const simpleGit = require('simple-git');
const micromatch = require('micromatch');
const { PAT, PROJECT, wikiGitUrl } = require('../../libs/azurefunctions');

module.exports = async (projectRoot, cfg = {}) => {
    const repoUrl = cfg.repoUrl || wikiGitUrl(PROJECT);
    const branch = cfg.branch || 'master';
    const outDir = cfg.outDir || 'artifacts/wiki';
    const stateFile = cfg.stateFile || '.aion/state/wiki.json';
    const cacheDir = cfg.location ? path.resolve(projectRoot, cfg.location)
        : path.join(projectRoot, cfg.cacheDir || `.cache/wiki/${PROJECT}`);

    const include = cfg.includeGlobs || ['**/*.md', '**/*.mdx', '**/*.txt', '**/*.rst'];
    const exclude = cfg.excludeGlobs || ['**/images/**', '**/*.png', '**/*.jpg', '**/*.gif', '**/*.pdf', '**/*.zip'];

    fs.mkdirSync(cacheDir, { recursive: true });
    const git = simpleGit({ baseDir: cacheDir });

    // clone if needed
    if (!fs.existsSync(path.join(cacheDir, '.git'))) {
        const url = repoUrl.replace('https://', `https://${encodeURIComponent('')}:${encodeURIComponent(PAT)}@`);
        await simpleGit().clone(url, cacheDir, ['--branch', branch, '--single-branch']);
    }
    await git.fetch(); await git.checkout(branch); await git.pull('origin', branch);

    // state
    const statePath = path.join(projectRoot, stateFile);
    let state = { lastSyncedCommit: null, lastRunAt: null };
    if (fs.existsSync(statePath)) try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch { }

    const head = (await git.revparse(['HEAD'])).trim();
    const from = state.lastSyncedCommit || head;

    const outPath = path.join(projectRoot, outDir);
    const changedDir = path.join(outPath, 'changed');
    const diffsDir = path.join(outPath, 'diffs');
    fs.mkdirSync(changedDir, { recursive: true });
    fs.mkdirSync(diffsDir, { recursive: true });

    const passFilters = files => micromatch(micromatch(files, include, { dot: true }), exclude.map(e => '!' + e), { dot: true });
    const copyFiles = files => files.forEach(f => {
        const src = path.join(cacheDir, f); if (!fs.existsSync(src)) return;
        const dst = path.join(changedDir, f); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst);
    });

    let selected = [];
    if (!state.lastSyncedCommit || cfg.mode === 'full') {
        const all = (await git.raw(['ls-files'])).split('\n').map(s => s.trim()).filter(Boolean);
        selected = passFilters(all);
        copyFiles(selected);
        fs.writeFileSync(path.join(diffsDir, `FULL_${head}.txt`), `Full export at ${head}\n`);
    } else {
        const raw = await git.raw(['log', `${from}..${head}`, '--name-status', '--pretty=format:COMMIT %H']);
        const files = parseNameStatus(raw);
        selected = passFilters(files);
        copyFiles(selected);
        for (const f of selected) {
            const diff = await git.diff([`${from}..${head}`, '--', f]);
            fs.writeFileSync(path.join(diffsDir, f.replace(/[\\/]/g, '__') + '.diff'), diff || `No diff for ${f}`);
        }
    }

    state.lastSyncedCommit = head;
    state.lastRunAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

    return {
        name: 'devops-wiki',
        documents: selected.map(f => ({ path: path.join(outDir, 'changed', f), contentType: f.endsWith('.md') ? 'text/markdown' : 'text/plain' }))
    };
};

function parseNameStatus(raw) {
    const out = new Set();
    for (const line of raw.split('\n')) {
        if (!line || line.startsWith('COMMIT ')) continue;
        const parts = line.split('\t'); const status = parts[0]; const target = parts[2] || parts[1];
        if (target && status !== 'D') out.add(target);
    }
    return Array.from(out);
}