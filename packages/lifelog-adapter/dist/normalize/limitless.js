export function mapLimitlessToEvents(ll) {
    const start = ll.startTime ?? ll.startedAt ?? ll.createdAt ?? ll.updatedAt ?? null;
    const end = ll.endTime ?? ll.endedAt ?? ll.updatedAt ?? ll.createdAt ?? null;
    let duration = null;
    if (start && end) {
        duration = Math.max(0, (new Date(end).getTime() - new Date(start).getTime()) / 1000);
    }
    const text = ll.markdown ?? ll.text ?? null;
    return [{
            id: `limitless:${ll.id}`,
            source: "limitless",
            captured_at: ll.updatedAt || ll.createdAt || start || new Date().toISOString(),
            start,
            end,
            duration_sec: duration,
            type: "transcript",
            text,
            title: ll.title ?? null,
            labels: [],
            entities: [],
            raw: { vendor_payload: ll }
        }];
}
