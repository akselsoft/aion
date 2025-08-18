export type Direction = "asc" | "desc";

export interface LifelogHeader {
    id: string;
    startTime?: string | null;
    endTime?: string | null;
    updatedAt?: string | null;
    title?: string | null;
    markdown?: string | null;
    text?: string | null;
    contents?: unknown;
    // allow passthrough fields
    [k: string]: unknown;
}

export interface ListResponse {
    data?: { lifelogs?: LifelogHeader[] } | null;
    meta?: { lifelogs?: { nextCursor?: string | null } } | null;
    // Some APIs may return arrays at top-level in the future; keep flexible
    [k: string]: unknown;
}

export interface GetByIdResponse {
    data?: { lifelog?: LifelogHeader } | null;
    // or the lifelog object directly
    id?: string;
    [k: string]: unknown;
}

export interface NormalizedEvent {
    id: string;                         // "limitless:<lifelog.id>"
    source: "limitless";
    captured_at: string;                // updatedAt or startTime (ISO)
    start?: string | null;              // startTime (ISO)
    end?: string | null;                // endTime (ISO)
    duration_sec?: number | null;
    type: "transcript";
    title: string | null;
    text: string | null;
    labels: string[];
    entities: Array<Record<string, unknown>>;
    raw: { vendor_payload: any };
}

export interface Window {
    startISO: string; // inclusive
    endISO: string;   // inclusive
}

export interface Config {
    apiKey: string;
    baseUrl?: string;          // default https://api.limitless.ai/v1
    rawDir: string;            // default ./lifelogs
    dailyDir: string;          // default ./daily
    limit: number;             // default 100
    direction: Direction;      // default asc
    defaultDaysBack: number;   // default 5
    cleanDaily: boolean;       // remove target daily files before rebuild
    logDebug: boolean;         // verbose debug
}

export type OutputFormat = "ndjson" | "md";

export interface Config {
    apiKey: string;
    baseUrl?: string;
    rawDir: string;
    dailyDir: string;
    limit: number;
    direction: Direction;
    defaultDaysBack: number;
    cleanDaily: boolean;
    logDebug: boolean;
    outputFormat: OutputFormat;   // NEW
    stripJunk: boolean;           // NEW

    minSectionLines?: number;          // default 2
    minSectionDurationSec?: number;    // default 15
    keepShortIfHasHeading?: boolean;   // default false

    participantsRoster?: string[];      // e.g., ["Andrew","Alex","Pam"]
    speakerMapPath?: string;            // e.g., "./maps/2025-08-11.json"

    coreThreshold?: number;             // default 0.6
    ignoreKeywords?: string[];          // e.g. ["rosie","walk","garage"]
    includeKeywords?: string[];         // e.g. ["cavco","audit","server"]
    workHours?: string | null;          // "09:00-18:00" (UTC) or null
    includeTrivial?: boolean;           // keep low-score sections anyway
    markTrivial?: boolean;              // mark trivial sections when kept
}