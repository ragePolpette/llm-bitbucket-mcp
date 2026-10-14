import test from "node:test";
import assert from "node:assert/strict";

import { handleToolCall, mergeConfirmations } from "../src/lib/handlers.js";
import { getConfigFromEnv } from "../src/lib/config.js";
import { SERVER_VERSION } from "../src/lib/runtime-policy.js";
import { buildToolMap, getEnabledToolNames, TOOLS } from "../src/lib/tools.js";
import {
    DEFAULT_ENABLED_WRITE_TOOLS,
    OPT_IN_WRITE_TOOLS,
    WRITE_TOOL_NAMES,
} from "../src/lib/tool-policy.js";
import { readFileSync } from "node:fs";

function createRecordingClient(respond = () => ({})) {
    const requests = [];
    return {
        requests,
        defaultDestinationBranch: "",
        repoPath(path) {
            return `/repositories/ws/repo/${path}`;
        },
        async request(method, path, options = {}) {
            requests.push({ method, path, body: options.body, queryParams: options.queryParams });
            return respond(method, path, options);
        },
    };
}

const MERGE_POLICY = {
    selectedRepository: { id: "repo", allowMerge: true },
    sessionId: "session-a",
};

test("approve_pull_request posts to the approve endpoint", async () => {
    const client = createRecordingClient(() => ({ user: { display_name: "Reviewer" } }));

    const result = await handleToolCall("approve_pull_request", { pr_id: 5 }, client);

    assert.deepEqual(client.requests, [
        {
            method: "POST",
            path: "/repositories/ws/repo/pullrequests/5/approve",
            body: undefined,
            queryParams: undefined,
        },
    ]);
    assert.deepEqual(result, { approved: true, pr_id: 5, user: "Reviewer" });
    await assert.rejects(() => handleToolCall("approve_pull_request", {}, client), /pr_id/);
});

test("unapprove_pull_request deletes the approval", async () => {
    const client = createRecordingClient(() => ({ success: true, status: 204 }));

    const result = await handleToolCall("unapprove_pull_request", { pr_id: 5 }, client);

    assert.equal(client.requests[0].method, "DELETE");
    assert.equal(client.requests[0].path, "/repositories/ws/repo/pullrequests/5/approve");
    assert.deepEqual(result, { approved: false, pr_id: 5 });
});

test("reply_to_pull_request_comment posts a comment with a parent id", async () => {
    const client = createRecordingClient(() => ({
        id: 900,
        parent: { id: 77 },
        links: { html: { href: "https://bitbucket/c/900" } },
    }));

    const result = await handleToolCall(
        "reply_to_pull_request_comment",
        { pr_id: 5, parent_id: 77, content: "Thanks, fixed." },
        client,
    );

    assert.deepEqual(client.requests[0], {
        method: "POST",
        path: "/repositories/ws/repo/pullrequests/5/comments",
        body: { content: { raw: "Thanks, fixed." }, parent: { id: 77 } },
        queryParams: undefined,
    });
    assert.deepEqual(result, {
        success: true,
        comment_id: 900,
        parent_id: 77,
        link: "https://bitbucket/c/900",
    });
    await assert.rejects(
        () => handleToolCall("reply_to_pull_request_comment", { pr_id: 5, content: "x" }, client),
        /parent_id/,
    );
    await assert.rejects(
        () =>
            handleToolCall(
                "reply_to_pull_request_comment",
                { pr_id: 5, parent_id: "77", content: "x" },
                client,
            ),
        /parent_id must be an integer/,
    );
});

test("create_pull_request_task creates a task, optionally attached to a comment", async () => {
    const client = createRecordingClient((_method, _path, { body }) => ({
        id: 31,
        state: "UNRESOLVED",
        content: body.content,
        comment: body.comment,
    }));

    const plain = await handleToolCall(
        "create_pull_request_task",
        { pr_id: 5, content: "Add tests" },
        client,
    );
    const attached = await handleToolCall(
        "create_pull_request_task",
        { pr_id: 5, content: "Rename variable", comment_id: 77 },
        client,
    );

    assert.equal(client.requests[0].path, "/repositories/ws/repo/pullrequests/5/tasks");
    assert.deepEqual(client.requests[0].body, { content: { raw: "Add tests" } });
    assert.deepEqual(client.requests[1].body, {
        content: { raw: "Rename variable" },
        comment: { id: 77 },
    });
    assert.equal(plain.task.id, 31);
    assert.equal(plain.task.state, "UNRESOLVED");
    assert.equal(attached.task.comment_id, 77);
    await assert.rejects(
        () =>
            handleToolCall(
                "create_pull_request_task",
                { pr_id: 5, content: "x".repeat(2001) },
                client,
            ),
        /exceeds the maximum allowed length/,
    );
});

