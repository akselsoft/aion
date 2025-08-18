require('dotenv').config();
const axios = require('axios');

const ORG = process.env.AZURE_ORG;
const PROJECT = process.env.AZURE_PROJECT;
const TEAM = process.env.AZURE_TEAM;
const PAT = process.env.AZURE_PAT;

const BASE_URL = `https://dev.azure.com/${ORG}/${PROJECT}/${TEAM}/_apis`;

if (!ORG || !PROJECT || !PAT) {
    throw new Error('Missing AZURE_ORG / AZURE_PROJECT / AZURE_PAT in env');
}

// Team-scoped base (Boards, Iterations, Work items under team context)
const TEAM_BASE = `https://dev.azure.com/${ORG}/${PROJECT}/${TEAM}/_apis`;

// Project-scoped base (Wikis, Git/PRs, Repos, Build, etc.)
const PROJECT_BASE = `https://dev.azure.com/${ORG}/${PROJECT}/_apis`;

function getAuthHeader() {
    return {
        headers: {
            Authorization: `Basic ${Buffer.from(':' + PAT).toString('base64')}`,
            'Content-Type': 'application/json'
        }
    };
}

function createTeamClient() {
    return axios.create({ baseURL: TEAM_BASE, ...getAuthHeader() });
}

function createProjectClient() {
    return axios.create({ baseURL: PROJECT_BASE, ...getAuthHeader() });
}

// Convenience: project wiki repo URL for git clone/pull
function wikiGitUrl(projectName = PROJECT) {
    return `https://dev.azure.com/${ORG}/${PROJECT}/_git/${projectName}.wiki`;
}

// Utility you already had
function isWorkItemCompleted(item) {
    const doneStates = ['Closed', 'Resolved', 'Done', 'Removed'];
    return doneStates.includes(item.fields?.['System.State']);
}

module.exports = {
    ORG, PROJECT, TEAM, PAT,
    TEAM_BASE, PROJECT_BASE, BASE_URL,
    getAuthHeader,
    createTeamClient,
    createProjectClient,
    wikiGitUrl,
    isWorkItemCompleted
};