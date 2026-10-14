import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import {
    DEFAULT_RETRY_BASE_DELAY_MS,
    DEFAULT_RETRY_MAX_ATTEMPTS,
    DEFAULT_MAX_SESSIONS,
    DEFAULT_PORT,
    DEFAULT_REQUEST_TIMEOUT_MS,
    DEFAULT_SERVER_HOST,
    DEFAULT_SERVER_PATH,
    DEFAULT_SESSION_TTL_MS,
    MAX_RETRY_BASE_DELAY_MS,
    MAX_RETRY_MAX_ATTEMPTS,
    MAX_PORT,
    MAX_REQUEST_TIMEOUT_MS,
    MAX_RESPONSE_BYTES,
    MIN_RETRY_BASE_DELAY_MS,
    MIN_RETRY_MAX_ATTEMPTS,
    MIN_REQUEST_TIMEOUT_MS,
} from "./runtime-policy.js";
import { DEFAULT_ENABLED_WRITE_TOOLS, WRITE_TOOL_NAMES } from "./tool-policy.js";

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
                `The .env file must not contain ${key}: it must only be provided at runtime (for example by the launcher).`,
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
        errors.push(message || `${key} is required.`);
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
        errors.push(`${label || key} must be an integer.`);
        return fallback;
    }
    if (parsed < min || parsed > max) {
        errors.push(`${label || key} must be between ${min} and ${max}.`);
        return fallback;
    }
    return parsed;
}

function readPositiveInt(env, key, { fallback, min = 1, max, errors, label }) {
    return readBoundedInt(env, key, { fallback, min, max, errors, label });
}

function validateServerPath(pathValue, errors) {
    if (!pathValue.startsWith("/")) {
        errors.push("MCP_BB_PATH must start with '/'.");
    }
}

function validateAllowedList(list, key, errors) {
    if (!list.length) {
        errors.push(`${key} must contain at least one value.`);
    }
}

function validateEmail(value, key, errors) {
    if (!value.includes("@")) {
        errors.push(`${key} must be a valid email address.`);
    }
}

function validateInternalApiKey(value, key, errors) {
    if (value && value.length < 16) {
        errors.push(`${key} must be at least 16 characters long.`);
    }
}

function validateEnabledWriteTools(writeTools, errors) {
    for (const toolName of writeTools) {
        if (!WRITE_TOOL_NAMES.has(toolName)) {
            errors.push(
                `MCP_BB_ENABLED_WRITE_TOOLS contains '${toolName}', which is not a supported write tool.`,
            );
        }
    }
}

function validateRepositoryPart(value, key, errors) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value)) {
        errors.push(
            `${key} may only contain letters, digits, _, - or . and must start with a letter or digit.`,
        );
    }
}

function parseRepositories(env, errors) {
    const rawJson = readTrimmed(env, "BITBUCKET_REPOSITORIES_JSON");
    const legacyWorkspace = readTrimmed(env, "BITBUCKET_WORKSPACE", "workspace-slug");
    const legacyRepoSlug = readTrimmed(env, "BITBUCKET_REPO_SLUG", "repo-slug");
    const legacyBranch = readTrimmed(env, "BITBUCKET_DEFAULT_DESTINATION_BRANCH");
    let rawRepositories;

    if (rawJson) {
        try {
            rawRepositories = JSON.parse(rawJson);
        } catch {
            errors.push("BITBUCKET_REPOSITORIES_JSON must be valid JSON.");
            return { repositories: [], defaultRepositoryId: "" };
        }
        if (!Array.isArray(rawRepositories)) {
            errors.push("BITBUCKET_REPOSITORIES_JSON must be an array.");
            return { repositories: [], defaultRepositoryId: "" };
        }
    }
    const useLegacyRepository = !rawJson || rawRepositories.length === 0;
    if (useLegacyRepository) {
        rawRepositories = [
            {
                id: "default",
                displayName: legacyRepoSlug,
                workspace: legacyWorkspace,
                repoSlug: legacyRepoSlug,
                defaultDestinationBranch: legacyBranch,
                status: "active",
                allowMerge: toBool(readTrimmed(env, "BITBUCKET_ALLOW_MERGE"), false),
            },
        ];
    }

    const repositories = [];
    const ids = new Set();
    for (const [index, raw] of rawRepositories.entries()) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
            errors.push(`BITBUCKET_REPOSITORIES_JSON[${index}] must be an object.`);
            continue;
        }
        const id = String(raw.id || "").trim();
        const workspace = String(raw.workspace || "").trim();
        const repoSlug = String(raw.repoSlug || raw.repo_slug || "").trim();
        const status = String(raw.status || "active")
            .trim()
            .toLowerCase();
        if (!id || !workspace || !repoSlug) {
            errors.push(
                `BITBUCKET_REPOSITORIES_JSON[${index}] requires id, workspace and repoSlug.`,
            );
            continue;
        }
        validateRepositoryPart(id, `repository id '${id}'`, errors);
        validateRepositoryPart(workspace, `workspace '${workspace}'`, errors);
        validateRepositoryPart(repoSlug, `repoSlug '${repoSlug}'`, errors);
        if (ids.has(id)) errors.push(`Duplicate repository id: ${id}`);
        if (!new Set(["active", "disabled"]).has(status)) {
            errors.push(`Repository '${id}' must have status active or disabled.`);
        }
        ids.add(id);
        const allowMerge = toBool(raw.allowMerge ?? raw.allow_merge, false);
        repositories.push({
            id,
            displayName: String(raw.displayName || raw.display_name || id).trim() || id,
            workspace,
            repoSlug,
            defaultDestinationBranch: String(
                raw.defaultDestinationBranch || raw.default_destination_branch || "",
            ).trim(),
            status,
            allowMerge,
        });
    }

    const defaultRepositoryId = readTrimmed(
        env,
        "BITBUCKET_DEFAULT_REPOSITORY",
        useLegacyRepository ? "default" : "",
    );
    if (
        defaultRepositoryId &&
        !repositories.some(
            (repository) => repository.id === defaultRepositoryId && repository.status === "active",
        )
    ) {
        errors.push("BITBUCKET_DEFAULT_REPOSITORY must reference a configured active repository.");
    }
    return { repositories, defaultRepositoryId };
}

