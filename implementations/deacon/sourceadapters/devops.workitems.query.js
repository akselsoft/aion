// devops.workitems.query.js
const fs = require('fs');
const path = require('path');
const { createProjectClient } = require('../libs/azurefunctions');

// chunk helper for batch detail calls
const chunk = (arr, n) => arr.reduce((a,_,i)=> (i % n ? a : [...a, arr.slice(i, i+n)]), []);

async function wiqlQuery(axios, wiql) {
  const { data } = await axios.post(`wit/wiql?api-version=7.0`, { query: wiql });


  const ids = (data?.workItems || []).map(w => w.id);
  return ids;
}

async function getWorkItems(axios, ids, fields) {
  if (!ids.length) return [];
  const batches = chunk(ids, 200); // ADO batch limit
  const out = [];
  for (const b of batches) {
//    const url = `/_apis/wit/workitemsbatch?api-version=7.0`;
    // Same with workitems batch

    const body = { ids: b, fields, $expand: "None" };
  //   const { data } = await axios.post(url, body);
const { data } = await axios.post(`wit/workitemsbatch?api-version=7.0`, body);
    for (const wi of data?.value || []) out.push(wi);
  }
  return out;
}

module.exports = async function runQueries(projectRoot, cfg = {}, fullConfig) {
  const axios = createProjectClient();
  let queries = cfg.queries || [];
  if (queries.length===0) {
    queries = fullConfig.queries || [];
  }     

  const artifacts = [];

  for (const q of queries) {
    if (q.type !== 'ado.wiql') continue;
    const ids = await wiqlQuery(axios, q.wiql);
    const wis = await getWorkItems(axios, ids, q.fields || []);

    console.log('query:', q.name)
    const outDir = path.join(projectRoot, q.outDir || `artifacts/workitems/${q.name}`);
    fs.mkdirSync(outDir, { recursive: true });

    // normalize minimal records for LLM
    const rows = wis.map(w => ({
      id: w.id,
      title: w.fields?.['System.Title'] || '',
      area: w.fields?.['System.AreaPath'] || '',
      state: w.fields?.['System.State'] || '',
      effort: w.fields?.['Microsoft.VSTS.Scheduling.Effort'] || '',
      priority: w.fields?.['Microsoft.VSTS.Common.Priority'] ?? null,
      tags: (w.fields?.['System.Tags'] || '').split(';').map(t => t.trim()).filter(Boolean)
    }));

    // write JSON + a compact MD table for skim
    const jsonPath = path.join(outDir, `${q.name}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(rows, null, 2));

    const mdHeader = `| Id | Title | Area | State | P | Tags |\n|---:|---|---|---|:-:|---|\n`;
    const mdRows = rows.map(r => `| ${r.id} | ${r.title.replace(/\|/g,'\\|')} | ${r.area} | ${r.state} | ${r.priority ?? ''} | ${r.tags.join(', ')} |`).join('\n');
    const mdPath = path.join(outDir, `${q.name}.md`);
    fs.writeFileSync(mdPath, mdHeader + mdRows);
//        { path: mdPath, contentType: 'text/markdown' ,content: fs.readFileSync(mdPath, 'utf-8') }

    artifacts.push({
      name: q.name,
      prompt: q.prompt || 'Summarize the dataset.',
      documents: [
        { path: jsonPath, contentType: 'application/json' ,content: fs.readFileSync(jsonPath, 'utf-8')}
      ],
      meta: { count: rows.length, type: 'workitems', query: 'wiql' }
    });
  }

  console.log('Query results: ',artifacts.length)

  return {
    name: 'devops.workitems.query',
    type: 'devops.workitems.query',
    prompt: 'Execute configured queries and emit artifacts for responders.',
    documents: [],
    children: artifacts // downstream engines can iterate each child: prompt + docs
  };
};