test("resolve_pull_request_task marks the task as resolved", async () => {
    const client = createRecordingClient(() => ({ id: 31, state: "RESOLVED" }));

    const result = await handleToolCall(
        "resolve_pull_request_task",
        { pr_id: 5, task_id: 31 },
        client,
    );

    assert.deepEqual(client.requests[0], {
        method: "PUT",
        path: "/repositories/ws/repo/pullrequests/5/tasks/31",
        body: { state: "RESOLVED" },
        queryParams: undefined,
    });
    assert.equal(result.task.state, "RESOLVED");
    await assert.rejects(
        () => handleToolCall("resolve_pull_request_task", { pr_id: 5 }, client),
        /task_id/,
    );
});

test("decline_pull_request requires allowMerge and a confirmed token from the same session", async () => {
    mergeConfirmations.clear();
    const client = createRecordingClient((method) =>
        method === "GET"
            ? { id: 8, title: "Obsolete", state: "OPEN", participants: [] }
            : { id: 8, state: "DECLINED" },
    );

    await assert.rejects(
        () =>
            handleToolCall("decline_pull_request", { pr_id: 8 }, client, {
                selectedRepository: { id: "repo", allowMerge: false },
            }),
        /Decline is not allowed/,
    );

    const preview = await handleToolCall(
        "decline_pull_request",
        { pr_id: 8 },
        client,
        MERGE_POLICY,
    );
    assert.equal(preview.declined, false);
    assert.equal(preview.status, "confirmation_required");
    assert.equal(preview.summary.title, "Obsolete");
    assert.ok(preview.confirmation_token);

    await assert.rejects(
        () =>
            handleToolCall(
                "decline_pull_request",
                { pr_id: 8, confirmation_token: preview.confirmation_token },
                client,
                { ...MERGE_POLICY, sessionId: "session-b" },
            ),
        /Invalid confirmation_token/,
    );
    await assert.rejects(
        () =>
            handleToolCall(
                "merge_pull_request",
                { pr_id: 8, confirmation_token: preview.confirmation_token },
                client,
                MERGE_POLICY,
            ),
        /parameters do not match/,
    );
    assert.equal(client.requests.filter((r) => r.method === "POST").length, 0);

    const retry = await handleToolCall("decline_pull_request", { pr_id: 8 }, client, MERGE_POLICY);
    const declined = await handleToolCall(
        "decline_pull_request",
        { pr_id: 8, confirmation_token: retry.confirmation_token },
        client,
        MERGE_POLICY,
    );
    assert.deepEqual(declined, { declined: true, pr_id: 8, state: "DECLINED", link: null });
    const post = client.requests.find((r) => r.method === "POST");
    assert.equal(post.path, "/repositories/ws/repo/pullrequests/8/decline");
    mergeConfirmations.clear();
});

test("decline_pull_request preview refuses pull requests that are not open", async () => {
    const client = createRecordingClient(() => ({ id: 8, state: "MERGED" }));
    await assert.rejects(
        () => handleToolCall("decline_pull_request", { pr_id: 8 }, client, MERGE_POLICY),
        /is not open/,
    );
});

test("new write tools are opt-in and gated like the existing write tools", () => {
    assert.deepEqual(DEFAULT_ENABLED_WRITE_TOOLS, [
        "add_pull_request_comment",
        "create_pull_request",
        "open_pull_request",
        "run_pipeline",
        "merge_pull_request",
    ]);
    for (const name of OPT_IN_WRITE_TOOLS) {
        assert.equal(WRITE_TOOL_NAMES.has(name), true, name);
    }

    const defaults = getEnabledToolNames(undefined, { mergeAvailable: true });
    for (const name of OPT_IN_WRITE_TOOLS) {
        assert.equal(defaults.has(name), false, name);
    }
    assert.equal(defaults.has("wait_for_pipeline"), true);

    const everything = getEnabledToolNames([...WRITE_TOOL_NAMES], { mergeAvailable: true });
    for (const name of OPT_IN_WRITE_TOOLS) {
        assert.equal(everything.has(name), true, name);
    }

    const withoutMerge = getEnabledToolNames([...WRITE_TOOL_NAMES], { mergeAvailable: false });
    assert.equal(withoutMerge.has("decline_pull_request"), false);
    assert.equal(withoutMerge.has("merge_pull_request"), false);
    assert.equal(withoutMerge.has("approve_pull_request"), true);

    const config = getConfigFromEnv({
        BITBUCKET_USER_EMAIL: "dev@example.com",
        BITBUCKET_API_TOKEN: "runtime-token",
        MCP_BB_ENABLED_WRITE_TOOLS: "approve_pull_request,resolve_pull_request_task",
    });
    assert.deepEqual(config.security.enabledWriteTools, [
        "approve_pull_request",
        "resolve_pull_request_task",
    ]);
});

