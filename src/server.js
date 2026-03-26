import { getConfig } from "./lib/config.js";
import { BitbucketClient } from "./lib/bitbucket-client.js";
import * as logger from "./lib/logger.js";
import { createSessionStore } from "./lib/session-store.js";
import { createApp } from "./lib/app.js";

function startServer() {
    try {
        const config = getConfig();
        const sessions = createSessionStore({
            ttlMs: config.sessionTtlMs,
            maxSessions: config.maxSessions,
        });
        const client = new BitbucketClient({
            apiBase: config.bitbucket.apiBase,
            workspace: config.bitbucket.workspace,
            repoSlug: config.bitbucket.repoSlug,
            userEmail: config.bitbucket.userEmail,
            apiToken: config.bitbucket.apiToken,
            defaultDestinationBranch: config.bitbucket.defaultDestinationBranch,
            requestTimeoutMs: config.requestTimeoutMs,
            maxResponseBytes: config.maxResponseBytes,
        });
        const app = createApp(config, sessions, client);

        app.listen(config.server.port, config.server.host, (error) => {
            if (error) {
                console.error("Failed to start llm-bitbucket-mcp:", error);
                process.exit(1);
            }
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
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Errore di startup sconosciuto.";
        logger.logError("startup_error", error);
        console.error(`Failed to start llm-bitbucket-mcp: ${message}`);
        process.exit(1);
    }
}

startServer();
