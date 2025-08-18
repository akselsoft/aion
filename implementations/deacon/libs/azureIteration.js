// deacon/libs/azureIteration.js

require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const ORG = process.env.AZURE_ORG;
const PROJECT = process.env.AZURE_PROJECT;
const TEAM = process.env.AZURE_TEAM;
const PAT = process.env.AZURE_PAT;

const BASE_URL = `https://dev.azure.com/${ORG}/${PROJECT}/${TEAM}/_apis`;
const authHeader = {
    headers: {
        'Authorization': `Basic ${Buffer.from(':' + PAT).toString('base64')}`,
        'Content-Type': 'application/json'
    }
};

async function saveAllIterationsToFile(filepath = 'deacon/artifacts/allIterations.json') {
    const all = await getAllIterations();
    fs.mkdirSync(path.dirname(filepath), { recursive: true });
    fs.writeFileSync(filepath, JSON.stringify(all, null, 2), 'utf-8');
    console.log(`✅ Saved all iteration metadata to ${filepath}`);
}

/**
 * Fetches the current iteration from Azure DevOps.
 * @returns {Promise<Object>} Iteration object with id, name, path, attributes
 */
async function getCurrentIteration() {
    const url = `${BASE_URL}/work/teamsettings/iterations?api-version=7.0`;
    const res = await axios.get(url, authHeader);
    const current = res.data.value.find(iter => iter.attributes.timeFrame === 'current');
    if (!current) throw new Error("No current iteration found.");
    return current;
}

/**
 * Gets all iterations (past, current, future).
 * @returns {Promise<Object[]>} List of iteration objects
 */
async function getAllIterations() {
    const url = `${BASE_URL}/work/teamsettings/iterations?api-version=7.0`;
    const res = await axios.get(url, authHeader);
    return res.data.value;
}
/**
 * Fetches team capacity data for a given iteration ID.
 * @param {string} iterationId
 * @returns {Promise<Object[]>} Capacity details per team member
 */
async function getCapacityForIteration(iterationId) {
    const url = `${BASE_URL}/work/teamsettings/iterations/${iterationId}/capacities?api-version=7.1-preview.1`;
    const res = await axios.get(url, authHeader);
    return res.data.value || [];
}

const API_VERSION = '7.1-preview.1'; // Adjust if needed

function isFutureIteration(iteration) {
    const now = new Date();
    const start = new Date(iteration.attributes?.startDate);
    return start > now;
}

async function getPullRequestsForIteration(iteration) {
    const status = iteration.attributes.timeFrame === 'future' ? 'active' : 'completed';
    const url = `${BASE_URL.replace(`/${TEAM}`, '')}/git/pullrequests?searchCriteria.status=${status}&$top=100&api-version=7.0`;
    const res = await axios.get(url, authHeader);
    return res.data.value || [];
}

async function getPullRequests(iteration) {
    const future = isFutureIteration(iteration);
    const status = future ? 'active' : 'completed';
    const url = `${BASE_URL.replace(`/${TEAM}`, '')}/git/pullrequests?searchCriteria.status=${status}&$top=50&api-version=${API_VERSION}`;

    console.log(`Fetching pull requests for ${iteration.name} [${status}] → ${url}`);
    const res = await axios.get(url, authHeader);
    let pullRequests = res.data.value || [];

    if (future) {
        pullRequests = pullRequests.filter(pr => pr.isDraft || pr.status === 'active');
    }

    for (const pr of pullRequests) {
        pr._deaconContext = future ? 'future-draft-or-active' : 'past-completed';
    }

    return pullRequests;
}
module.exports = {
    getCurrentIteration,
    getAllIterations,
    getCapacityForIteration,
    saveAllIterationsToFile,
    getPullRequests,
    getPullRequestsForIteration
};