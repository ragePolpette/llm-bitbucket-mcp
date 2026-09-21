import test from "node:test";
import assert from "node:assert/strict";

import {
    createBitbucketClientFromConfig,
    createMetricsFromConfig,
    createRepositoryRegistryFromConfig,
    createRuntime,
    createSessionStoreFromConfig,
    startServer,
} from "../src/lib/runtime.js";

function createTestConfig() {
    return {
        bitbucket: {
            apiBase: "https://api.bitbucket.org",
            userEmail: "dev@example.com",
            apiToken: "runtime-token",
            defaultRepositoryId: "primary",
            repositories: [
                {
                    id: "primary",
                    displayName: "Primary",
                    workspace: "workspace-slug",
                    repoSlug: "repo-slug",
                    defaultDestinationBranch: "main",
                    status: "active",
                },
            ],
        },
        requestTimeoutMs: 30_000,
        retry: {
            maxAttempts: 3,
            baseDelayMs: 250,
        },
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
    const config = createTestConfig();
    const client = createBitbucketClientFromConfig(config, config.bitbucket.repositories[0]);

    assert.equal(client.defaultDestinationBranch, "main");
    assert.deepEqual(client.repoScope, {
        workspace: "workspace-slug",
        repoSlug: "repo-slug",
    });
});

test("repository registry selects configured clients and rejects unknown ids", () => {
    const registry = createRepositoryRegistryFromConfig(createTestConfig());

    assert.equal(registry.resolve().id, "primary");
    assert.equal(registry.resolve("primary").client.repoScope.repoSlug, "repo-slug");
    assert.throws(() => registry.resolve("unknown"), /non configurato/);
});

test("createMetricsFromConfig creates runtime counters", () => {
    const metrics = createMetricsFromConfig(createTestConfig());
    const snapshot = metrics.snapshot();

    assert.equal(snapshot.http.requestsTotal, 0);
    assert.equal(snapshot.tools.callsTotal, 0);
    assert.equal(snapshot.bitbucket.requestsTotal, 0);
});

test("createRuntime wires config, sessions, client and app through injectable factories", () => {
    const config = createTestConfig();
    const calls = [];
    const metrics = { kind: "metrics" };
    const sessions = { kind: "sessions" };
    const repositories = { kind: "repositories" };
    const app = { kind: "app" };

    const runtime = createRuntime(config, {
        createMetrics(receivedConfig) {
            calls.push(["metrics", receivedConfig]);
            return metrics;
        },
        createSessions(receivedConfig) {
            calls.push(["sessions", receivedConfig]);
            return sessions;
        },
        createRegistry(receivedConfig, receivedMetrics) {
            calls.push(["repositories", receivedConfig, receivedMetrics]);
            return repositories;
        },
        createHttpApp(receivedConfig, receivedSessions, receivedRepositories, receivedMetrics) {
            calls.push([
                "app",
                receivedConfig,
                receivedSessions,
                receivedRepositories,
                receivedMetrics,
            ]);
            return app;
        },
    });

    assert.deepEqual(calls, [
        ["metrics", config],
        ["sessions", config],
        ["repositories", config, metrics],
        ["app", config, sessions, repositories, metrics],
    ]);
    assert.deepEqual(runtime, {
        config,
        metrics,
        sessions,
        repositories,
        app,
    });
});

test("startServer composes runtime bootstrap and startup hooks without process globals", async () => {
    const config = createTestConfig();
    const runtime = { config, app: { kind: "app" }, sessions: {}, client: {}, metrics: {} };
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
