const JUNK_WORDS = new Set([
    "ok", "okay", "k", "kk", "yup", "yep", "ya", "yeah", "yuh", "uh-huh", "mm-hmm", "hmm", "huh",
    "right", "sure", "cool", "nice", "great", "fine", "alright", "y", "nope", "nah", "wow", "lol",
    "thanks", "thank you", "great.", "okay.", "sure.", "yeah.", "ok.", "yep.", "no.", "no",
    "uh", "um", "er", "hmm."
]);
function parseWorkHours(s) {
    if (!s)
        return null;
    const m = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(s.trim());
    if (!m)
        return null;
    const [, sh, sm, eh, em] = m.map(Number);
    return { start: sh * 60 + sm, end: eh * 60 + em };
}
function minutesUTC(iso) {
    if (!iso)
        return null;
    const d = new Date(iso);
    return d.getUTCHours() * 60 + d.getUTCMinutes();
}
function tokenize(s) { return s.toLowerCase().match(/[a-z0-9@#._-]+/g) ?? []; }
function hasNumber(s) { return /\d/.test(s); }
function questionDensity(lines) { return lines.filter(x => x.includes("?")).length / Math.max(1, lines.length); }
function scoreSection(title, convoKept, durationSec, uniqueSpeakers, opts) {
    const reasons = [];
    let score = 0;
    // Base features
    const dur = Math.min(durationSec, 1800) / 1800; // up to 30min → 1.0
    if (dur > 0.15)
        score += dur * 0.35;
    else
        score += dur * 0.20;
    const lpm = durationSec > 0 ? (convoKept.length / (durationSec / 60)) : convoKept.length;
    const density = Math.min(lpm / 6, 1); // ≥6 lines/min saturates
    score += density * 0.20;
    if (uniqueSpeakers.length >= 2) {
        score += 0.10;
        reasons.push("≥2 speakers");
    }
    // Text-based signals
    const allText = [title, ...convoKept.map(c => c.content ?? "")].join(" ");
    const toks = tokenize(allText);
    const qden = questionDensity(convoKept.map(c => c.content ?? ""));
    score += Math.min(qden * 2, 1) * 0.10; // many questions → more “discussion”
    if (toks.some(hasNumber)) {
        score += 0.05;
        reasons.push("numbers present");
    }
    const includeKeywords = (opts?.includeKeywords ?? []);
    const ignoreKeywords = (opts?.ignoreKeywords ?? []);
    const includes = includeKeywords.filter(k => toks.includes(k));
    const ignores = ignoreKeywords.filter(k => toks.includes(k));
    if (includes.length) {
        score += Math.min(0.2, includes.length * 0.05);
        reasons.push(`keywords: ${includes.join(",")}`);
    }
    // Penalties
    if (ignores.length) {
        score -= Math.min(0.25, ignores.length * 0.06);
        reasons.push(`ignored: ${ignores.join(",")}`);
    }
    // Work hours bias (UTC)
    const wh = parseWorkHours(opts.workHours ?? null);
    if (wh) {
        const mins = minutesUTC(opts.startTime);
        if (mins != null) {
            const inWin = mins >= wh.start && mins <= wh.end;
            if (inWin) {
                score += 0.05;
                reasons.push("work hours");
            }
            else {
                score -= 0.05;
                reasons.push("off hours");
            }
        }
    }
    // Safety clamp
    score = Math.max(0, Math.min(1, score));
    // Trivial if very short OR very low density after penalties
    const trivial = (durationSec < 30 && convoKept.length < 3) || score < 0.5;
    return { score, reasons, trivial };
}
function wordCount(s) {
    return s.trim().split(/\s+/).filter(Boolean).length;
}
function looksLikeJunk(s) {
    const t = s.trim().toLowerCase().replace(/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g, "");
    if (!t)
        return true;
    // <=3 words and in common acknowledgments or short expletive
    if (wordCount(t) <= 3) {
        if (JUNK_WORDS.has(t))
            return true;
        if (/^\*{0,2}sh?t$/.test(t) || /^damn$/.test(t))
            return true;
    }
    return false;
}
function byStart(a, b) {
    const ta = a ? Date.parse(a) : NaN;
    const tb = b ? Date.parse(b) : NaN;
    if (isNaN(ta) && isNaN(tb))
        return 0;
    if (isNaN(ta))
        return 1;
    if (isNaN(tb))
        return -1;
    return ta - tb;
}
function fmtTime(iso) {
    if (!iso)
        return null;
    const d = new Date(iso);
    if (isNaN(d.getTime()))
        return null;
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const mm = String(d.getUTCMinutes()).padStart(2, "0");
    return { ymd: `${y}-${m}-${day}`, hm: `${hh}:${mm}` };
}
export function renderDayMarkdown(day, lifelogs, stripJunk, opts) {
    const minLines = opts?.minLines ?? 2;
    const minSec = opts?.minSec ?? 15;
    const keepShortIfHasHeading = opts?.keepShortIfHasHeading ?? false;
    const sorted = [...lifelogs].sort((a, b) => byStart(a.startTime, b.startTime));
    const lines = [];
    lines.push(`# ${day}`);
    lines.push("");
    for (const ll of sorted) {
        // headings
        const contents = ll?.contents;
        const h1 = contents?.find(c => c.type === "heading1")?.content?.trim();
        const h2 = contents?.find(c => c.type === "heading2")?.content?.trim();
        // conversation items (after junk filtering)
        const convoAll = (contents ?? [])
            .filter(c => c.type === "blockquote" && (c.content ?? "").trim().length > 0)
            .sort((a, b) => byStart(a.startTime ?? null, b.startTime ?? null));
        const convoKept = [];
        let removed = 0;
        for (const c of convoAll) {
            const text = (c.content ?? "").trim();
            if (!text)
                continue;
            if (stripJunk && looksLikeJunk(text)) {
                removed++;
                continue;
            }
            convoKept.push(c);
        }
        // duration (sec)
        let durationSec = 0;
        if (ll.startTime && ll.endTime) {
            const ms = Date.parse(ll.endTime) - Date.parse(ll.startTime);
            if (!isNaN(ms) && ms > 0)
                durationSec = Math.round(ms / 1000);
        }
        // SHORT-SECTION FILTER:
        // If both duration and kept line count are below thresholds AND no override via headings → skip
        const hasAnyHeading = !!(h1 || h2);
        if (durationSec < minSec && convoKept.length < minLines && !(keepShortIfHasHeading && hasAnyHeading)) {
            continue; // skip this lifelog section entirely
        }
        // Collect unique speakers (order of first appearance)
        const uniqueSpeakers = [];
        for (const c of convoKept) {
            const who = (c.speakerName ?? "Unknown").trim();
            if (who && !uniqueSpeakers.includes(who))
                uniqueSpeakers.push(who);
        }
        // ----- render section -----
        const title = (ll.title ?? "Untitled").trim();
        const stFmt = fmtTime(ll.startTime);
        const st = stFmt?.hm || "";
        let dur = "";
        if (durationSec > 0) {
            const m = Math.floor(durationSec / 60);
            const s = durationSec % 60;
            dur = ` • ${m}:${String(s).padStart(2, "0")}`;
        }
        lines.push(`## ${st || "??:??"} — ${title}${dur}`);
        lines.push("");
        if (h1 !== title) {
            if (h1)
                lines.push(`**Heading1:** ${h1}`);
        }
        if (h2)
            lines.push(`**Heading2:** ${h2}`);
        if (h1 || h2)
            lines.push("");
        // show number of speakers in the console
        console.log(`[info] speakers: ${uniqueSpeakers.length}`);
        // NEW: show speakers
        if (uniqueSpeakers.length) {
            lines.push(`_Speakers: ${uniqueSpeakers.join(", ")}_`);
            lines.push("");
        }
        if (convoKept.length) {
            lines.push(`**Conversation:**`);
            for (const c of convoKept) {
                const who = (c.speakerName ?? "Unknown").trim();
                const text = (c.content ?? "").trim().replace(/"/g, '\\"');
                lines.push(`- ${who}: "${text}"`);
            }
            if (removed > 0)
                lines.push(`_(${removed} short acknowledgments removed)_`);
            lines.push("");
        }
        else {
            // If no conversation lines kept, but we passed the keep rule (probably due to headings)
            if (!h1 && !h2) {
                // nothing meaningful to render – skip after all
                lines.pop(); // remove blank
                lines.pop(); // remove header
            }
        }
    }
    return lines.join("\n");
}
