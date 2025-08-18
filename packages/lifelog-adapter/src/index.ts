#!/usr/bin/env node
import yargs from "yargs";
// Node 19 friendly: no helpers import
import { parseWindow } from "./util.js";
import { runPipeline } from "./builder.js";
import { Config } from "./types.js";
import path from "path";

const argv = await yargs(process.argv.slice(2))
    .scriptName("lifelog-pull")
    .usage("$0 [options]")
    .option("start", { type: "string", describe: "Inclusive start (ISO or YYYY-MM-DD)" })
    .option("end", { type: "string", describe: "Inclusive end (ISO or YYYY-MM-DD)" })
    .option("raw", { type: "string", default: "./lifelogs", describe: "Raw cache directory" })
    .option("daily", { type: "string", default: "./daily", describe: "Daily output directory" })
    .option("limit", { type: "number", default: 100, describe: "Page size limit" })
    .option("direction", { type: "string", choices: ["asc", "desc"], default: "asc", describe: "Paging direction" })
    .option("days", { type: "number", default: 5, describe: "Default days back if no window provided" })
    .option("clean", { type: "boolean", default: true, describe: "Clean affected daily files before rebuild" })
    .option("debug", { type: "boolean", default: false, describe: "Verbose paging logs" })
    .option("format", { type: "string", choices: ["ndjson", "md"], default: "ndjson", describe: "daily output format" })
    .option("strip-junk", { type: "boolean", default: true, describe: "Strip short interjections from transcripts" })
    .option("min-lines", { type: "number", default: 4, describe: "Minimum kept lines to keep a section (md)" })
    .option("min-sec", { type: "number", default: 15, describe: "Minimum duration (sec) to keep a section (md)" })
    .option("keep-short-if-heading", { type: "boolean", default: false, describe: "Keep short sections if they have headings" })
    .help()
    .strict()
    .parse();

const apiKey = process.env.LIMITLESS_API_KEY || "";
if (!apiKey) {
    console.error("ERROR: Missing LIMITLESS_API_KEY environment variable.");
    process.exit(1);
}

const cfg: Config = {
    apiKey,
    rawDir: path.resolve(argv.raw!),
    dailyDir: path.resolve(argv.daily!),
    limit: argv.limit!,
    direction: argv.direction as any,
    defaultDaysBack: argv.days!,
    cleanDaily: argv.clean!,
    logDebug: argv.debug!,
    baseUrl: "https://api.limitless.ai/v1",
    outputFormat: argv.format as any,
    stripJunk: argv.stripJunk!,
    minSectionLines: argv.minLines!,
    minSectionDurationSec: argv.minSec!,
    keepShortIfHasHeading: argv.keepShortIfHeading!,
    coreThreshold: 0.6,
    ignoreKeywords: ["rosie", "dog", "walk", "garage", "chipmunk"],
    includeKeywords: [],
    workHours: "09:00-18:00",
    includeTrivial: false,
    markTrivial: true,
    participantsRoster: undefined,
    speakerMapPath: undefined,
};

(async () => {
    try {
        const win = parseWindow(argv.start as any, argv.end as any, cfg.defaultDaysBack);
        await runPipeline(cfg, win);
    } catch (err: any) {
        console.error(`ERROR: ${err?.message ?? err}`);
        process.exit(1);
    }
})();