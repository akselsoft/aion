// scripts/rebuild-from-cache.ts (ESM + TS)
import fs from "fs/promises";
import path from "path";
import { appendFileSync, mkdirSync } from "fs";

function unwrapLimitless(json: any) {
    return json?.data?.lifelog ?? json?.data ?? json;
}

function isoDateOnly(iso: string) {
    return new Date(iso).toISOString().slice(0, 10);
}

async function main() {
    const rawDir = process.argv[2] || "./lifelogs";
    const outDir = process.argv[3] || "./daily";
    const since = process.argv[4]; // optional YYYY-MM-DD
    const until = process.argv[5]; // optional YYYY-MM-DD

    const sinceIso = since ? new Date(`${since}T00:00:00Z`) : null;
    const untilIso = until ? new Date(`${until}T23:59:59.999Z`) : null;

    mkdirSync(outDir, { recursive: true });

    const entries = await fs.readdir(rawDir);
    let read = 0, written = 0, skipped = 0;

    for (const file of entries) {
        if (!file.startsWith("lifelog-") || !file.endsWith(".json")) {
            // ignore date-named or other files
            continue;
        }
        read++;

        const fp = path.join(rawDir, file);
        const raw = JSON.parse(await fs.readFile(fp, "utf8"));
        const lifelog = unwrapLimitless(raw);

        const stampStr: string | undefined =
            lifelog.startTime || lifelog.startTime || lifelog.endTime;
        if (!stampStr) { skipped++; continue; }

        const stamp = new Date(stampStr);
        if (sinceIso && stamp < sinceIso) { skipped++; continue; }
        if (untilIso && stamp > untilIso) { skipped++; continue; }

        // Map to a single transcript event (adjust if you later split segments)
        const start = lifelog.startTime || lifelog.startTime;
        const end = lifelog.endTime || lifelog.endTime || lifelog.startTime;
        const duration =
            start && end ? Math.max(0, (new Date(end).getTime() - new Date(start).getTime()) / 1000) : null;
        const text = lifelog.markdown ?? lifelog.text ?? null;

        const event = {
            id: `limitless:${lifelog.id}`,
            source: "limitless",
            captured_at: lifelog.updatedAt || lifelog.createdAt || new Date().toISOString(),
            start: start ?? null,
            end: end ?? null,
            duration_sec: duration,
            type: "transcript",
            text,
            title: lifelog.title ?? null,
            labels: [],
            entities: [],
            raw: { vendor_payload: lifelog }
        };

        const bucketIso = event.start || event.captured_at || event.end || stampStr;
        const day = isoDateOnly(bucketIso);
        const outPath = path.join(outDir, `${day}.ndjson`);
        appendFileSync(outPath, JSON.stringify(event) + "\n", "utf8");
        written++;
    }

    console.log(`rebuild-from-cache: read=${read} wrote_events=${written} skipped=${skipped}`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});