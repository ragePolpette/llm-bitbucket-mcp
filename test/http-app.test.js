import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { createRepositoryRegistryFromConfig } from "../src/lib/runtime.js";
import { mergeConfirmations } from "../src/lib/handlers.js";

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
            workspace: "workspace-slug",
            repoSlug: "repo-slug",
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

function initializeRequest(id = 1) {
    return {
        jsonrpc: "2.0",
        id,
        method: "initialize",
        params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "test-client", version: "1.0.0" },
        },
    };
}

function postJson(url, body, headers = {}) {
    return fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
            ...headers,
        },
        body: JSON.stringify(body),
    });
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
    const sessions = createSessionStore({
        ttlMs: 60_000,
        maxSessions: configOverrides.maxSessions || 10,
    });
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

test("health endpoint stays public but minimal when auth is enabled", async () => {
    await withTestServer(
        async ({ baseUrl }) => {
            const anonymous = await fetch(`${baseUrl}${HEALTH_ENDPOINT}`);
            const anonymousPayload = await anonymous.json();
            assert.equal(anonymous.status, 200);
            assert.deepEqual(Object.keys(anonymousPayload).sort(), [
                "server",
                "status",
                "uptimeSec",
            ]);
            assert.equal(anonymousPayload.status, "ok");

            const authenticated = await fetch(`${baseUrl}${HEALTH_ENDPOINT}`, {
                headers: { "x-mcp-api-key": "shared-secret-key" },
            });
            const authenticatedPayload = await authenticated.json();
            assert.equal(authenticated.status, 200);
            assert.equal(authenticatedPayload.endpoint, "/mcp");
            assert.equal(authenticatedPayload.activeSessions, 0);

            const metrics = await fetch(`${baseUrl}${METRICS_ENDPOINT}`);
            assert.equal(metrics.status, 401);

            const mcp = await fetch(`${baseUrl}/mcp`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(initializeRequest()),
            });
            assert.equal(mcp.status, 401);
        },
        {
            security: {
                authEnabled: true,
                internalApiKey: "shared-secret-key",
            },
        },
    );
});

