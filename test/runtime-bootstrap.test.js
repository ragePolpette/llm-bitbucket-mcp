import test from "node:test";
import assert from "node:assert/strict";

import {
    createBitbucketClientFromConfig,
    createRuntime,
    createSessionStoreFromConfig,
    startServer,
} from "../src/lib/runtime.js";

function createTestConfig() {
    return {
        bitbucket: {
            apiBase: "https://api.bitbucket.org",
            workspace: "studioboost",
            repoSlug: "bpopilot",
            userEmail: "dev@example.com",
            apiToken: "runtime-token",
            defaultDestinationBranch: "main",
        },
        requestTimeoutMs: 30_000,
        maxResponseBytes: 1024,
        sessionTtlMs: 60_000,
        maxSessions: 10,
        server: {
            host: "127.0.0.1",
            port: 8783,
            path: "/mcp",
            sseEnabled: false,
            allowedHosts: ["127.0.0.1", "localhost"],
            allowedOrigins: ["http://localhost:*"],
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

test("createSessionStoreFromConfig maps runtime session policy", () => {
    const sessions = createSessionStoreFromConfig(createTestConfig());

    assert.equal(sessions.maxSessions(), 10);
});

test("createBitbucketClientFromConfig maps runtime Bitbucket settings", () => {
    const client = createBitbucketClientFromConfig(createTestConfig());

    assert.equal(client.defaultDestinationBranch, "main");
    assert.deepEqual(client.repoScope, {
        workspace: "studioboost",
        repoSlug: "bpopilot",
    });
});

test("createRuntime wires config, sessions, client and app through injectable factories", () => {
    const config = createTestConfig();
    const calls = [];
    const sessions = { kind: "sessions" };
    const client = { kind: "client" };
    const app = { kind: "app" };

    const runtime = createRuntime(config, {
        createSessions(receivedConfig) {
            calls.push(["sessions", receivedConfig]);
            return sessions;
        },
        createClient(receivedConfig) {
            calls.push(["client", receivedConfig]);
            return client;
        },
        createHttpApp(receivedConfig, receivedSessions, receivedClient) {
            calls.push(["app", receivedConfig, receivedSessions, receivedClient]);
            return app;
        },
    });

    assert.deepEqual(calls, [
        ["sessions", config],
        ["client", config],
        ["app", config, sessions, client],
    ]);
    assert.deepEqual(runtime, {
        config,
        sessions,
        client,
        app,
    });
});

test("startServer composes runtime bootstrap and startup hooks without process globals", async () => {
    const config = createTestConfig();
    const runtime = { config, app: { kind: "app" }, sessions: {}, client: {} };
    const server = { close() {} };
    const events = [];

    const result = await startServer({
        loadConfig() {
            events.push("loadConfig");
            return config;
        },
        buildRuntime(receivedConfig) {
            events.push(["buildRuntime", receivedConfig]);
            return runtime;
        },
        async listen(receivedRuntime) {
            events.push(["listen", receivedRuntime]);
            return server;
        },
        onStarted(receivedConfig, receivedServer) {
            events.push(["onStarted", receivedConfig, receivedServer]);
        },
    });

    assert.deepEqual(events, [
        "loadConfig",
        ["buildRuntime", config],
        ["listen", runtime],
        ["onStarted", config, server],
    ]);
    assert.equal(result.server, server);
    assert.equal(result.config, config);
});
