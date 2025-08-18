// implementations/deacon/sourceAdapters/devops.pullrequests.delta.js
const fs = require('fs');
const path = require('path');
const { createProjectClient } = require('../libs/azurefunctions');

async function getPRIterations(axios, repoId, prId) {
  const { data } = await axios.get(
    `/git/repositories/${encodeURIComponent(repoId)}/pullRequests/${prId}/iterations?api-version=7.0`
  );
  return Array.isArray(data?.value) ? data.value : [];
}

/**
 * Get file changes for a specific PR iteration.
 * Azure DevOps returns a diff vs target; we convert to a sorted list of file paths.
 */
async function getPRIterationChanges(axios, repoId, prId, iterationId) {
  const { data } = await axios.get(
    `/git/repositories/${encodeURIComponent(repoId)}/pullRequests/${prId}/iterations/${iterationId}/changes?api-version=7.0`
  );
  
  const changes = Array.isArray(data?.changeEntries) ? data.changeEntries : [];
  const files = new Set();
  for (const ch of changes) {
    const p = (ch?.item?.path || '').replace(/^\/+/, '');
    console.log(p)
    if (!p || ch?.item?.isFolder) continue;
    files.add(p);
  }
  return Array.from(files).sort();
}

/**
 * (Optional) Get the commits for a specific PR iteration.
 * Handy if you want to do commit-level attribution; not required if you stick to iteration-level.
 */
async function getPRIterationCommits(axios, repoId, prId, iterationId) {
  const { data } = await axios.get(
    `/git/repositories/${encodeURIComponent(repoId)}/pullRequests/${prId}/iterations/${iterationId}/commits?api-version=7.0`
  );
  return Array.isArray(data?.value) ? data.value : [];
}
// helper: get latest iteration id for a PR
async function getLatestIterationId(axios, repoId, prId) {
  const { data } = await axios.get(
    `/git/repositories/${encodeURIComponent(repoId)}/pullRequests/${prId}/iterations?api-version=7.0`
  );
  const iters = Array.isArray(data?.value) ? data.value : [];
  if (!iters.length) return null;
  // iterations are 1..N; pick max id
  return iters.reduce((max, it) => Math.max(max, it.id), 0);
}

// helper: get changed files for a given iteration (overall delta)
async function getIterationChangedFiles(axios, repoId, prId, iterationId) {
  if (!iterationId) return { filesAll: [] };
  const { data } = await axios.get(
    `/git/repositories/${encodeURIComponent(repoId)}/pullRequests/${prId}/iterations/${iterationId}/changes?api-version=7.0`
  );
  const changes = Array.isArray(data?.changes) ? data.changes : [];
  const files = new Set();
  for (const ch of changes) {
    const item = ch?.item;
    const p = (item?.path || '').replace(/^\/+/, '');
    if (!p || item?.isFolder) continue;
    files.add(p);
  }
  return { filesAll: Array.from(files).sort() };
}

async function isMergeCommit(axios, repoId, commitId) {
  const { data: commitDetail } = await axios.get(
    `/git/repositories/${encodeURIComponent(repoId)}/commits/${encodeURIComponent(commitId)}?api-version=7.0`
  );
  const parents = commitDetail.parents || [];
  return Array.isArray(parents) && parents.length > 1;
}

