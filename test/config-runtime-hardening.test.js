import test from "node:test";
import assert from "node:assert/strict";

import { getConfigFromEnv } from "../src/lib/config.js";
import { buildHealthPayload } from "../src/lib/health.js";
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
    assert.equal(config.server.path, "/mcp");
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
                MCP_BB_ALLOWED_HOSTS: "",
                MCP_BB_ALLOWED_ORIGINS: "",
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

test("health payload is minimal and runtime-oriented", () => {
    const payload = buildHealthPayload({
        endpoint: "/mcp",
        sessions: { size: () => 3 },
        uptimeSec: 42,
    });

    assert.deepEqual(payload, {
        status: "ok",
        server: "llm-bitbucket-mcp",
        endpoint: "/mcp",
        uptimeSec: 42,
        activeSessions: 3,
    });
});
