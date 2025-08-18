import axios from "axios";
export class LimitlessClient {
    apiKey;
    http;
    constructor(apiKey, baseUrl = "https://api.limitless.ai/v1") {
        this.apiKey = apiKey;
        if (!apiKey)
            throw new Error("Missing LIMITLESS_API_KEY.");
        this.http = axios.create({
            baseURL: baseUrl,
            headers: { "x-api-key": apiKey }
        });
    }
    async listLifelogs(params) {
        try {
            const res = await this.http.get("/lifelogs", { params });
            return res.data;
        }
        catch (err) {
            const status = err?.response?.status;
            const body = JSON.stringify(err?.response?.data)?.slice(0, 500);
            throw new Error(`List lifelogs failed (${status}): ${body}`);
        }
    }
    async getLifelogById(id) {
        try {
            const res = await this.http.get(`/lifelogs/${encodeURIComponent(id)}`);
            const data = res.data;
            return data?.data?.lifelog ?? data;
        }
        catch (err) {
            const status = err?.response?.status;
            const body = JSON.stringify(err?.response?.data)?.slice(0, 500);
            throw new Error(`Get lifelog ${id} failed (${status}): ${body}`);
        }
    }
}
