import test from "node:test";
import assert from "node:assert/strict";

import { logEvent, logWarn, runWithLogContext } from "../src/lib/logger.js";

test("logger attaches correlation context to emitted events", () => {
    const writes = [];
    const originalLevel = process.env.LLM_BB_MCP_LOG_LEVEL;
    const originalWrite = process.stdout.write;
    process.env.LLM_BB_MCP_LOG_LEVEL = "info";
    process.stdout.write = (chunk) => {
        writes.push(String(chunk));
        return true;
    };

    try {
        runWithLogContext(
            {
                requestId: "req-123",
                sessionId: "sess-1",
                method: "POST",
                path: "/mcp",
            },
            () => logEvent("runtime_probe", { probe: true }),
        );
    } finally {
        process.stdout.write = originalWrite;
        if (originalLevel === undefined) {
            delete process.env.LLM_BB_MCP_LOG_LEVEL;
        } else {
            process.env.LLM_BB_MCP_LOG_LEVEL = originalLevel;
        }
    }

    assert.equal(writes.length, 1);
    assert.match(writes[0], /"request_id":"req-123"/);
    assert.match(writes[0], /"session_id":"sess-1"/);
    assert.match(writes[0], /"path":"\/mcp"/);
});

test("logger suppresses info events under warn level", () => {
    const writes = [];
    const originalLevel = process.env.LLM_BB_MCP_LOG_LEVEL;
    const originalWrite = process.stdout.write;
    process.env.LLM_BB_MCP_LOG_LEVEL = "warn";
    process.stdout.write = (chunk) => {
        writes.push(String(chunk));
        return true;
    };

    try {
        logEvent("runtime_probe", { probe: true });
    } finally {
        process.stdout.write = originalWrite;
        if (originalLevel === undefined) {
            delete process.env.LLM_BB_MCP_LOG_LEVEL;
        } else {
            process.env.LLM_BB_MCP_LOG_LEVEL = originalLevel;
        }
    }

    assert.equal(writes.length, 0);
});

test("logger emits warnings when warn level is enabled", () => {
    const writes = [];
    const originalLevel = process.env.LLM_BB_MCP_LOG_LEVEL;
    const originalWrite = process.stdout.write;
    process.env.LLM_BB_MCP_LOG_LEVEL = "warn";
    process.stdout.write = (chunk) => {
        writes.push(String(chunk));
        return true;
    };

    try {
        logWarn("runtime_warning", { reason: "test" });
    } finally {
        process.stdout.write = originalWrite;
        if (originalLevel === undefined) {
            delete process.env.LLM_BB_MCP_LOG_LEVEL;
        } else {
            process.env.LLM_BB_MCP_LOG_LEVEL = originalLevel;
        }
    }

    assert.equal(writes.length, 1);
    assert.match(writes[0], /"level":"WARN"/);
    assert.match(writes[0], /runtime_warning/);
});
