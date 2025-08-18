import { withinWindow, ymdFromISO } from "./util.js";
function pickText(x) {
    const m = x?.markdown ?? null;
    const t = x?.text ?? null;
    return (typeof m === "string" && m.length ? m : null) ?? (typeof t === "string" && t.length ? t : null);
}
export function toEvent(l) {
    const start = l.startTime ?? null;
    const end = l.endTime ?? null;
    const captured = l.updatedAt ?? start ?? end ?? null;
    let duration_sec = null;
    if (start && end) {
        const ms = new Date(end).getTime() - new Date(start).getTime();
        if (!isNaN(ms))
            duration_sec = Math.max(0, Math.round(ms / 1000));
    }
    return {
        id: `limitless:${l.id}`,
        source: "limitless",
        captured_at: captured ?? new Date().toISOString(),
        start,
        end,
        duration_sec,
        type: "transcript",
        title: (l.title ?? null),
        text: pickText(l),
        labels: [],
        entities: [],
        raw: { vendor_payload: l }
    };
}
// Day bucketing per spec
export function bucketDay(ev, lifelog) {
    const first = ymdFromISO(ev.start ?? lifelog.startTime) ??
        ymdFromISO(ev.end ?? lifelog.endTime) ??
        ymdFromISO(lifelog.updatedAt);
    return first;
}
// Filtering per spec
export function lifelogWithinWindow(l, win) {
    const candidates = [l.startTime, l.endTime, l.updatedAt];
    for (const c of candidates) {
        if (c && withinWindow(c, win))
            return true;
    }
    return false;
}
