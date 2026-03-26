import { createApp } from "./app.js";
import { BitbucketClient } from "./bitbucket-client.js";
import { getConfig } from "./config.js";
import * as logger from "./logger.js";
import { createSessionStore } from "./session-store.js";

export function createSessionStoreFromConfig(config) {
    return createSessionStore({
        ttlMs: config.sessionTtlMs,
        maxSessions: config.maxSessions,
    });
}

export function createBitbucketClientFromConfig(config) {
    return new BitbucketClient({
        apiBase: config.bitbucket.apiBase,
        workspace: config.bitbucket.workspace,
        repoSlug: config.bitbucket.repoSlug,
        userEmail: config.bitbucket.userEmail,
        apiToken: config.bitbucket.apiToken,
        defaultDestinationBranch: config.bitbucket.defaultDestinationBranch,
        requestTimeoutMs: config.requestTimeoutMs,
        maxResponseBytes: config.maxResponseBytes,
    });
}

export function createRuntime(
    config,
    {
        createSessions = createSessionStoreFromConfig,
        createClient = createBitbucketClientFromConfig,
        createHttpApp = createApp,
    } = {},
) {
    const sessions = createSessions(config);
    const client = createClient(config);
    const app = createHttpApp(config, sessions, client);

    return {
        config,
        sessions,
        client,
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
