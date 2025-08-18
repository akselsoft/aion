// implementations/deacon/sourceAdapters/devops.repo.readme.js
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { ORG, PROJECT, getAuthHeader } = require('../libs/azurefunctions');

// Try a few likely README paths before listing root to find one case-insensitively
const CANDIDATES = ['/README.md', '/Readme.md', '/readme.md', '/README.MD'];

module.exports = async function loadRepoReadme(projectRoot, cfg = {}) {
    const repoId = cfg.repoId;           // preferred
    const repoName = cfg.repoName;       // or use name if you don’t have the GUID
    const outDir = path.join(projectRoot, cfg.outDir || 'artifacts/wiki');
    const fileName = cfg.fileName || 'RepoREADME.md';
    const client = axios.create({
        baseURL: `https://dev.azure.com/${ORG}/${PROJECT}/_apis`,
        ...getAuthHeader()
    });

    // Resolve repo if only name provided
    let repo = repoId;
    if (!repo) {
        if (!repoName) throw new Error('repoId or repoName required');
        const { data: repos } = await client.get(`/git/repositories?api-version=7.0`);
        const hit = (repos.value || []).find(r => r.name === repoName);
        if (!hit) throw new Error(`Repository "${repoName}" not found`);
        repo = hit.id;
    }

    // Attempt direct paths first
    let content = null;
    for (const p of CANDIDATES) {
        try {
            const { data } = await client.get(
                `/git/repositories/${encodeURIComponent(repo)}/items`,
                { params: { path: p, includeContent: true, 'api-version': '7.0' }, ...getAuthHeader() }
            );
            if (data?.content) { content = data.content; break; }
        } catch { /* ignore and try next */ }
    }

    // Fallback: list root and find readme by name
    if (!content) {
        const { data: root } = await client.get(
            `/git/repositories/${encodeURIComponent(repo)}/items`,
            { params: { scopePath: '/', recursionLevel: 'OneLevel', includeContentMetadata: true, 'api-version': '7.0' }, ...getAuthHeader() }
        );
        const candidates = (root.value || []).filter(i => /readme\.md$/i.test(i.path));
        if (!candidates.length) throw new Error('README not found at repo root');
        const chosen = candidates[0].path;
        const { data } = await client.get(
            `/git/repositories/${encodeURIComponent(repo)}/items`,
            { params: { path: chosen, includeContent: true, 'api-version': '7.0' }, ...getAuthHeader() }
        );
        content = data?.content || '';
    }

    if (!content) throw new Error('README content empty');

    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, fileName), content, 'utf8');

    return {
        name: 'devops-repo-readme',
        documents: [{ path: path.join(cfg.outDir || 'artifacts/wiki', fileName), contentType: 'text/markdown' }]
    };
};