test("bitbucket_info derives its tool map from the tool catalog", async () => {
    const full = await handleToolCall("bitbucket_info", {}, {});
    const allNames = [
        ...full.tool_map.discovery,
        ...full.tool_map.pr_write,
        ...full.tool_map.pipeline_write,
    ];
    assert.deepEqual(allNames.sort(), TOOLS.map((tool) => tool.name).sort());
    assert.ok(full.tool_map.discovery.includes("wait_for_pipeline"));
    assert.ok(full.tool_map.pr_write.includes("decline_pull_request"));
    assert.deepEqual(full.tool_map.pipeline_write, ["run_pipeline"]);
    for (const name of [...OPT_IN_WRITE_TOOLS, "wait_for_pipeline"]) {
        assert.ok(full.usage_notes[name], `usage note for ${name}`);
    }

    const enabledToolNames = getEnabledToolNames(["add_pull_request_comment"], {
        mergeAvailable: false,
    });
    const filtered = await handleToolCall("bitbucket_info", {}, {}, { enabledToolNames });
    assert.deepEqual(filtered.tool_map, buildToolMap(enabledToolNames));
    assert.deepEqual(filtered.tool_map.pr_write, ["add_pull_request_comment"]);
    assert.deepEqual(filtered.tool_map.pipeline_write, []);
});

test("tool descriptions are written in English", () => {
    const italianMarkers = /\b(della|delle|dello|oppure|tramite|restituisce|chiedi|richiama)\b/i;
    for (const tool of TOOLS) {
        assert.equal(italianMarkers.test(JSON.stringify(tool)), false, tool.name);
    }
});

function pipelineWithState(name, extra = {}) {
    return {
        uuid: "{11111111-2222-3333-4444-555555555555}",
        build_number: 9,
        state: { name, ...extra },
    };
}

function createClock() {
    let current = 0;
    const sleeps = [];
    return {
        sleeps,
        now: () => current,
        sleep: async (delayMs) => {
            sleeps.push(delayMs);
            current += delayMs;
        },
    };
}

test("wait_for_pipeline polls until the pipeline completes", async () => {
    const states = [
        pipelineWithState("PENDING"),
        pipelineWithState("IN_PROGRESS"),
        pipelineWithState("COMPLETED", { result: { name: "SUCCESSFUL" } }),
    ];
    const client = createRecordingClient(() => states.shift());
    const clock = createClock();

    const result = await handleToolCall(
        "wait_for_pipeline",
        { pipeline_ref: "11111111-2222-3333-4444-555555555555", poll_interval_seconds: 10 },
        client,
        clock,
    );

    assert.equal(result.completed, true);
    assert.equal(result.timed_out, false);
    assert.equal(result.polls, 3);
    assert.equal(result.waited_seconds, 20);
    assert.equal(result.pipeline.result, "SUCCESSFUL");
    assert.deepEqual(clock.sleeps, [10_000, 10_000]);
    assert.ok(client.requests.every((r) => r.method === "GET"));
    assert.equal(
        client.requests[0].path,
        "/repositories/ws/repo/pipelines/{11111111-2222-3333-4444-555555555555}",
    );
});

test("wait_for_pipeline stops at the timeout with a bounded number of polls", async () => {
    const client = createRecordingClient(() => pipelineWithState("IN_PROGRESS"));
    const clock = createClock();

    const result = await handleToolCall(
        "wait_for_pipeline",
        {
            pipeline_ref: "11111111-2222-3333-4444-555555555555",
            timeout_seconds: 12,
            poll_interval_seconds: 5,
        },
        client,
        clock,
    );

    assert.equal(result.completed, false);
    assert.equal(result.timed_out, true);
    assert.equal(result.waited_seconds, 12);
    assert.deepEqual(clock.sleeps, [5_000, 5_000, 2_000]);
    assert.equal(client.requests.length, 4);
});

