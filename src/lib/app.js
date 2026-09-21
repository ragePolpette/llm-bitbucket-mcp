import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
    CallToolRequestSchema,
    isInitializeRequest,
    ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { EXPOSED_TOOL_NAMES } from "./tools.js";
import { handleToolCall } from "./handlers.js";
import * as logger from "./logger.js";
import { applyJsonAcceptCompatibility } from "./accept-compat.js";
import { buildHealthPayload } from "./health.js";
import {
    CORS_ALLOWED_HEADERS,
    CORS_ALLOWED_METHODS,
    HEALTH_ENDPOINT,
    MCP_API_KEY_HEADER,
    MCP_SESSION_HEADER,
    METRICS_ENDPOINT,
    SERVER_NAME,
    SERVER_VERSION,
    createJsonRpcErrorResponse,
    extractApiKey,
    isOriginAllowed,
    normalizeHeaderValue,
    safeEqualSecret,
} from "./runtime-policy.js";
import { WRITE_TOOL_NAMES } from "./tool-policy.js";
import { getEnabledToolNames, getEnabledTools } from "./tools.js";

function asTextResult(payload) {
    return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    };
}

function createMcpServer(repositories, config, metrics) {
    const enabledTools = getEnabledTools(config.security.enabledWriteTools);
    const enabledToolNames = getEnabledToolNames(config.security.enabledWriteTools);
    const server = new Server(
        { name: SERVER_NAME, version: SERVER_VERSION },
        { capabilities: { tools: {} } },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: enabledTools }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;
        const isWriteTool = WRITE_TOOL_NAMES.has(name);
        try {
            if (!EXPOSED_TOOL_NAMES.has(name) || !enabledToolNames.has(name)) {
                if (isWriteTool) {
                    logger.logWarn("write_tool_blocked", { tool: name });
                }
                throw new Error(`Tool non esposto dal surface MCP corrente: ${name}`);
            }
            const repository = repositories.resolve(args?.repository_id);
            const result = await handleToolCall(name, args || {}, repository.client, {
                ...config.security,
                repositories: repositories.list(),
                selectedRepositoryId: repository.id,
                defaultRepositoryId: repositories.defaultRepositoryId,
            });
            metrics?.recordToolCall(name, "success");
            if (isWriteTool) {
                logger.logAudit("write_tool_success", { tool: name, repository_id: repository.id });
            }
            return asTextResult(result);
        } catch (error) {
            metrics?.recordToolCall(name, "failure");
            if (isWriteTool) {
                logger.logAudit("write_tool_failure", {
                    tool: name,
                    status: error.status || null,
                    message: error.message,
                });
            }
            logger.logError("tool_error", error);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(
                            {
                                success: false,
                                error: error.message,
                                status: error.status || null,
                            },
                            null,
                            2,
                        ),
                    },
                ],
                isError: true,
            };
        }
    });

    return server;
}

function withOriginValidation(req, res, next, config) {
    const origin = normalizeHeaderValue(req.headers.origin);
    if (!origin) {
        next();
        return;
    }
    if (!isOriginAllowed(origin, config.server.allowedOrigins)) {
        logger.logWarn("origin_blocked", { origin });
        res.status(403).json(createErrorResponse("Forbidden: Origin not allowed"));
        return;
    }
    res.set("Vary", "Origin");
    res.set("Access-Control-Allow-Origin", origin);
    next();
}

function withApiKeyAuth(req, res, next, config) {
    if (!config.security.authEnabled || req.method === "OPTIONS") {
        next();
        return;
    }

    const providedApiKey = extractApiKey(req.headers);
    if (safeEqualSecret(config.security.internalApiKey, providedApiKey)) {
        next();
        return;
    }

    logger.logWarn("auth_blocked", {
        header: MCP_API_KEY_HEADER,
        has_api_key: Boolean(providedApiKey),
        path: req.path,
    });
    res.status(401)
        .set("WWW-Authenticate", `Bearer realm="${SERVER_NAME}"`)
        .json(createErrorResponse("Unauthorized: Missing or invalid API key"));
}

function createErrorResponse(message) {
    return createJsonRpcErrorResponse(message);
}

function sendCorsPreflight(res) {
    res.set("Access-Control-Allow-Methods", CORS_ALLOWED_METHODS);
    res.set("Access-Control-Allow-Headers", CORS_ALLOWED_HEADERS);
    res.set("Access-Control-Max-Age", "600");
    res.status(204).send();
}

function sendMissingSession(res) {
    logger.logWarn("missing_session");
    res.status(400).json(createErrorResponse("Bad Request: Missing session ID"));
}

function sendUnknownSession(res) {
    logger.logWarn("unknown_session");
    res.status(404).json(createErrorResponse("Not Found: Invalid or expired session ID"));
}

