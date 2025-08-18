import fs from "fs";
import path from "path";
export function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}
export function isISODateOnly(s) {
    // YYYY-MM-DD
    return /^\d{4}-\d{2}-\d{2}$/.test(s);
}
export function toStartOfDayUTC(dateOnly) {
    return new Date(`${dateOnly}T00:00:00.000Z`).toISOString();
}
export function toEndOfDayUTC(dateOnly) {
    return new Date(`${dateOnly}T23:59:59.999Z`).toISOString();
}
export function parseWindow(start, end, defaultDaysBack = 5) {
    const now = new Date();
    let startISO;
    let endISO;
    if (start || end) {
        if (!start)
            throw new Error("If --end is provided, --start is required.");
        if (!end)
            throw new Error("If --start is provided, --end is required.");
        startISO = isISODateOnly(start) ? toStartOfDayUTC(start) : new Date(start).toISOString();
        endISO = isISODateOnly(end) ? toEndOfDayUTC(end) : new Date(end).toISOString();
        if (isNaN(Date.parse(startISO)) || isNaN(Date.parse(endISO))) {
            throw new Error("Invalid --start or --end date/time.");
        }
    }
    else {
        const past = new Date(now.getTime() - defaultDaysBack * 24 * 60 * 60 * 1000);
        startISO = new Date(Date.UTC(past.getUTCFullYear(), past.getUTCMonth(), past.getUTCDate(), 0, 0, 0, 0)).toISOString();
        endISO = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999)).toISOString();
    }
    if (new Date(startISO) > new Date(endISO)) {
        throw new Error("Window invalid: start is after end.");
    }
    return { startISO, endISO };
}
export function fileExists(p) {
    try {
        fs.accessSync(p, fs.constants.F_OK);
        return true;
    }
    catch {
        return false;
    }
}
export function readJSONSafe(p) {
    try {
        const txt = fs.readFileSync(p, "utf-8");
        return JSON.parse(txt);
    }
    catch (e) {
        return null;
    }
}
export function writeJSONPretty(p, data) {
    fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}
export function atomicWrite(p, content) {
    const dir = path.dirname(p);
    const tmp = path.join(dir, `.tmp-${Date.now()}-${path.basename(p)}`);
    fs.writeFileSync(tmp, content, "utf-8");
    fs.renameSync(tmp, p);
}
export function ymdFromISO(iso) {
    if (!iso)
        return null;
    const d = new Date(iso);
    if (isNaN(d.getTime()))
        return null;
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}
export function withinWindow(iso, win) {
    if (!iso)
        return false;
    const t = new Date(iso).getTime();
    return t >= new Date(win.startISO).getTime() && t <= new Date(win.endISO).getTime();
}
export function loadSpeakerMap(p) {
    if (!p)
        return {};
    try {
        return JSON.parse(fs.readFileSync(p, "utf8"));
    }
    catch {
        return {};
    }
}
