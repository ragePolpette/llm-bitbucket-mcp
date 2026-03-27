import { timingSafeEqual } from "node:crypto";

export const SERVER_NAME = "llm-bitbucket-mcp";
export const SERVER_VERSION = "1.0.0";
export const DEFAULT_SERVER_HOST = "127.0.0.1";
export const DEFAULT_SERVER_PATH = "/mcp";
export const HEALTH_ENDPOINT = "/health";
export const METRICS_ENDPOINT = "/metrics";
export const MCP_SESSION_HEADER = "mcp-session-id";
export const MCP_API_KEY_HEADER = "x-mcp-api-key";
export const AUTHORIZATION_HEADER = "authorization";
export const JSON_RPC_ERROR_CODE = -32000;
export const CORS_ALLOWED_METHODS = "POST, GET, DELETE, OPTIONS";
export const CORS_ALLOWED_HEADERS =
    `Content-Type, Accept, ${MCP_SESSION_HEADER}, ` +
    `${MCP_API_KEY_HEADER}, ${AUTHORIZATION_HEADER}`;
export const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
export const MIN_REQUEST_TIMEOUT_MS = 5000;
export const MAX_REQUEST_TIMEOUT_MS = 120000;
export const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1000;
export const DEFAULT_MAX_SESSIONS = 100;
export const DEFAULT_PORT = 8783;
export const MAX_PORT = 65535;
export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
export const DEFAULT_RETRY_MAX_ATTEMPTS = 3;
export const MIN_RETRY_MAX_ATTEMPTS = 1;
export const MAX_RETRY_MAX_ATTEMPTS = 5;
export const DEFAULT_RETRY_BASE_DELAY_MS = 250;
export const MIN_RETRY_BASE_DELAY_MS = 50;
export const MAX_RETRY_BASE_DELAY_MS = 5_000;

export function normalizeHeaderValue(rawValue) {
    if (Array.isArray(rawValue)) {
        return typeof rawValue[0] === "string" ? rawValue[0].trim() : "";
    }
    return typeof rawValue === "string" ? rawValue.trim() : "";
}

export function normalizeOrigin(origin) {
    try {
        const parsed = new URL(origin);
        const protocol = parsed.protocol.toLowerCase();
        const host = parsed.hostname.toLowerCase();
        if (!["http:", "https:"].includes(protocol) || !host) {
            return null;
        }
        return parsed.port ? `${protocol}//${host}:${parsed.port}` : `${protocol}//${host}`;
    } catch {
        return null;
    }
}

export function isOriginAllowed(origin, allowedOrigins) {
    const normalizedOrigin = normalizeOrigin(origin);
    if (!normalizedOrigin) {
        return false;
    }

    for (const rawPattern of allowedOrigins) {
        const pattern = String(rawPattern || "")
            .trim()
            .toLowerCase();
        if (!pattern) {
            continue;
        }
        if (pattern === normalizedOrigin) {
            return true;
        }
        if (pattern.endsWith(":*") && normalizedOrigin.startsWith(`${pattern.slice(0, -2)}:`)) {
            return true;
        }
    }

    return false;
}

export function createJsonRpcErrorResponse(message) {
    return {
        jsonrpc: "2.0",
        error: {
            code: JSON_RPC_ERROR_CODE,
            message,
        },
        id: null,
    };
}

export function extractApiKey(headers) {
    const directValue = normalizeHeaderValue(headers[MCP_API_KEY_HEADER]);
    if (directValue) {
        return directValue;
    }

    const authorization = normalizeHeaderValue(headers[AUTHORIZATION_HEADER]);
    if (/^bearer\s+/i.test(authorization)) {
        return authorization.replace(/^bearer\s+/i, "").trim();
    }

    return "";
}

export function safeEqualSecret(expected, received) {
    if (!expected || !received) {
        return false;
    }
    const expectedBuffer = Buffer.from(expected);
    const receivedBuffer = Buffer.from(received);
    if (expectedBuffer.length !== receivedBuffer.length) {
        return false;
    }
    return timingSafeEqual(expectedBuffer, receivedBuffer);
}