module.exports = async function loadPRDeltas(projectRoot, cfg = {}) {
    const axios = createProjectClient();
    const outDir = path.join(projectRoot, cfg.outDir || 'artifacts/prs');
    fs.mkdirSync(outDir, { recursive: true });

    // --- date filters ---
    const windowDays = cfg.windowDays ?? 60; // last two months by default
    const sinceDate = cfg.sinceDate || new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
    const untilDate = cfg.untilDate || new Date().toISOString();

    console.log(`📊 [deacon] Loading PR deltas from ${windowDays} - ${sinceDate} to ${untilDate}`);

    // pull active + completed, then filter to date window (creation/closed)
    const maxPRs = cfg.maxPRs ?? 500;
    const repoQ = cfg.repoId ? `&searchCriteria.repositoryId=${encodeURIComponent(cfg.repoId)}` : '';
    const calls = [];
    if (cfg.includeActive ?? true)
        calls.push(axios.get(`/git/pullrequests?searchCriteria.status=active${repoQ}&$top=${maxPRs}&api-version=7.0`));
    if (cfg.includeCompleted ?? true)
        calls.push(axios.get(`/git/pullrequests?searchCriteria.status=completed${repoQ}&$top=${maxPRs}&api-version=7.0`));

    const listRes = await Promise.all(calls);
    const all = listRes.flatMap(r => r.data?.value || []);

    const inWindow = (pr) => {
        const created = new Date(pr.creationDate).toISOString();
        const closed = pr.closedDate ? new Date(pr.closedDate).toISOString() : null;
        // include if created OR closed intersects [since, until]
        return (created >= sinceDate && created <= untilDate) ||
            (closed && closed >= sinceDate && closed <= untilDate);
    };

    const prs = all.filter(inWindow);

    console.log('Only looking at PRs in the date window:', prs.length);

    const rollup = [];

for (const pr of prs) {
  const repoId = pr.repository.id;
  const prDir = path.join(outDir, String(pr.pullRequestId));
  fs.mkdirSync(prDir, { recursive: true });

  console.log('looking at PR', pr.pullRequestId);

  // 🔹 Get all PR iterations
  const iterations = await getPRIterations(axios, repoId, pr.pullRequestId);
  const mergeIters = iterations.filter(it => it.mergeCommitId);
  const workIters  = (cfg.ignoreMergeIterations
    ? iterations.filter(it => !it.mergeCommitId)
    : iterations);

  let filesAll = new Set();
  const authoredFiles = new Set();
  const mergeFiles = new Set();

  // log number of iterations being reviewed
  console.log(`🔍 [deacon] Reviewing ${workIters.length} of ${iterations.length} iterations for PR ${pr.pullRequestId}`);

  // 🔹 Gather files from non-merge iterations
  for (const it of workIters) {
    // console.log(`iteration `,it)
    const iterFiles = await getPRIterationChanges(axios, repoId, pr.pullRequestId, it.id);
    console.log(`🔍 [deacon] Found ${iterFiles.length} file changes in iteration ${it.id} for PR ${pr.pullRequestId}`);
    iterFiles.forEach(f => {
        console.log(f);
      filesAll.add(f);
      authoredFiles.add(f);
    });
  }

  // 🔹 Optionally include merge iteration files
  if (!cfg.ignoreMergeIterations) {
    for (const it of mergeIters) {
      const iterFiles = await getPRIterationChanges(axios, repoId, pr.pullRequestId, it.id);
      iterFiles.forEach(f => {
        filesAll.add(f);
        mergeFiles.add(f);
      });
    }
  }

  // 🔹 Finalize arrays
  const filesAuthored  = Array.from(authoredFiles).sort();
  const filesMergeOnly = Array.from([...mergeFiles].filter(f => !authoredFiles.has(f))).sort();
  const filesAllArr    = Array.from(filesAll).sort();

  // 🔹 Optional warning if ignoring merges but they exist
  if (mergeIters.length && cfg.ignoreMergeIterations) {
    console.warn(`[prs] PR ${pr.pullRequestId}: merge iterations present but ignored.`);
  }

  // 🔹 Write summary
  const summary = {
    id: pr.pullRequestId,
    repoId: pr.repository?.id,
    repoName: pr.repository?.name,
    status: pr.status,
    title: pr.title,
    createdBy: pr.createdBy?.displayName || 'Unknown',
    creationDate: pr.creationDate,
    closedDate: pr.closedDate || null,
    filesAll: filesAllArr,
    filesAuthored,
    filesMergeOnly
  };

  fs.writeFileSync(path.join(prDir, 'pr.json'), JSON.stringify(summary, null, 2));
  rollup.push(summary);

}
    // ---------- build & write MD summary ----------

// 1) PRs broken down by status
const statusCounts = { active: 0, completed: 0, other: 0 };
for (const pr of rollup) {
  const s = String(pr.status || '').toLowerCase();
  if (s === 'active') statusCounts.active++;
  else if (s === 'completed') statusCounts.completed++;
  else statusCounts.other++;
}

// 2) Total number of unique files updated (overall PR footprint)
//    -> union of filesAll across PRs
const allFilesUnion = new Set();
for (const pr of rollup) {
  for (const f of (pr.filesAll || [])) allFilesUnion.add(f);
}

// 3) Files modified by multiple PRs (use actively changed files)
//    -> collisions based on filesAuthored
const fileToPRsAuthored = new Map(); // file -> Set(PR ids)
for (const pr of rollup) {
  const id = pr.id;
  for (const f of (pr.filesAuthored || [])) {
    if (!fileToPRsAuthored.has(f)) fileToPRsAuthored.set(f, new Set());
    fileToPRsAuthored.get(f).add(id);
  }
}
const multiTouched = Array.from(fileToPRsAuthored.entries())
  .filter(([, set]) => set.size > 1)
  .map(([file, set]) => ({ file, prIds: Array.from(set).sort((a, b) => a - b) }))
  .sort((a, b) => (b.prIds.length - a.prIds.length) || a.file.localeCompare(b.file));

// 4) PRs broken down by person (active/completed/other)
const byPerson = new Map(); // name -> { active, completed, other, total }
for (const pr of rollup) {
  const who = (pr.createdBy || 'Unknown').trim() || 'Unknown';
  if (!byPerson.has(who)) byPerson.set(who, { active: 0, completed: 0, other: 0, total: 0 });
  const rec = byPerson.get(who);
  const s = String(pr.status || '').toLowerCase();
  if (s === 'active') rec.active++;
  else if (s === 'completed') rec.completed++;
  else rec.other++;
  rec.total++;
}

const peopleRows = Array.from(byPerson.entries())
  .sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]))
  .map(([name, r]) => `| ${name} | ${r.active} | ${r.completed} | ${r.other} | ${r.total} |`)
  .join('\n');

