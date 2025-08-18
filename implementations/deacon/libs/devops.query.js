const axios = require('axios');
const { BASE_URL, getAuthHeader } = require('./azurefunctions');

async function runWIQL(query) {
    const url = `${BASE_URL.replace(/\/_apis$/, '')}/_apis/wit/wiql?api-version=7.0`;
    const res = await axios.post(url, { query }, getAuthHeader());
    return res.data.workItems.map(w => w.id);
}

module.exports = { runWIQL };