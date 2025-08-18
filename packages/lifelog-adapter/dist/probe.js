import { getLifelogs } from "./limitlessClient";
import "dotenv/config";
async function probe() {
    const key = (process.env.LIMITLESS_API_KEY || "").trim();
    console.log("[probe] key length:", key.length);
    const page = await getLifelogs({ apiKey: key, since: "2025-04-01T00:00:00Z", limit: 3, direction: "asc", debugDir: "./debug" });
    console.log("[probe] keys present:", Object.keys(page));
    console.log("[probe] lifelogs len:", page?.data?.lifelogs?.length || 0);
    console.log("[probe] first ids:", (page?.data?.lifelogs || []).map((x) => x.id));
}
probe().catch(e => { console.error(e); process.exit(1); });
