import test from "node:test";
import assert from "node:assert/strict";

import { createSessionStore } from "../src/lib/session-store.js";
import { createApp } from "../src/lib/app.js";
import { createRuntimeMetrics } from "../src/lib/runtime-metrics.js";
import {
    HEALTH_ENDPOINT,
    MCP_SESSION_HEADER,
    METRICS_ENDPOINT,
} from "../src/lib/runtime-policy.js";

function createTestConfig() {
    return {
        bitbucket: {
            workspace: "studioboost",
            repoSlug: "bpopilot",
        },
        server: {
            host: "127.0.0.1",
            port: 0,
            path: "/mcp",
            sseEnabled: false,
            allowedHosts: ["127.0.0.1", "localhost"],
            allowedOrigins: ["http://localhost:*", "http://127.0.0.1:*"],
        },
        security: {
            authEnabled: false,
            internalApiKey: "",
            enabledWriteTools: [
                "add_pull_request_comment",
                "create_pull_request",
                "open_pull_request",
            ],
        },
    };
}

async function withTestServer(run, configOverrides = {}) {
    const config = {
        ...createTestConfig(),
        ...configOverrides,
        server: {
            ...createTestConfig().server,
            ...(configOverrides.server || {}),
        },
        security: {
            ...createTestConfig().security,
            ...(configOverrides.security || {}),
        },
    };
    const sessions = createSessionStore({ ttlMs: 60_000, maxSessions: 10 });
    const metrics = createRuntimeMetrics();
    const client = {
        defaultDestinationBranch: "",
        repoScope: { workspace: "ws", repoSlug: "repo" },
    };
    const app = createApp(config, sessions, client, metrics);

    const server = await new Promise((resolve, reject) => {
        const instance = app.listen(0, config.server.host, (error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(instance);
        });
    });

    const address = server.address();
    const baseUrl = `http://${config.server.host}:${address.port}`;

    try {
        await run({ baseUrl, sessions });
    } finally {
        await new Promise((resolve, reject) => {
            server.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve();
            });
        });
    }
}

test("health endpoint returns the minimal runtime payload", async () => {
    await withTestServer(async ({ baseUrl }) => {
        const response = await fetch(`${baseUrl}${HEALTH_ENDPOINT}`);
        const payload = await response.json();

        assert.equal(response.status, 200);
        assert.equal(payload.status, "ok");
        assert.equal(payload.server, "llm-bitbucket-mcp");
        assert.equal(payload.endpoint, "/mcp");
        assert.equal(typeof payload.uptimeSec, "number");
        assert.equal(payload.activeSessions, 0);
        assert.equal(Object.prototype.hasOwnProperty.call(payload, "workspace"), false);
        assert.equal(Object.prototype.hasOwnProperty.call(payload, "repoSlug"), false);
    });
});

test("OPTIONS /mcp responds with CORS preflight headers for allowed origins", async () => {
    await withTestServer(async ({ baseUrl }) => {
        const response = await fetch(`${baseUrl}/mcp`, {
            method: "OPTIONS",
            headers: {
                Origin: "http://localhost:3000",
            },
        });

        assert.equal(response.status, 204);
        assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:3000");
        assert.match(response.headers.get("access-control-allow-methods") || "", /POST/);
    });
});

test("POST /mcp rejects disallowed origins before session handling", async () => {
    await withTestServer(async ({ baseUrl }) => {
        const response = await fetch(`${baseUrl}/mcp`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Origin: "http://evil.example.com",
            },
            body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 }),
        });
        const payload = await response.json();

        assert.equal(response.status, 403);
        assert.match(payload.error.message, /Origin not allowed/);
    });
});

test("POST /mcp returns missing session for non-initialize calls", async () => {
    await withTestServer(async ({ baseUrl }) => {
        const response = await fetch(`${baseUrl}/mcp`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 }),
        });
        const payload = await response.json();

        assert.equal(response.status, 400);
        assert.match(payload.error.message, /Missing session ID/);
    });
});

test("POST /mcp returns invalid session when the session id is unknown", async () => {
    await withTestServer(async ({ baseUrl }) => {
        const response = await fetch(`${baseUrl}/mcp`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                [MCP_SESSION_HEADER]: "missing-session",
            },
            body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 }),
        });
        const payload = await response.json();

        assert.equal(response.status, 404);
        assert.match(payload.error.message, /Invalid or expired session ID/);
    });
});

test("health endpoint requires API key when auth is enabled", async () => {
    await withTestServer(
        async ({ baseUrl }) => {
            const response = await fetch(`${baseUrl}${HEALTH_ENDPOINT}`);
            const payload = await response.json();

            assert.equal(response.status, 401);
            assert.match(payload.error.message, /invalid API key/);
        },
        {
            security: {
                authEnabled: true,
                internalApiKey: "shared-secret-key",
            },
        },
    );
});

test("POST /mcp accepts the configured API key header when auth is enabled", async () => {
    await withTestServer(
        async ({ baseUrl }) => {
            const response = await fetch(`${baseUrl}/mcp`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-mcp-api-key": "shared-secret-key",
                },
                body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 }),
            });
            const payload = await response.json();

            assert.equal(response.status, 400);
            assert.match(payload.error.message, /Missing session ID/);
        },
        {
            security: {
                authEnabled: true,
                internalApiKey: "shared-secret-key",
            },
        },
    );
});

test("metrics endpoint exposes essential runtime counters", async () => {
    await withTestServer(async ({ baseUrl }) => {
        await fetch(`${baseUrl}${HEALTH_ENDPOINT}`);
        await fetch(`${baseUrl}/mcp`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 }),
        });

        const response = await fetch(`${baseUrl}${METRICS_ENDPOINT}`);
        const payload = await response.json();

        assert.equal(response.status, 200);
        assert.equal(payload.status, "ok");
        assert.equal(payload.server, "llm-bitbucket-mcp");
        assert.equal(payload.activeSessions, 0);
        assert.equal(payload.metrics.http.methods.GET >= 2, true);
        assert.equal(payload.metrics.http.methods.POST >= 1, true);
        assert.equal(payload.metrics.http.statusBuckets["2xx"] >= 1, true);
        assert.equal(payload.metrics.http.statusBuckets["4xx"] >= 1, true);
    });
});