const multiFilesSection = multiTouched.length
  ? multiTouched.map(m => `- \`${m.file}\` — PRs: ${m.prIds.join(', ')}`).join('\n')
  : '_None in this window._';

const md = `# Pull Requests — Delta Summary

**Window:** ${sinceDate} → ${untilDate}  
**Generated:** ${new Date().toISOString()}  
**Total PRs in window:** ${rollup.length}

## 1) PRs by Status
- Active: **${statusCounts.active}**
- Completed: **${statusCounts.completed}**${statusCounts.other ? `\n- Other: **${statusCounts.other}**` : ''}

## 2) Total Unique Files Updated (overall)
**${allFilesUnion.size}** file(s)

## 3) Files Modified by Multiple PRs (Actively Changed Only)
${multiFilesSection}

## 4) PRs by Person (Open/Completed/Other)
| Person | Active | Completed | Other | Total |
|---|---:|---:|---:|---:|
${peopleRows}
`;

const mdPath = path.join(outDir, 'prs-summary.md');
fs.writeFileSync(mdPath, md);
    // Return both artifacts so downstream engines can pick them up
    return {
        name: 'devops-pullrequests',
        type: cfg.type ? cfg.type : 'devops.pullrequests.delta',
        prompt: `Summarize pull request activity during the current iteration.`,
        documents: [
            { path: path.join(cfg.outDir || 'artifacts/prs', 'prs-summary.json'), contentType: 'application/json' },
            { path: path.join(cfg.outDir || 'artifacts/prs', 'prs-summary.md'), contentType: 'text/markdown' }
        ]
    };
};