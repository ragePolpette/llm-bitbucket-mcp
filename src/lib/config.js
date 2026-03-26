import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
const MIN_REQUEST_TIMEOUT_MS = 5000;
const MAX_REQUEST_TIMEOUT_MS = 120000;
const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1000;
const DEFAULT_MAX_SESSIONS = 100;
const DEFAULT_PORT = 8783;
const MAX_PORT = 65535;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

function toBool(value, fallback = false) {
    if (value === undefined || value === null || value === "") return fallback;
    return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function parseCsvList(value, fallback) {
    if (value === undefined || value === null || value === "") return [...fallback];
    const list = String(value)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    return list.length ? uniqueLower(list) : [...fallback];
}

function uniqueLower(items) {
    const seen = new Set();
    const out = [];
    for (const item of items) {
        const raw = String(item || "").trim();
        if (!raw) continue;
        const lower = raw.toLowerCase();
        if (seen.has(lower)) continue;
        seen.add(lower);
        out.push(lower);
    }
    return out;
}

function getLocalHostFallback() {
    const hostname = String(os.hostname() || "")
        .trim()
        .toLowerCase();
    const hostCandidates = uniqueLower(["localhost", "127.0.0.1", "[::1]", hostname]);
    const originCandidates = [];
    for (const host of hostCandidates) {
        if (!host || host === "[::1]") continue;
        originCandidates.push(`http://${host}:*`, `https://${host}:*`);
    }
    return { allowedHosts: hostCandidates, allowedOrigins: uniqueLower(originCandidates) };
}

let envLoaded = false;

function loadDotEnvFromCwd({ forbiddenKeys = [] } = {}) {
    if (envLoaded) return;
    envLoaded = true;

    const forbidden = new Set(
        forbiddenKeys
            .map((key) =>
                String(key || "")
                    .trim()
                    .toLowerCase(),
            )
            .filter(Boolean),
    );

    const envPath = path.resolve(process.cwd(), ".env");
    if (!fs.existsSync(envPath)) return;

    const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
    for (const rawLine of lines) {
        const line = String(rawLine || "").trim();
        if (!line || line.startsWith("#")) continue;
        const idx = line.indexOf("=");
        if (idx <= 0) continue;

        const key = line.slice(0, idx).trim();
        if (forbidden.has(key.toLowerCase())) {
            throw new Error(
                `Il file .env non puo' contenere ${key}: deve essere fornito solo a runtime (es. dalla dashboard).`,
            );
        }

        let value = line.slice(idx + 1);
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        if (!Object.prototype.hasOwnProperty.call(process.env, key) || process.env[key] === "") {
            process.env[key] = value;
        }
    }
}

function readTrimmed(env, key, fallback = "") {
    return String(env[key] ?? fallback).trim();
}

function readRequiredTrimmed(env, key, errors, message) {
    const value = readTrimmed(env, key);
    if (!value) {
        errors.push(message || `${key} e' obbligatorio.`);
    }
    return value;
}

function readBoundedInt(env, key, { fallback, min, max, errors, label }) {
    const raw = env[key];
    if (raw === undefined || raw === null || raw === "") {
        return fallback;
    }

    const parsed = Number(raw);
    if (!Number.isInteger(parsed)) {
        errors.push(`${label || key} deve essere un intero.`);
        return fallback;
    }
    if (parsed < min || parsed > max) {
        errors.push(`${label || key} deve essere compreso tra ${min} e ${max}.`);
        return fallback;
    }
    return parsed;
}

function readPositiveInt(env, key, { fallback, min = 1, max, errors, label }) {
    return readBoundedInt(env, key, { fallback, min, max, errors, label });
}

function validateServerPath(pathValue, errors) {
    if (!pathValue.startsWith("/")) {
        errors.push("MCP_BB_PATH deve iniziare con '/'.");
    }
}

function validateAllowedList(list, key, errors) {
    if (!list.length) {
        errors.push(`${key} deve contenere almeno un valore.`);
    }
}

function validateEmail(value, key, errors) {
    if (!value.includes("@")) {
        errors.push(`${key} deve essere un indirizzo email valido.`);
    }
}

export function getConfigFromEnv(env = process.env) {
    const localFallback = getLocalHostFallback();
    const errors = [];

    const userEmail = readRequiredTrimmed(
        env,
        "BITBUCKET_USER_EMAIL",
        errors,
        "BITBUCKET_USER_EMAIL e' obbligatorio.",
    );
    const apiToken = readRequiredTrimmed(
        env,
        "BITBUCKET_API_TOKEN",
        errors,
        "BITBUCKET_API_TOKEN e' obbligatorio e deve essere fornito solo a runtime.",
    );
    if (userEmail) {
        validateEmail(userEmail, "BITBUCKET_USER_EMAIL", errors);
    }
    if (!userEmail || !apiToken) {
        errors.push(
            "BITBUCKET_USER_EMAIL va inserito nel .env o come env var; BITBUCKET_API_TOKEN va passato solo a runtime.",
        );
    }

    const sessionTtlMs = readBoundedInt(env, "MCP_BB_SESSION_TTL_MS", {
        fallback: DEFAULT_SESSION_TTL_MS,
        min: 60000,
        max: 24 * 60 * 60 * 1000,
        errors,
        label: "MCP_BB_SESSION_TTL_MS",
    });
    const maxSessions = readPositiveInt(env, "MCP_BB_MAX_SESSIONS", {
        fallback: DEFAULT_MAX_SESSIONS,
        min: 1,
        max: 1000,
        errors,
        label: "MCP_BB_MAX_SESSIONS",
    });
    const requestTimeoutMs = readBoundedInt(env, "MCP_BB_REQUEST_TIMEOUT_MS", {
        fallback: DEFAULT_REQUEST_TIMEOUT_MS,
        min: MIN_REQUEST_TIMEOUT_MS,
        max: MAX_REQUEST_TIMEOUT_MS,
        errors,
        label: "MCP_BB_REQUEST_TIMEOUT_MS",
    });
    const port = readPositiveInt(env, "MCP_BB_PORT", {
        fallback: DEFAULT_PORT,
        min: 1,
        max: MAX_PORT,
        errors,
        label: "MCP_BB_PORT",
    });

    const allowedHosts = parseCsvList(env.MCP_BB_ALLOWED_HOSTS, localFallback.allowedHosts);
    const allowedOrigins = parseCsvList(env.MCP_BB_ALLOWED_ORIGINS, localFallback.allowedOrigins);
    const serverPath = readTrimmed(env, "MCP_BB_PATH", "/mcp") || "/mcp";

    validateAllowedList(allowedHosts, "MCP_BB_ALLOWED_HOSTS", errors);
    validateAllowedList(allowedOrigins, "MCP_BB_ALLOWED_ORIGINS", errors);
    validateServerPath(serverPath, errors);

    if (errors.length) {
        throw new Error(`Configurazione non valida:\n- ${errors.join("\n- ")}`);
    }

    return {
        bitbucket: {
            userEmail,
            apiToken,
            workspace: readTrimmed(env, "BITBUCKET_WORKSPACE", "studioboost"),
            repoSlug: readTrimmed(env, "BITBUCKET_REPO_SLUG", "bpopilot"),
            defaultDestinationBranch: readTrimmed(env, "BITBUCKET_DEFAULT_DESTINATION_BRANCH"),
            apiBase: "https://api.bitbucket.org",
        },
        requestTimeoutMs,
        maxResponseBytes: MAX_RESPONSE_BYTES,
        sessionTtlMs,
        maxSessions,
        server: {
            host: readTrimmed(env, "MCP_BB_HOST", "127.0.0.1") || "127.0.0.1",
            port,
            path: serverPath,
            sseEnabled: toBool(env.MCP_BB_SSE_ENABLED, false),
            allowedHosts,
            allowedOrigins,
        },
    };
}

export function getConfig() {
    loadDotEnvFromCwd({
        forbiddenKeys: ["BITBUCKET_API_TOKEN"],
    });
    return getConfigFromEnv(process.env);
}
