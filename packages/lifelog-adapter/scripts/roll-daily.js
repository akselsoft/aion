// scripts/roll-daily.ts (ESM + TS)
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import readline from "readline";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function fileExists(p: string) {
    try { await fsp.stat(p); return true; } catch { return false; }
}

async function convertOne(ndjsonPath: string, outPath: string) {
    await fsp.mkdir(path.dirname(outPath), { recursive: true });
    const events: any[] = [];

    // stream lines to avoid loading whole file
    const stream = fs.createReadStream(ndjsonPath);
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of rl) {
        if (!line.trim()) continue;
        events.push(JSON.parse(line));
    }

    const date = path.basename(ndjsonPath, ".ndjson");
    await fsp.writeFile(outPath, JSON.stringify({ date, events }, null, 2), "utf8");
    console.log(`wrote ${outPath} (${events.length} events)`);
}

async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
    let lastErr: any;
    for (let i = 0; i < tries; i++) {
        try { return await fn(); } catch (e) {
            lastErr = e;
            // backoff a bit
            await new Promise(r => setTimeout(r, 300 * (i + 1)));
        }
    }
    throw lastErr;
}

async function main() {
    const ndjsonDir = process.argv[2] || path.resolve(__dirname, "../daily");
    const outDir = process.argv[3] || path.resolve(__dirname, "../artifacts/lifelog");

    if (!(await fileExists(ndjsonDir))) {
        console.error(`No such input dir: ${ndjsonDir}`);
        process.exit(1);
    }
    await fsp.mkdir(outDir, { recursive: true });

    const files = await fsp.readdir(ndjsonDir);
    const ndjsons = files.filter(f => f.endsWith(".ndjson"));
    if (ndjsons.length === 0) {
        console.log(`No .ndjson files in ${ndjsonDir}`);
        return;
    }

    for (const file of ndjsons) {
        const inPath = path.join(ndjsonDir, file);
        const outPath = path.join(outDir, `${path.basename(file, ".ndjson")}.json`);
        await withRetry(() => convertOne(inPath, outPath));
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});