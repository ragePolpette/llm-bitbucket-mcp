export const SERVER_NAME = "llm-bitbucket-mcp";
export const SERVER_VERSION = "1.0.0";
export const DEFAULT_SERVER_HOST = "127.0.0.1";
export const DEFAULT_SERVER_PATH = "/mcp";
export const HEALTH_ENDPOINT = "/health";
export const MCP_SESSION_HEADER = "mcp-session-id";
export const JSON_RPC_ERROR_CODE = -32000;
export const CORS_ALLOWED_METHODS = "POST, GET, DELETE, OPTIONS";
export const CORS_ALLOWED_HEADERS = `Content-Type, Accept, ${MCP_SESSION_HEADER}`;
export const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
export const MIN_REQUEST_TIMEOUT_MS = 5000;
export const MAX_REQUEST_TIMEOUT_MS = 120000;
export const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1000;
export const DEFAULT_MAX_SESSIONS = 100;
export const DEFAULT_PORT = 8783;
export const MAX_PORT = 65535;
export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

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