export function getConfigFromEnv(env = process.env) {
    const localFallback = getLocalHostFallback();
    const errors = [];

    const userEmail = readRequiredTrimmed(
        env,
        "BITBUCKET_USER_EMAIL",
        errors,
        "BITBUCKET_USER_EMAIL is required.",
    );
    const apiToken = readRequiredTrimmed(
        env,
        "BITBUCKET_API_TOKEN",
        errors,
        "BITBUCKET_API_TOKEN is required and must only be provided at runtime.",
    );
    if (userEmail) {
        validateEmail(userEmail, "BITBUCKET_USER_EMAIL", errors);
    }
    if (!userEmail || !apiToken) {
        errors.push(
            "Set BITBUCKET_USER_EMAIL in .env or as an environment variable; pass BITBUCKET_API_TOKEN only at runtime.",
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
    const retryMaxAttempts = readBoundedInt(env, "MCP_BB_RETRY_MAX_ATTEMPTS", {
        fallback: DEFAULT_RETRY_MAX_ATTEMPTS,
        min: MIN_RETRY_MAX_ATTEMPTS,
        max: MAX_RETRY_MAX_ATTEMPTS,
        errors,
        label: "MCP_BB_RETRY_MAX_ATTEMPTS",
    });
    const retryBaseDelayMs = readBoundedInt(env, "MCP_BB_RETRY_BASE_DELAY_MS", {
        fallback: DEFAULT_RETRY_BASE_DELAY_MS,
        min: MIN_RETRY_BASE_DELAY_MS,
        max: MAX_RETRY_BASE_DELAY_MS,
        errors,
        label: "MCP_BB_RETRY_BASE_DELAY_MS",
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
    const enabledWriteTools = parseCsvList(
        env.MCP_BB_ENABLED_WRITE_TOOLS,
        DEFAULT_ENABLED_WRITE_TOOLS,
    );
    const serverPath = readTrimmed(env, "MCP_BB_PATH", DEFAULT_SERVER_PATH) || DEFAULT_SERVER_PATH;
    const internalApiKey = readTrimmed(env, "MCP_BB_INTERNAL_API_KEY");

    validateAllowedList(allowedHosts, "MCP_BB_ALLOWED_HOSTS", errors);
    validateAllowedList(allowedOrigins, "MCP_BB_ALLOWED_ORIGINS", errors);
    validateServerPath(serverPath, errors);
    validateInternalApiKey(internalApiKey, "MCP_BB_INTERNAL_API_KEY", errors);
    validateEnabledWriteTools(enabledWriteTools, errors);
    const repositoryConfig = parseRepositories(env, errors);

    if (errors.length) {
        throw new Error(`Invalid configuration:\n- ${errors.join("\n- ")}`);
    }

    return {
        bitbucket: {
            userEmail,
            apiToken,
            repositories: repositoryConfig.repositories,
            defaultRepositoryId: repositoryConfig.defaultRepositoryId,
            apiBase: "https://api.bitbucket.org",
        },
        requestTimeoutMs,
        retry: {
            maxAttempts: retryMaxAttempts,
            baseDelayMs: retryBaseDelayMs,
        },
        maxResponseBytes: MAX_RESPONSE_BYTES,
        sessionTtlMs,
        maxSessions,
        server: {
            host: readTrimmed(env, "MCP_BB_HOST", DEFAULT_SERVER_HOST) || DEFAULT_SERVER_HOST,
            port,
            path: serverPath,
            sseEnabled: toBool(env.MCP_BB_SSE_ENABLED, false),
            allowedHosts,
            allowedOrigins,
        },
        security: {
            authEnabled: Boolean(internalApiKey),
            internalApiKey,
            enabledWriteTools,
        },
    };
}

export function getConfig() {
    loadDotEnvFromCwd({
        forbiddenKeys: ["BITBUCKET_API_TOKEN", "MCP_BB_INTERNAL_API_KEY"],
    });
    return getConfigFromEnv(process.env);
}
