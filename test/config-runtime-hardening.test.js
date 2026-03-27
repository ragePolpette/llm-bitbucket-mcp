import test from "node:test";
import assert from "node:assert/strict";

import { getConfigFromEnv } from "../src/lib/config.js";
import { buildHealthPayload } from "../src/lib/health.js";
import { DEFAULT_SERVER_PATH, SERVER_NAME } from "../src/lib/runtime-policy.js";
import { createSessionStore, SessionStoreCapacityError } from "../src/lib/session-store.js";

function createValidEnv(overrides = {}) {
    return {
        BITBUCKET_USER_EMAIL: "dev@example.com",
        BITBUCKET_API_TOKEN: "runtime-token",
        ...overrides,
    };
}

test("getConfigFromEnv applies safe runtime defaults", () => {
    const config = getConfigFromEnv(createValidEnv());

    assert.equal(config.sessionTtlMs, 30 * 60 * 1000);
    assert.equal(config.maxSessions, 100);
    assert.equal(config.requestTimeoutMs, 30000);
    assert.equal(config.retry.maxAttempts, 3);
    assert.equal(config.retry.baseDelayMs, 250);
    assert.equal(config.server.path, DEFAULT_SERVER_PATH);
    assert.equal(config.security.authEnabled, false);
    assert.deepEqual(config.security.enabledWriteTools, [
        "add_pull_request_comment",
        "create_pull_request",
        "open_pull_request",
    ]);
});

test("getConfigFromEnv reports aggregated validation errors", () => {
    assert.throws(
        () =>
            getConfigFromEnv({
                BITBUCKET_USER_EMAIL: "not-an-email",
                MCP_BB_PORT: "70000",
                MCP_BB_PATH: "mcp",
                MCP_BB_SESSION_TTL_MS: "500",
                MCP_BB_MAX_SESSIONS: "0",
                MCP_BB_RETRY_MAX_ATTEMPTS: "0",
                MCP_BB_RETRY_BASE_DELAY_MS: "25",
                MCP_BB_ALLOWED_HOSTS: "",
                MCP_BB_ALLOWED_ORIGINS: "",
                MCP_BB_INTERNAL_API_KEY: "short",
                MCP_BB_ENABLED_WRITE_TOOLS: "merge_pull_request",
            }),
        /Configurazione non valida:/,
    );
});

test("session store enforces configured capacity", () => {
    const sessions = createSessionStore({ ttlMs: 60_000, maxSessions: 1 });
    sessions.set("one", {});

    assert.throws(() => sessions.set("two", {}), SessionStoreCapacityError);
});

test("session store prunes expired entries before applying capacity", () => {
    const now = Date.now();
    const sessions = createSessionStore({ ttlMs: 60_000, maxSessions: 1 });
    sessions.set("one", {}, now);

    sessions.set("two", {}, now + 61_000);

    assert.equal(sessions.size(now + 61_000), 1);
    assert.equal(sessions.get("one", now + 61_000), null);
    assert.deepEqual(sessions.get("two", now + 61_000), {});
});

test("session access extends the TTL window", () => {
    const now = Date.now();
    const sessions = createSessionStore({ ttlMs: 60_000, maxSessions: 2 });
    const transport = { id: "transport" };

    sessions.set("one", transport, now);
    assert.deepEqual(sessions.get("one", now + 30_000), transport);
    assert.equal(sessions.get("one", now + 89_000), transport);
    assert.equal(sessions.get("one", now + 151_000), null);
});

test("health payload is minimal and runtime-oriented", () => {
    const payload = buildHealthPayload({
        endpoint: "/mcp",
        sessions: { size: () => 3 },
        uptimeSec: 42,
    });

    assert.deepEqual(payload, {
        status: "ok",
        server: SERVER_NAME,
        endpoint: "/mcp",
        uptimeSec: 42,
        activeSessions: 3,
    });
});