test("wait_for_pipeline returns early when the pipeline is paused or the call is cancelled", async () => {
    const paused = await handleToolCall(
        "wait_for_pipeline",
        { pipeline_ref: "11111111-2222-3333-4444-555555555555" },
        createRecordingClient(() =>
            pipelineWithState("IN_PROGRESS", { stage: { name: "PAUSED" } }),
        ),
        createClock(),
    );
    assert.equal(paused.paused, true);
    assert.equal(paused.timed_out, false);
    assert.equal(paused.polls, 1);

    const controller = new AbortController();
    const clock = createClock();
    const cancelled = await handleToolCall(
        "wait_for_pipeline",
        { pipeline_ref: "11111111-2222-3333-4444-555555555555" },
        createRecordingClient(() => pipelineWithState("IN_PROGRESS")),
        {
            ...clock,
            signal: controller.signal,
            sleep: async (delayMs) => {
                await clock.sleep(delayMs);
                controller.abort();
            },
        },
    );
    assert.equal(cancelled.cancelled, true);
    assert.equal(cancelled.polls, 1);
});

test("wait_for_pipeline validates its bounds", async () => {
    const client = createRecordingClient(() => pipelineWithState("COMPLETED"));
    const ref = "11111111-2222-3333-4444-555555555555";
    await assert.rejects(
        () =>
            handleToolCall(
                "wait_for_pipeline",
                { pipeline_ref: ref, timeout_seconds: 601 },
                client,
            ),
        /timeout_seconds must be less than or equal to 600/,
    );
    await assert.rejects(
        () =>
            handleToolCall(
                "wait_for_pipeline",
                { pipeline_ref: ref, poll_interval_seconds: 1 },
                client,
            ),
        /poll_interval_seconds must be greater than or equal to 5/,
    );
    await assert.rejects(() => handleToolCall("wait_for_pipeline", {}, client), /pipeline_ref/);
    assert.equal(client.requests.length, 0);
});

test("find_open_pull_request stops after the page cap and reports truncation", async () => {
    let page = 0;
    const client = createRecordingClient(() => {
        page += 1;
        return {
            values: [{ id: page, state: "OPEN", source: { branch: { name: "other" } } }],
            next: `https://api.bitbucket.org/2.0/repositories/ws/repo/pullrequests?page=${page + 1}`,
        };
    });

    const result = await handleToolCall(
        "find_open_pull_request",
        { source_branch: "feature/x" },
        client,
    );

    assert.deepEqual(result, { pull_request: null, truncated: true });
    assert.equal(client.requests.length, 10);
});

test("find_open_pull_request does not loop on a next link that does not advance", async () => {
    const client = createRecordingClient(() => ({
        values: [],
        next: "https://api.bitbucket.org/2.0/repositories/ws/repo/pullrequests?page=1",
    }));

    const result = await handleToolCall(
        "find_open_pull_request",
        { source_branch: "feature/x" },
        client,
    );

    assert.equal(result.truncated, true);
    assert.deepEqual(
        client.requests.map((r) => r.queryParams.page),
        ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
    );
});

test("get_pull_request_diff truncates on UTF-8 bytes without splitting characters", async () => {
    const diff = "€".repeat(200 * 1024);
    const client = createRecordingClient(() => diff);

    const result = await handleToolCall("get_pull_request_diff", { pr_id: 1 }, client);

    assert.equal(result.truncated, true);
    assert.ok(Buffer.byteLength(result.diff, "utf8") <= 500 * 1024);
    assert.ok(Buffer.byteLength(result.diff, "utf8") > 500 * 1024 - 3);
    assert.equal(result.diff.includes("�"), false);
    assert.match(result.warning, /truncated to 512000 bytes/);

    const small = await handleToolCall(
        "get_pull_request_diff",
        { pr_id: 1 },
        createRecordingClient(() => "diff --git a b"),
    );
    assert.deepEqual(small, { diff: "diff --git a b", truncated: false });
});

test("list_pull_requests validates and forwards destination_branch", async () => {
    const client = createRecordingClient(() => ({ size: 0, page: 1, values: [] }));

    await handleToolCall("list_pull_requests", { destination_branch: "main" }, client);
    assert.equal(client.requests[0].queryParams.q, 'destination.branch.name="main"');

    await assert.rejects(
        () => handleToolCall("list_pull_requests", { destination_branch: 42 }, client),
        /destination_branch must be a string/,
    );
    await assert.rejects(
        () => handleToolCall("list_pull_requests", { destination_branch: "x".repeat(256) }, client),
        /destination_branch exceeds the maximum allowed length/,
    );
    assert.equal(client.requests.length, 1);
});

test("server version is read from package.json", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    assert.equal(SERVER_VERSION, pkg.version);
});
