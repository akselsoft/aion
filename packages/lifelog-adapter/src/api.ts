import axios, { AxiosInstance } from "axios";
import { Direction, GetByIdResponse, ListResponse } from "./types.js";

export class LimitlessClient {
    private http: AxiosInstance;

    constructor(private apiKey: string, baseUrl = "https://api.limitless.ai/v1") {
        if (!apiKey) throw new Error("Missing LIMITLESS_API_KEY.");
        this.http = axios.create({
            baseURL: baseUrl,
            headers: { "x-api-key": apiKey }
        });
    }

    async listLifelogs(params: {
        start?: string;
        end?: string;
        direction?: Direction;
        limit?: number;
        cursor?: string;
    }): Promise<ListResponse> {
        try {
            const res = await this.http.get("/lifelogs", { params });
            return res.data as ListResponse;
        } catch (err: any) {
            const status = err?.response?.status;
            const body = JSON.stringify(err?.response?.data)?.slice(0, 500);
            throw new Error(`List lifelogs failed (${status}): ${body}`);
        }
    }

    async getLifelogById(id: string): Promise<any> {
        try {
            const res = await this.http.get(`/lifelogs/${encodeURIComponent(id)}`);
            const data = res.data as GetByIdResponse;
            return (data?.data as any)?.lifelog ?? data;
        } catch (err: any) {
            const status = err?.response?.status;
            const body = JSON.stringify(err?.response?.data)?.slice(0, 500);
            throw new Error(`Get lifelog ${id} failed (${status}): ${body}`);
        }
    }
}