import * as path from "path";
import { promises as fs } from "fs";
import dotenv from "dotenv";
import { ensureDir, fileExists, writeJsonPretty, appendNdjsonLine } from "../lib/fsx";
import { daysAgoIso, isoDateOnly } from "../lib/date";
import { getLifelogs, getLifelog } from "../limitlessClient";
import { mapLimitlessToEvents } from "../normalize/limitless";
dotenv.config();
function pickStamp(obj) {
    // Prefer actual start time, then end, then fallbacks
    return (obj.startTime ??
        obj.startedAt ??
        obj.endTime ??
        obj.endedAt ??
        obj.createdAt ??
        obj.updatedAt);
}
const DEBUG = process.env.DEBUG === "1";
function unwrapLimitless(json) {
    return json?.data?.lifelog ?? json?.data ?? json;
}
export async function runLimitlessAdapter(cfg) {
    const apiKey = (process.env.LIMITLESS_API_KEY || "").trim();
    if (!apiKey)
        throw new Error("Missing LIMITLESS_API_KEY in environment.");
    const rawDir = path.resolve(cfg.location || "./lifelogs");
    const outDir = path.resolve(cfg.output || "./daily");
    await ensureDir(rawDir);
    await ensureDir(outDir);
    console.log(' since ', cfg.since, ' until ', cfg.until);
    const sinceIso = cfg.since ? new Date(cfg.since).toISOString() : daysAgoIso(cfg.days ?? 5);
    const untilIso = cfg.until ? new Date(cfg.until).toISOString() : undefined;
    const direction = cfg.since && cfg.until ? "asc" : "desc";
    if (DEBUG)
        console.log("[adapter] window", { sinceIso, untilIso, direction, rawDir, outDir });
    // 1) List + filter
    const idSet = new Set();
    const allHeaders = [];
    let sinceCursor = sinceIso; // start from requested since
    const hardStop = untilIso ? new Date(untilIso) : null;
    let pages = 0, listed = 0;
    let cursor;
    while (true) {
        const page = await getLifelogs({
            apiKey,
            start: cfg.since ? new Date(cfg.since).toISOString() : undefined,
            end: cfg.until ? new Date(cfg.until).toISOString() : undefined,
            direction: "asc", // start→end
            limit: cfg.pageSize ?? 100,
            cursor,
            debugDir: cfg.debugDir
        });
        const items = page.data.lifelogs;
        // collect IDs…
        for (const item of items) {
            allHeaders.push({ id: item.id, createdAt: item.createdAt, updatedAt: item.updatedAt });
        }
        const next = page.meta.lifelogs.nextCursor || undefined;
        if (!next || items.length === 0)
            break;
        cursor = next;
    }
    console.log(`[adapter] pages=${pages} listed=${listed} kept=${allHeaders.length}`);
    // 2) Cache raw by ID
    let downloads = 0, cacheHits = 0;
    for (const h of allHeaders) {
        const rawPath = path.join(rawDir, `lifelog-${h.id}.json`);
        if (await fileExists(rawPath)) {
            // console.log(`[adapter] cache hit for id=${h.id}`);
            if (DEBUG)
                console.log("[adapter] cache file exists:", rawPath);
            cacheHits++;
            continue;
        }
        const full = await getLifelog({ apiKey, id: h.id });
        await writeJsonPretty(rawPath, full);
        downloads++;
    }
    console.log(`[adapter] cacheHits=${cacheHits} downloads=${downloads}`);
    // 3) Build daily NDJSON from cache (same window)
    const entries = await fs.readdir(rawDir);
    if (DEBUG)
        console.log("[adapter] raw entries", entries.length);
    let written = 0, skippedNoTime = 0, readCount = 0;
    for (const file of entries) {
        if (!file.startsWith("lifelog-") || !file.endsWith(".json"))
            continue;
        readCount++;
        const fp = path.join(rawDir, file);
        const raw = JSON.parse(await fs.readFile(fp, "utf8"));
        const lifelog = unwrapLimitless(raw);
        const stampStr = pickStamp(lifelog);
        if (!stampStr)
            continue;
        const stamp = new Date(stampStr);
        if (sinceIso && stamp < new Date(sinceIso))
            continue;
        if (untilIso && stamp > new Date(untilIso))
            continue;
        const events = mapLimitlessToEvents(lifelog);
        for (const ev of events) {
            const bucketIso = ev.start ||
                lifelog.startTime || // strong fallback
                ev.captured_at ||
                ev.end ||
                lifelog.endTime ||
                stampStr;
            const day = isoDateOnly(bucketIso);
            const dayOut = path.join(outDir, `${day}.ndjson`);
            await appendNdjsonLine(dayOut, ev);
            written++;
        }
    }
    console.log(`[adapter] cache files read=${readCount} events written=${written} skippedNoTime=${skippedNoTime}`);
}
