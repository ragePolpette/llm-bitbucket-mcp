const PREFIX = "LLM_BB_MCP";

function safeJson(value) {
    try {
        return JSON.stringify(value);
    } catch {
        return JSON.stringify({ error: "serialization_failed" });
    }
}

export function logEvent(event, payload = {}) {
    const timestamp = new Date().toISOString();
    process.stdout.write(`[${PREFIX}] ${timestamp} ${event} ${safeJson(payload)}\n`);
}

export function logApiCall(method, path, tool, phase, payload = {}) {
    const isRead = method === "GET";
    const event = isRead
        ? (phase === "in" ? "query_in" : "query_out")
        : (phase === "in" ? "write_in" : "write_out");

    const fields = { tool, operation: method, ...payload };

    if (phase === "in") {
        if (isRead) {
            fields.query_text = path;
        } else {
            fields.content = path;
        }
    }

    logEvent(event, fields);
}

export function logError(event, error) {
    const timestamp = new Date().toISOString();
    const payload = {
        message: error instanceof Error ? error.message : String(error),
        level: "ERROR"
    };
    if (error instanceof Error && error.status) {
        payload.status = error.status;
    }
    process.stderr.write(`[${PREFIX}] ${timestamp} ${event} ${safeJson(payload)}\n`);
}