test("POST /mcp initialize answers 503 without creating a session when capacity is reached", async () => {
    await withTestServer(
        async ({ baseUrl, sessions }) => {
            const first = await postJson(`${baseUrl}/mcp`, initializeRequest());
            assert.equal(first.status, 200);
            assert.ok(first.headers.get(MCP_SESSION_HEADER));
            assert.equal(sessions.size(), 1);

            const second = await postJson(`${baseUrl}/mcp`, initializeRequest());
            const payload = await second.json();
            assert.equal(second.status, 503);
            assert.match(payload.error.message, /Session limit reached/);
            assert.equal(second.headers.get(MCP_SESSION_HEADER), null);
            assert.equal(sessions.size(), 1);
        },
        { maxSessions: 1 },
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

function listen(target) {
    return new Promise((resolve, reject) => {
        const instance = target.listen(0, "127.0.0.1", (error) =>
            error ? reject(error) : resolve(instance),
        );
    });
}

function close(server) {
    return new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
    });
}

function parseToolResult(result) {
    return JSON.parse(result.content[0].text);
}

test("end to end: initialize, tools/list and tools/call against a stub Bitbucket API", async () => {
    mergeConfirmations.clear();
    const bitbucketRequests = [];
    const pullRequest = {
        id: 42,
        title: "Feature",
        state: "OPEN",
        author: { display_name: "Dev" },
        source: { branch: { name: "feature/x" } },
        destination: { branch: { name: "main" } },
        participants: [],
        links: { html: { href: "https://bitbucket/pr/42" } },
    };
    const bitbucket = http.createServer((req, res) => {
        bitbucketRequests.push({
            method: req.method,
            url: req.url,
            authorization: req.headers.authorization,
        });
        res.setHeader("Content-Type", "application/json");
        if (req.method === "GET" && req.url === "/2.0/repositories/ws/repo/pullrequests/42") {
            res.end(JSON.stringify(pullRequest));
            return;
        }
        if (
            req.method === "POST" &&
            req.url === "/2.0/repositories/ws/repo/pullrequests/42/merge"
        ) {
            res.end(JSON.stringify({ state: "MERGED", merge_commit: { hash: "abc123" } }));
            return;
        }
        res.statusCode = 404;
        res.end(JSON.stringify({ error: { message: "not found" } }));
    });
    await listen(bitbucket);

    const config = {
        ...createTestConfig(),
        bitbucket: {
            apiBase: `http://127.0.0.1:${bitbucket.address().port}`,
            userEmail: "dev@example.com",
            apiToken: "runtime-token",
            defaultRepositoryId: "main-repo",
            repositories: [
                {
                    id: "main-repo",
                    displayName: "Main",
                    workspace: "ws",
                    repoSlug: "repo",
                    defaultDestinationBranch: "main",
                    status: "active",
                    allowMerge: true,
                },
            ],
        },
        requestTimeoutMs: 5_000,
        retry: { maxAttempts: 1, baseDelayMs: 50 },
        maxResponseBytes: 1024 * 1024,
    };
    config.security = {
        ...config.security,
        enabledWriteTools: ["add_pull_request_comment", "merge_pull_request"],
    };
    const metrics = createRuntimeMetrics();
    const sessions = createSessionStore({ ttlMs: 60_000, maxSessions: 10 });
    const repositories = createRepositoryRegistryFromConfig(config, metrics);
    const clientA = new Client({ name: "client-a", version: "1.0.0" });
    const clientB = new Client({ name: "client-b", version: "1.0.0" });
    let mcpServer = null;
    try {
        mcpServer = await listen(createApp(config, sessions, repositories, metrics));
        const endpoint = new URL(`http://127.0.0.1:${mcpServer.address().port}/mcp`);
        await clientA.connect(new StreamableHTTPClientTransport(endpoint));
        await clientB.connect(new StreamableHTTPClientTransport(endpoint));
        assert.equal(sessions.size(), 2);

        const { tools } = await clientA.listTools();
        const names = tools.map((tool) => tool.name);
        assert.ok(names.includes("get_pull_request"));
        assert.ok(names.includes("wait_for_pipeline"));
        assert.ok(names.includes("merge_pull_request"));
        assert.equal(names.includes("decline_pull_request"), false);
        assert.equal(names.includes("approve_pull_request"), false);
        assert.equal(names.includes("create_pull_request"), false);
        assert.ok(tools.every((tool) => tool.inputSchema.properties.repository_id));

        const pr = parseToolResult(
            await clientA.callTool({ name: "get_pull_request", arguments: { pr_id: 42 } }),
        );
        assert.equal(pr.id, 42);
        assert.equal(pr.source_branch, "feature/x");
        assert.match(bitbucketRequests[0].authorization, /^Basic /);

        const blocked = await clientA.callTool({
            name: "approve_pull_request",
            arguments: { pr_id: 42 },
        });
        assert.equal(blocked.isError, true);
        assert.match(parseToolResult(blocked).error, /not exposed/);

        const preview = parseToolResult(
            await clientA.callTool({ name: "merge_pull_request", arguments: { pr_id: 42 } }),
        );
        assert.equal(preview.status, "confirmation_required");

        const stolen = await clientB.callTool({
            name: "merge_pull_request",
            arguments: { pr_id: 42, confirmation_token: preview.confirmation_token },
        });
        assert.equal(stolen.isError, true);
        assert.match(parseToolResult(stolen).error, /Invalid confirmation_token/);
        assert.equal(bitbucketRequests.filter((r) => r.method === "POST").length, 0);

        const merged = parseToolResult(
            await clientA.callTool({
                name: "merge_pull_request",
                arguments: { pr_id: 42, confirmation_token: preview.confirmation_token },
            }),
        );
        assert.equal(merged.merged, true);
        assert.equal(merged.merge_commit, "abc123");
        assert.equal(bitbucketRequests.filter((r) => r.method === "POST").length, 1);
    } finally {
        await clientA.close();
        await clientB.close();
        if (mcpServer) await close(mcpServer);
        await close(bitbucket);
        mergeConfirmations.clear();
    }
});
