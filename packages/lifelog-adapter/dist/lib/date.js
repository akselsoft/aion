export function isoDateOnly(iso) {
    if (!iso)
        return new Date().toISOString().slice(0, 10);
    return new Date(iso).toISOString().slice(0, 10);
}
export function daysAgoIso(days) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString();
}
