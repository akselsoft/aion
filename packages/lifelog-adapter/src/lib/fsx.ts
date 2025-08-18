import { promises as fs } from "fs";
import * as path from "path";

export async function ensureDir(dir: string) {
    await fs.mkdir(dir, { recursive: true });
}

export async function fileExists(p: string) {
    try { await fs.stat(p); return true; } catch { return false; }
}

export async function writeJsonPretty(p: string, obj: any) {
    await ensureDir(path.dirname(p));
    await fs.writeFile(p, JSON.stringify(obj, null, 2), "utf8");
}

export async function appendNdjsonLine(p: string, obj: any) {
    await ensureDir(path.dirname(p));
    await fs.appendFile(p, JSON.stringify(obj) + "\n", "utf8");
}