import fs from "fs";
import path from "path";
import { LimitlessClient } from "./api.js";
import { Config, LifelogHeader, Window } from "./types.js";
import { ensureDir, fileExists, readJSONSafe, writeJSONPretty, atomicWrite } from "./util.js";
import { toEvent, bucketDay, lifelogWithinWindow } from "./normalize.js";
import { renderDayMarkdown } from "./markdown.js";
// src/builder.ts
import { loadSpeakerMap } from "./util.js";

export async function runPipeline(cfg: Config, win: Window) {
    ensureDir(cfg.rawDir);
    ensureDir(cfg.dailyDir);

    console.log(`[info] window start=${win.startISO} end=${win.endISO}`);
    console.log(`[info] paging limit=${cfg.limit} direction=${cfg.direction}`);

    const client = new LimitlessClient(cfg.apiKey, cfg.baseUrl);

    // 1) Page
    let cursor: string | undefined;
    let pages = 0;
    let items: LifelogHeader[] = [];
    do {
        const params: any = { limit: cfg.limit, direction: cfg.direction };
        if (cursor) params.cursor = cursor; else { params.start = win.startISO; params.end = win.endISO; }
        const resp = await client.listLifelogs(params);
        const arr = resp?.data?.lifelogs ?? [];
        const next = resp?.meta?.lifelogs?.nextCursor ?? null;

        if (cfg.logDebug) {
            const first = arr[0]?.startTime;
            const last = arr[arr.length - 1]?.startTime;
            console.log(`[debug] page=${pages + 1} count=${arr.length} first=${first} last=${last} nextCursor=${next}`);
        }
        items.push(...arr);
        pages++;
        cursor = next ?? undefined;
    } while (cursor);

    console.log(`[info] pages=${pages} items=${items.length}`);

    // 2) Cache raw per ID
    let hits = 0, downloads = 0;
    const seen = new Set<string>();
    for (const it of items) {
        const id = it.id;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const rawPath = path.join(cfg.rawDir, `lifelog-${id}.json`);
        if (fileExists(rawPath)) { hits++; continue; }
        const full = await client.getLifelogById(id);
        writeJSONPretty(rawPath, full);
        downloads++;
    }
    console.log(`[info] cache: hits=${hits} downloads=${downloads}`);

    // 3) Build from cache
    const files = fs.readdirSync(cfg.rawDir)
        .filter(f => /^lifelog-[\w\-\.:]+\.json$/.test(f))
        .map(f => path.join(cfg.rawDir, f));

    let malformed = 0;

    if (cfg.outputFormat === "ndjson") {
        // existing behavior
        const bucket: Map<string, string[]> = new Map();
        for (const p of files) {
            const json = readJSONSafe<any>(p);
            if (!json) { malformed++; continue; }
            const lifelog: LifelogHeader = (json?.data?.lifelog ?? json) as LifelogHeader;
            if (!lifelog?.id) { malformed++; continue; }
            if (!lifelogWithinWindow(lifelog, win)) continue;
            const ev = toEvent(lifelog);
            const day = bucketDay(ev, lifelog);
            if (!day) { malformed++; continue; }
            const line = JSON.stringify(ev);
            if (!bucket.has(day)) bucket.set(day, []);
            bucket.get(day)!.push(line);
        }

        const days = Array.from(bucket.keys()).sort();
        if (cfg.cleanDaily) {
            for (const day of days) {
                const out = path.join(cfg.dailyDir, `${day}.ndjson`);
                if (fileExists(out)) fs.rmSync(out);
            }
        }

        let filesWritten = 0;
        for (const day of days) {
            const out = path.join(cfg.dailyDir, `${day}.ndjson`);
            const content = bucket.get(day)!.join("\n") + "\n";
            atomicWrite(out, content);
            filesWritten++;
        }
        console.log(`[info] daily: files_written=${filesWritten}`);
        if (malformed > 0) console.warn(`[warn] skipped malformed/corrupt files: ${malformed}`);
        return;
    }

    // Markdown mode
    const byDay: Map<string, LifelogHeader[]> = new Map();
    for (const p of files) {
        const json = readJSONSafe<any>(p);
        if (!json) { malformed++; continue; }
        const lifelog: LifelogHeader = (json?.data?.lifelog ?? json) as LifelogHeader;
        if (!lifelog?.id) { malformed++; continue; }
        if (!lifelogWithinWindow(lifelog, win)) continue;

        // Use same day-bucketing basis as NDJSON (start → end → updatedAt)
        const ev = toEvent(lifelog);
        const day = bucketDay(ev, lifelog);
        if (!day) { malformed++; continue; }

        if (!byDay.has(day)) byDay.set(day, []);
        byDay.get(day)!.push(lifelog);
    }

    const days = Array.from(byDay.keys()).sort();
    if (cfg.cleanDaily) {
        for (const day of days) {
            const out = path.join(cfg.dailyDir, `${day}.md`);
            if (fileExists(out)) fs.rmSync(out);
        }
    }

    let filesWritten = 0;
    for (const day of days) {
        const out = path.join(cfg.dailyDir, `${day}.md`);
        const speakerMap = loadSpeakerMap(cfg.speakerMapPath);

        const md = renderDayMarkdown(day, byDay.get(day)!, cfg.stripJunk, {
            minLines: cfg.minSectionLines,
            minSec: cfg.minSectionDurationSec,
            keepShortIfHasHeading: cfg.keepShortIfHasHeading,
            roster: cfg.participantsRoster,
            speakerMap,
            debug: cfg.logDebug,
            // NEW:
            coreThreshold: cfg.coreThreshold,
            ignoreKeywords: cfg.ignoreKeywords,
            includeKeywords: cfg.includeKeywords,
            workHours: cfg.workHours ?? null,
            includeTrivial: cfg.includeTrivial,
            markTrivial: cfg.markTrivial
        });
        if (!md.trim()) continue; // no sections survived → nothing to write

        atomicWrite(out, md.endsWith("\n") ? md : md + "\n");
        filesWritten++;
    }

    console.log(`[info] daily(md): files_written=${filesWritten}`);
    if (malformed > 0) console.warn(`[warn] skipped malformed/corrupt files: ${malformed}`);
}