import { SERVER_NAME } from "./runtime-policy.js";

export function buildHealthPayload({ endpoint, sessions, uptimeSec }) {
    return {
        status: "ok",
        server: SERVER_NAME,
        endpoint,
        uptimeSec,
        activeSessions: sessions.size(),
    };
}
