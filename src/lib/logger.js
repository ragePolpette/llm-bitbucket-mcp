import { AsyncLocalStorage } from "node:async_hooks";

const PREFIX = "LLM_BB_MCP";
const LOG_LEVELS = {
    silent: -1,
    error: 0,
    warn: 1,
    info: 2,
};
const requestContext = new AsyncLocalStorage();

function detectDefaultLogLevel() {
    const runningNodeTests = process.execArgv.includes("--test") || process.argv.includes("--test");
    return runningNodeTests ? "warn" : "info";
}

function getCurrentLogLevel() {
    const configured = String(process.env.LLM_BB_MCP_LOG_LEVEL || "")
        .trim()
        .toLowerCase();
    if (configured in LOG_LEVELS) {
        return configured;
    }
    return detectDefaultLogLevel();
}

function shouldLog(level) {
    return LOG_LEVELS[level] <= LOG_LEVELS[getCurrentLogLevel()];
}

function safeJson(value) {
    try {
        return JSON.stringify(value);
    } catch {
        return JSON.stringify({ error: "serialization_failed" });
    }
}

function withContext(payload = {}) {
    const context = requestContext.getStore();
    if (!context) return payload;
    return {
        request_id: context.requestId,
        session_id: context.sessionId || null,
        method: context.method,
        path: context.path,
        ...payload,
    };
}

export function runWithLogContext(context, fn) {
    return requestContext.run(context, fn);
}

export function logEvent(event, payload = {}, { level = "info" } = {}) {
    if (!shouldLog(level)) {
        return;
    }
    const timestamp = new Date().toISOString();
    const finalPayload = withContext({
        level: level.toUpperCase(),
        ...payload,
    });
    process.stdout.write(`[${PREFIX}] ${timestamp} ${event} ${safeJson(finalPayload)}\n`);
}

export function logApiCall(method, path, tool, phase, payload = {}) {
    const isRead = method === "GET";
    const event = isRead
        ? phase === "in"
            ? "query_in"
            : "query_out"
        : phase === "in"
          ? "write_in"
          : "write_out";

    const fields = { tool, operation: method, ...payload };

    if (phase === "in") {
        if (isRead) {
            fields.query_text = path;
        } else {
            fields.content = path;
        }
    }

    logEvent(event, fields, { level: "info" });
}

export function logWarn(event, payload = {}) {
    logEvent(event, payload, { level: "warn" });
}

export function logInfo(event, payload = {}) {
    logEvent(event, payload, { level: "info" });
}

export function logError(event, error, payload = {}) {
    if (!shouldLog("error")) {
        return;
    }
    const timestamp = new Date().toISOString();
    const finalPayload = withContext({
        message: error instanceof Error ? error.message : String(error),
        level: "ERROR",
        ...payload,
    });
    if (error instanceof Error && error.status) {
        finalPayload.status = error.status;
    }
    process.stderr.write(`[${PREFIX}] ${timestamp} ${event} ${safeJson(finalPayload)}\n`);
}
