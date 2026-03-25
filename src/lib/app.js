import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
    CallToolRequestSchema,
    isInitializeRequest,
    ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { EXPOSED_TOOL_NAMES, TOOLS } from "./tools.js";
import { handleToolCall } from "./handlers.js";
import * as logger from "./logger.js";
import { applyJsonAcceptCompatibility } from "./accept-compat.js";
import { buildHealthPayload } from "./health.js";

function asTextResult(payload) {
    return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    };
}

function createMcpServer(client) {
    const server = new Server(
        { name: "llm-bitbucket-mcp", version: "1.0.0" },
        { capabilities: { tools: {} } },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;
        try {
            if (!EXPOSED_TOOL_NAMES.has(name)) {
                throw new Error(`Tool non esposto dal surface MCP corrente: ${name}`);
            }
            const result = await handleToolCall(name, args, client);
            return asTextResult(result);
        } catch (error) {
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

function normalizeHeaderValue(rawValue) {
    if (Array.isArray(rawValue)) return typeof rawValue[0] === "string" ? rawValue[0].trim() : "";
    return typeof rawValue === "string" ? rawValue.trim() : "";
}

function normalizeOrigin(origin) {
    try {
        const parsed = new URL(origin);
        const protocol = parsed.protocol.toLowerCase();
        const host = parsed.hostname.toLowerCase();
        if (!["http:", "https:"].includes(protocol) || !host) return null;
        return parsed.port ? `${protocol}//${host}:${parsed.port}` : `${protocol}//${host}`;
    } catch {
        return null;
    }
}

function isOriginAllowed(origin, allowedOrigins) {
    const normalizedOrigin = normalizeOrigin(origin);
    if (!normalizedOrigin) return false;
    for (const rawPattern of allowedOrigins) {
        const pattern = String(rawPattern || "")
            .trim()
            .toLowerCase();
        if (!pattern) continue;
        if (pattern === normalizedOrigin) return true;
        if (pattern.endsWith(":*") && normalizedOrigin.startsWith(`${pattern.slice(0, -2)}:`))
            return true;
    }
    return false;
}

function withOriginValidation(req, res, next, config) {
    const origin = normalizeHeaderValue(req.headers.origin);
    if (!origin) {
        next();
        return;
    }
    if (!isOriginAllowed(origin, config.server.allowedOrigins)) {
        res.status(403).json(createErrorResponse("Forbidden: Origin not allowed"));
        return;
    }
    res.set("Vary", "Origin");
    res.set("Access-Control-Allow-Origin", origin);
    next();
}

function createErrorResponse(message) {
    return { jsonrpc: "2.0", error: { code: -32000, message }, id: null };
}

function sendCorsPreflight(res) {
    res.set("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Accept, mcp-session-id");
    res.set("Access-Control-Max-Age", "600");
    res.status(204).send();
}

function sendMissingSession(res) {
    res.status(400).json(createErrorResponse("Bad Request: Missing session ID"));
}

function sendUnknownSession(res) {
    res.status(404).json(createErrorResponse("Not Found: Invalid or expired session ID"));
}

function sendRuntimeError(res, error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    const status = error instanceof Error && error.status ? error.status : 500;
    if (!res.headersSent) {
        res.status(status).json(createErrorResponse(message));
    }
}

export function createApp(config, sessions, client) {
    const app = createMcpExpressApp({
        host: config.server.host,
        allowedHosts: config.server.allowedHosts?.length ? config.server.allowedHosts : undefined,
    });

    app.use((req, res, next) => withOriginValidation(req, res, next, config));
    app.use((req, _res, next) => {
        if (req.path === config.server.path) {
            applyJsonAcceptCompatibility(req.headers, { sseEnabled: config.server.sseEnabled });
        }
        next();
    });
    app.options(config.server.path, (_req, res) => sendCorsPreflight(res));

    app.get("/health", (_req, res) => {
        res.json(
            buildHealthPayload({
                endpoint: config.server.path,
                sessions,
                uptimeSec: Math.floor(process.uptime()),
            }),
        );
    });

    app.post(config.server.path, async (req, res) => {
        const rawSessionId = req.headers["mcp-session-id"];
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
                const server = createMcpServer(client);
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
        const rawSessionId = req.headers["mcp-session-id"];
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
            await transport.handleRequest(req, res);
        } catch (error) {
            sendRuntimeError(res, error);
        }
    });

    app.delete(config.server.path, async (req, res) => {
        const rawSessionId = req.headers["mcp-session-id"];
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
            await transport.handleRequest(req, res);
        } catch (error) {
            sendRuntimeError(res, error);
        }
    });

    return app;
}
