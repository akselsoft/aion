// packages/lifelog-adapter-ts/src/limitlessClient.ts
import { promises as fs } from "fs";
import * as path from "path";
const BASE = "https://api.limitless.ai/v1";
export async function getLifelogs(p) {
    const { apiKey, start, end, date, timezone, limit = 100, direction = "asc", cursor, debugDir } = p;
    const url = new URL(`${BASE}/lifelogs`);
    if (start)
        url.searchParams.set("start", start);
    if (end)
        url.searchParams.set("end", end);
    if (date)
        url.searchParams.set("date", date);
    if (timezone)
        url.searchParams.set("timezone", timezone);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("direction", direction);
    if (cursor)
        url.searchParams.set("cursor", cursor);
    console.log("GET", url.toString());
    const res = await fetch(url, { headers: { "x-api-key": apiKey, Accept: "application/json" } });
    const text = await res.text();
    if (debugDir) {
        await fs.mkdir(debugDir, { recursive: true });
        const fname = cursor ? `lifelogs.page.${Date.now()}.json` : `lifelogs.first.json`;
        await fs.writeFile(path.join(debugDir, fname), text, "utf8");
    }
    if (!res.ok)
        throw new Error(`getLifelogs failed: ${res.status} ${text}`);
    let json;
    try {
        json = JSON.parse(text);
    }
    catch (e) {
        throw new Error(`getLifelogs JSON parse error: ${e}`);
    }
    const lifelogs = Array.isArray(json?.data?.lifelogs) ? json.data.lifelogs : [];
    const nextCursor = json?.meta?.lifelogs?.nextCursor ?? null;
    // normalized shape: keep items + expose cursor under meta
    return { data: { lifelogs }, meta: { lifelogs: { nextCursor } } };
}
export async function getLifelog(params) {
    const { apiKey, id, debugDir } = params;
    const url = `${BASE}/lifelogs/${encodeURIComponent(id)}`;
    const res = await fetch(url, { headers: { "x-api-key": apiKey, Accept: "application/json" } });
    const text = await res.text();
    if (debugDir) {
        await fs.mkdir(debugDir, { recursive: true });
        await fs.writeFile(path.join(debugDir, `lifelog.${id}.json`), text, "utf8");
    }
    if (!res.ok)
        throw new Error(`getLifelog failed: ${res.status} ${text}`);
    let json;
    try {
        json = JSON.parse(text);
    }
    catch (e) {
        throw new Error(`getLifelog JSON parse error: ${e}`);
    }
    return json?.data?.lifelog ?? json; // unwrap
}
