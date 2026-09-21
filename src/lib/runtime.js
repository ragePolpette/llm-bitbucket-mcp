import { createApp } from "./app.js";
import { BitbucketClient } from "./bitbucket-client.js";
import { getConfig } from "./config.js";
import * as logger from "./logger.js";
import { createRuntimeMetrics } from "./runtime-metrics.js";
import { BitbucketRepositoryRegistry } from "./repository-registry.js";
import { createSessionStore } from "./session-store.js";

export function createSessionStoreFromConfig(config) {
    return createSessionStore({
        ttlMs: config.sessionTtlMs,
        maxSessions: config.maxSessions,
    });
}

export function createBitbucketClientFromConfig(config, repository, metrics) {
    return new BitbucketClient({
        apiBase: config.bitbucket.apiBase,
        workspace: repository.workspace,
        repoSlug: repository.repoSlug,
        userEmail: config.bitbucket.userEmail,
        apiToken: config.bitbucket.apiToken,
        defaultDestinationBranch: repository.defaultDestinationBranch,
        requestTimeoutMs: config.requestTimeoutMs,
        retryMaxAttempts: config.retry.maxAttempts,
        retryBaseDelayMs: config.retry.baseDelayMs,
        maxResponseBytes: config.maxResponseBytes,
        metrics,
    });
}

export function createRepositoryRegistryFromConfig(config, metrics) {
    return new BitbucketRepositoryRegistry(
        config.bitbucket.repositories,
        config.bitbucket.defaultRepositoryId,
        (repository) => createBitbucketClientFromConfig(config, repository, metrics),
    );
}

export function createMetricsFromConfig() {
    return createRuntimeMetrics();
}

export function createRuntime(
    config,
    {
        createMetrics = createMetricsFromConfig,
        createSessions = createSessionStoreFromConfig,
        createRegistry = createRepositoryRegistryFromConfig,
        createHttpApp = createApp,
    } = {},
) {
    const metrics = createMetrics(config);
    const sessions = createSessions(config);
    const repositories = createRegistry(config, metrics);
    const app = createHttpApp(config, sessions, repositories, metrics);

    return {
        config,
        metrics,
        sessions,
        repositories,
        app,
    };
}

export function listenRuntime(runtime) {
    return new Promise((resolve, reject) => {
        let server;
        server = runtime.app.listen(
            runtime.config.server.port,
            runtime.config.server.host,
            (error) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(server);
            },
        );
    });
}

export function logServerStarted(config) {
    logger.logInfo("server_started", {
        host: config.server.host,
        port: config.server.port,
        path: config.server.path,
        retry_max_attempts: config.retry.maxAttempts,
        retry_base_delay_ms: config.retry.baseDelayMs,
        max_sessions: config.maxSessions,
        session_ttl_ms: config.sessionTtlMs,
    });
    console.log(
        `llm-bitbucket-mcp listening at http://${config.server.host}:${config.server.port}${config.server.path}`,
    );
}

export async function startServer({
    loadConfig = getConfig,
    buildRuntime = createRuntime,
    listen = listenRuntime,
    onStarted = logServerStarted,
} = {}) {
    const config = loadConfig();
    const runtime = buildRuntime(config);
    const server = await listen(runtime);
    onStarted(config, server);
    return { ...runtime, server };
}

export async function runServerMain(options = {}) {
    try {
        await startServer(options);
    } catch (error) {
        const message = error instanceof Error ? error.message : "Errore di startup sconosciuto.";
        logger.logError("startup_error", error);
        console.error(`Failed to start llm-bitbucket-mcp: ${message}`);
        process.exit(1);
    }
}
