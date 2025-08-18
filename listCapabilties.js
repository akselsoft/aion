const { scanCapabilities } = require('./core/utils/capabilityScanner');

const results = scanCapabilities();
console.log('\n🧠 AION IMPLEMENTATION CAPABILITIES:\n');

for (const entry of results) {
    if (entry.error) {
        console.log(`❌ ${entry.implementation}: ${entry.error}`);
    } else {
        console.log(`🧩 ${entry.implementation} [${entry.tier}]${entry.character ? ' – ' + entry.character : ''}`);
        if (entry.capabilities.length > 0) {
            entry.capabilities.forEach(c => console.log(`   - ${c}`));
        } else {
            console.log(`   (no capabilities defined)`);
        }
    }
}