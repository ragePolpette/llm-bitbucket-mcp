export function buildHealthPayload({ endpoint, sessions, uptimeSec }) {
    return {
        status: "ok",
        server: "llm-bitbucket-mcp",
        endpoint,
        uptimeSec,
        activeSessions: sessions.size(),
    };
}