function sendRuntimeError(res, error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    const status = error instanceof Error && error.status ? error.status : 500;
    if (!res.headersSent) {
        res.status(status).json(createErrorResponse(message));
    }
}

function buildMetricsPayload({ metrics, sessions, uptimeSec }) {
    return {
        status: "ok",
        server: SERVER_NAME,
        uptimeSec,
        activeSessions: sessions.size(),
        metrics: metrics?.snapshot?.() || {},
    };
}

export function createApp(config, sessions, repositories, metrics) {
    const app = createMcpExpressApp({
        host: config.server.host,
        allowedHosts: config.server.allowedHosts?.length ? config.server.allowedHosts : undefined,
    });

    app.use((req, _res, next) =>
        logger.runWithLogContext(
            {
                requestId: randomUUID(),
                sessionId: normalizeHeaderValue(req.headers["mcp-session-id"]) || null,
                method: req.method,
                path: req.path,
            },
            next,
        ),
    );
    app.use((req, res, next) => {
        metrics?.recordHttpRequest(req.method);
        res.once("finish", () => metrics?.recordHttpResponse(res.statusCode));
        next();
    });
    app.use((req, res, next) => withApiKeyAuth(req, res, next, config));
    app.use((req, res, next) => withOriginValidation(req, res, next, config));
    app.use((req, _res, next) => {
        if (req.path === config.server.path) {
            applyJsonAcceptCompatibility(req.headers, { sseEnabled: config.server.sseEnabled });
        }
        next();
    });
    app.options(config.server.path, (_req, res) => sendCorsPreflight(res));

    app.get(HEALTH_ENDPOINT, (_req, res) => {
        logger.logInfo("health_check");
        res.json(
            buildHealthPayload({
                endpoint: config.server.path,
                sessions,
                uptimeSec: Math.floor(process.uptime()),
            }),
        );
    });

    app.get(METRICS_ENDPOINT, (_req, res) => {
        logger.logInfo("metrics_read");
        res.json(
            buildMetricsPayload({
                metrics,
                sessions,
                uptimeSec: Math.floor(process.uptime()),
            }),
        );
    });

    app.post(config.server.path, async (req, res) => {
        const rawSessionId = req.headers[MCP_SESSION_HEADER];
        const sessionId = normalizeHeaderValue(rawSessionId);
        const hasSessionHeader = rawSessionId !== undefined;
        let transport;

        try {
            if (sessionId) transport = sessions.get(sessionId);

            if (sessionId && transport) {
                await transport.handleRequest(req, res, req.body);
                return;
            }
            if (sessionId && !transport) {
                sendUnknownSession(res);
                return;
            }
            if (hasSessionHeader && !sessionId) {
                sendUnknownSession(res);
                return;
            }

            if (!sessionId && isInitializeRequest(req.body)) {
                logger.logInfo("session_initialize");
                const server = createMcpServer(repositories, config, metrics);
                transport = new StreamableHTTPServerTransport({
                    sessionIdGenerator: () => randomUUID(),
                    enableJsonResponse: !config.server.sseEnabled,
                    onsessioninitialized: (sid) => sessions.set(sid, transport),
                });
                transport.onclose = () => {
                    const sid = transport.sessionId;
                    if (sid) sessions.delete(sid);
                };
                await server.connect(transport);
                await transport.handleRequest(req, res, req.body);
                return;
            }

            sendMissingSession(res);
        } catch (error) {
            sendRuntimeError(res, error);
        }
    });

    app.get(config.server.path, async (req, res) => {
        if (!config.server.sseEnabled) {
            res.status(405).set("Allow", "POST, DELETE").send("Method Not Allowed");
            return;
        }
        const rawSessionId = req.headers[MCP_SESSION_HEADER];
        if (rawSessionId === undefined) {
            sendMissingSession(res);
            return;
        }
        const sessionId = normalizeHeaderValue(rawSessionId);
        const transport = sessionId ? sessions.get(sessionId) : null;
        if (!sessionId || !transport) {
            sendUnknownSession(res);
            return;
        }
        try {
            logger.logInfo("session_stream_open");
            await transport.handleRequest(req, res);
        } catch (error) {
            sendRuntimeError(res, error);
        }
    });

    app.delete(config.server.path, async (req, res) => {
        const rawSessionId = req.headers[MCP_SESSION_HEADER];
        if (rawSessionId === undefined) {
            sendMissingSession(res);
            return;
        }
        const sessionId = normalizeHeaderValue(rawSessionId);
        const transport = sessionId ? sessions.get(sessionId) : null;
        if (!sessionId || !transport) {
            sendUnknownSession(res);
            return;
        }
        try {
            logger.logInfo("session_delete");
            await transport.handleRequest(req, res);
        } catch (error) {
            sendRuntimeError(res, error);
        }
    });

    return app;
}
