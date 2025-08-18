// implementations/deacon/sourceAdapters/devops.welcome.js
// Compose Welcome.md like Azure DevOps Overview → Summary:
// 1) Project Description  2) Repo README (default or repoName override)  3) Wiki root (optional)
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { ORG, PROJECT, getAuthHeader } = require('../libs/azurefunctions');

const README_CANDIDATES = ['/README.md', '/Readme.md', '/readme.md', '/README.MD'];

module.exports = async function loadProjectWelcome(projectRoot, cfg = {}) {
    const outDir = path.join(projectRoot, cfg.outDir || 'artifacts/welcome');
    const fileName = cfg.fileName || 'Welcome.md';
    const includeDescription = cfg.includeDescription ?? true;
    const includeReadme = cfg.includeReadme ?? true;
    const includeWiki = cfg.includeWiki ?? true;

    const client = axios.create({
        baseURL: `https://dev.azure.com/${ORG}/${PROJECT}/_apis`,
        ...getAuthHeader()
    });

    let sections = [`# ${PROJECT} — Welcome\n`];
    let defaultRepo = null;
    let wikiUsed = null;

    // 1) Project Description
    if (includeDescription) {
        try {
            const { data: proj } = await client.get(`/projects/${encodeURIComponent(PROJECT)}?api-version=7.0`);
            const desc = (proj.description || '').trim();
            sections.push(`## Project Description\n${desc || '_No project description set._'}\n`);
        } catch {
            sections.push(`## Project Description\n_Could not fetch project description._\n`);
        }
    }

    // 2) Repo README
    if (includeReadme) {
        try {
            const { data: repos } = await client.get(`/git/repositories?api-version=7.0`);

            // If repoName provided in config, try to match it first
            if (cfg.repoName) {
                defaultRepo = (repos.value || []).find(r => r.name.toLowerCase() === cfg.repoName.toLowerCase());
            }

            // Fall back to default repo if no match or no repoName
            if (!defaultRepo) {
                defaultRepo = (repos.value || []).find(r => r.isDefault) || (repos.value || [])[0];
            }

            let readme = '';

            if (defaultRepo) {
                console.log(`Using repository: ${defaultRepo.name} (${defaultRepo.id})`);
                // try common names
                for (const p of README_CANDIDATES) {
                    try {
                        const { data } = await client.get(
                            `/git/repositories/${encodeURIComponent(defaultRepo.id)}/items`,
                            { params: { path: p, includeContent: true, 'api-version': '7.0' }, ...getAuthHeader() }
                        );
                        if (data?.content) { readme = data.content; break; }
                    } catch { }
                }
                // fallback: scan root
                if (!readme) {
                    const { data: root } = await client.get(
                        `/git/repositories/${encodeURIComponent(defaultRepo.id)}/items`,
                        { params: { scopePath: '/', recursionLevel: 'OneLevel', includeContentMetadata: true, 'api-version': '7.0' }, ...getAuthHeader() }
                    );
                    const item = (root.value || []).find(i => /readme\.md$/i.test(i.path));
                    if (item) {
                        const { data } = await client.get(
                            `/git/repositories/${encodeURIComponent(defaultRepo.id)}/items`,
                            { params: { path: item.path, includeContent: true, 'api-version': '7.0' }, ...getAuthHeader() }
                        );
                        readme = data?.content || '';
                    }
                }
                sections.push(`## Repository README (${defaultRepo?.name})\n${readme || '_No README.md found in the repository._'}\n`);
            } else {
                sections.push(`## Repository README\n_No repositories found in project._\n`);
            }
        } catch {
            sections.push(`## Repository README\n_Could not fetch repo or README._\n`);
        }
    }

    // 3) Wiki root page
    if (includeWiki) {
        try {
            console.log('Fetching wiki root page...');
            const { data: list } = await client.get(`/wiki/wikis?api-version=7.0`);
            if (list?.value?.length) {
                const wiki = list.value.find(w => w.type === 'projectWiki') || list.value[0];
                wikiUsed = { id: wiki.id, name: wiki.name };

                // Try root by id (1), then path "/"
                let content = '';
                try {
                    const { data } = await client.get(
                        `/wiki/wikis/${encodeURIComponent(wiki.id)}/pages/1`,
                        { params: { includeContent: true, 'api-version': '7.0' }, ...getAuthHeader() }
                    );
                    content = data?.page?.content ?? data?.content ?? '';
                } catch { }
                if (!content) {
                    const { data } = await client.get(
                        `/wiki/wikis/${encodeURIComponent(wiki.id)}/pages`,
                        { params: { path: '/', includeContent: true, 'api-version': '7.0' }, ...getAuthHeader() }
                    );
                    content = data?.page?.content ?? data?.content ?? '';
                }
                sections.push(`## Wiki — Top Page (${wiki.name})\n${content || '_No wiki root page found or it is empty._'}\n`);
            } else {
                sections.push(`## Wiki — Top Page\n_No wiki found in project._\n`);
            }
        } catch {
            sections.push(`## Wiki — Top Page\n_Could not fetch wiki root page._\n`);
        }
    }

    // Write file
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, fileName);
    fs.writeFileSync(outPath, sections.join('\n'), 'utf8');

    // Return with meta info
    return {
        name: 'devops-welcome',
        documents: [
            {
                path: path.join(cfg.outDir || 'artifacts/welcome', fileName),
                contentType: 'text/markdown'
            }
        ],
        meta: {
            project: PROJECT,
            repoUsed: defaultRepo ? { id: defaultRepo.id, name: defaultRepo.name } : null,
            wikiUsed,
            includes: {
                description: includeDescription,
                readme: includeReadme,
                wiki: includeWiki
            }
        }
    };
};