const { listAvailableLoaders } = require('../sourceAdapters');

console.log('Available core source loaders:');
for (const type of listAvailableLoaders()) {
    console.log(`- ${type}`);
}