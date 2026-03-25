import path from "node:path";
import os from "node:os";
import fs from "node:fs";

function toInt(value, fallback) {
    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? fallback : parsed;
}

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

export function resolveCloneRoot(rawValue, cwd = process.cwd()) {
    const configured = String(rawValue || "").trim();
    if (!configured) {
        return path.resolve(cwd, "_clones");
    }
    return path.resolve(configured);
}

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

export function getConfig() {
    loadDotEnvFromCwd({
        forbiddenKeys: ["BITBUCKET_API_TOKEN"],
    });
    const localFallback = getLocalHostFallback();

    const userEmail = String(process.env.BITBUCKET_USER_EMAIL || "").trim();
    const apiToken = String(process.env.BITBUCKET_API_TOKEN || "").trim();
    if (!userEmail || !apiToken) {
        throw new Error(
            "BITBUCKET_USER_EMAIL e BITBUCKET_API_TOKEN sono obbligatori.\n" +
                "  - BITBUCKET_USER_EMAIL: inserisci nel .env o come env var.\n" +
                "  - BITBUCKET_API_TOKEN: deve essere fornito solo a runtime (mai nel .env). Usa la dashboard.",
        );
    }

    return {
        bitbucket: {
            userEmail,
            apiToken,
            workspace: String(process.env.BITBUCKET_WORKSPACE || "studioboost").trim(),
            repoSlug: String(process.env.BITBUCKET_REPO_SLUG || "bpopilot").trim(),
            defaultDestinationBranch: String(
                process.env.BITBUCKET_DEFAULT_DESTINATION_BRANCH || "",
            ).trim(),
            apiBase: "https://api.bitbucket.org",
        },
        requestTimeoutMs: Math.max(
            5000,
            Math.min(toInt(process.env.MCP_BB_REQUEST_TIMEOUT_MS, 30000), 120000),
        ),
        maxResponseBytes: 5 * 1024 * 1024,
        sessionTtlMs: Math.max(0, toInt(process.env.MCP_BB_SESSION_TTL_MS, 0)),
        cloneRoot: resolveCloneRoot(process.env.MCP_BB_CLONE_ROOT),
        server: {
            host: process.env.MCP_BB_HOST || "127.0.0.1",
            port: Math.max(1, Math.min(toInt(process.env.MCP_BB_PORT, 8783), 65535)),
            path: process.env.MCP_BB_PATH || "/mcp",
            sseEnabled: toBool(process.env.MCP_BB_SSE_ENABLED, false),
            allowedHosts: parseCsvList(
                process.env.MCP_BB_ALLOWED_HOSTS,
                localFallback.allowedHosts,
            ),
            allowedOrigins: parseCsvList(
                process.env.MCP_BB_ALLOWED_ORIGINS,
                localFallback.allowedOrigins,
            ),
        },
    };
}
