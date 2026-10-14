import test from "node:test";
import assert from "node:assert/strict";
import { handleToolCall, mergeConfirmations } from "../src/lib/handlers.js";
import {
    isRepoScopedBitbucketApiPath,
    normalizeBitbucketApiPath,
} from "../src/lib/bitbucket-client.js";
import { getEnabledToolNames } from "../src/lib/tools.js";
import { BitbucketRepositoryRegistry } from "../src/lib/repository-registry.js";
import {
    ConfirmationStoreCapacityError,
    createConfirmationStore,
} from "../src/lib/merge-confirmations.js";

test("unknown tools are rejected by the dispatcher", async () => {
    await assert.rejects(
        () => handleToolCall("delete_repository", { pr_id: 123 }, {}),
        /Unsupported tool/,
    );
});

test("merge_pull_request is refused when the repository does not allow merges", async () => {
    await assert.rejects(
        () =>
            handleToolCall(
                "merge_pull_request",
                { pr_id: 123 },
                {},
                { selectedRepository: { id: "repo", allowMerge: false } },
            ),
        /Merge is not allowed/,
    );
    await assert.rejects(
        () => handleToolCall("merge_pull_request", { pr_id: 123 }, {}, {}),
        /Merge is not allowed/,
    );
});

test("merge_pull_request requires a confirmed token before merging", async () => {
    mergeConfirmations.clear();
    const requests = [];
    const client = {
        repoPath(path) {
            return `/repositories/ws/repo/${path}`;
        },
        async request(method, path, { body } = {}) {
            requests.push({ method, path, body });
            if (method === "GET") {
                return {
                    id: 42,
                    title: "Feature",
                    state: "OPEN",
                    author: { display_name: "Dev" },
                    source: { branch: { name: "feature/x" } },
                    destination: { branch: { name: "main" } },
                    participants: [{ approved: true }, { approved: false }],
                    links: { html: { href: "https://bitbucket/pr/42" } },
                };
            }
            return {
                state: "MERGED",
                merge_commit: { hash: "abc123" },
                links: { html: { href: "https://bitbucket/pr/42" } },
            };
        },
    };
    const policy = { selectedRepository: { id: "repo", allowMerge: true } };

    const preview = await handleToolCall("merge_pull_request", { pr_id: 42 }, client, policy);
    assert.equal(preview.merged, false);
    assert.equal(preview.status, "confirmation_required");
    assert.equal(preview.summary.source_branch, "feature/x");
    assert.equal(preview.summary.approvals, 1);
    assert.ok(preview.confirmation_token);
    assert.equal(requests.filter((r) => r.method === "POST").length, 0);

    await assert.rejects(
        () =>
            handleToolCall(
                "merge_pull_request",
                { pr_id: 42, confirmation_token: "wrong-token" },
                client,
                policy,
            ),
        /Invalid confirmation_token/,
    );
    await assert.rejects(
        () =>
            handleToolCall(
                "merge_pull_request",
                {
                    pr_id: 42,
                    merge_strategy: "squash",
                    confirmation_token: preview.confirmation_token,
                },
                client,
                policy,
            ),
        /parameters do not match/,
    );
    assert.equal(requests.filter((r) => r.method === "POST").length, 0);

    const retry = await handleToolCall("merge_pull_request", { pr_id: 42 }, client, policy);
    const merged = await handleToolCall(
        "merge_pull_request",
        { pr_id: 42, confirmation_token: retry.confirmation_token },
        client,
        policy,
    );
    assert.equal(merged.merged, true);
    assert.equal(merged.merge_commit, "abc123");
    const post = requests.find((r) => r.method === "POST");
    assert.equal(post.path, "/repositories/ws/repo/pullrequests/42/merge");
    assert.deepEqual(post.body, { merge_strategy: "merge_commit", close_source_branch: true });

    await assert.rejects(
        () =>
            handleToolCall(
                "merge_pull_request",
                { pr_id: 42, confirmation_token: retry.confirmation_token },
                client,
                policy,
            ),
        /Invalid confirmation_token/,
    );
});

test("merge_pull_request preview refuses pull requests that are not open", async () => {
    const client = {
        repoPath(path) {
            return `/repositories/ws/repo/${path}`;
        },
        async request() {
            return { id: 7, state: "MERGED" };
        },
    };
    await assert.rejects(
        () =>
            handleToolCall("merge_pull_request", { pr_id: 7 }, client, {
                selectedRepository: { id: "repo", allowMerge: true },
            }),
        /is not open/,
    );
});

test("confirmation store expires tokens and binds them to their scope", () => {
    let clock = 1000;
    const store = createConfirmationStore({ ttlMs: 100, now: () => clock });
    const { token } = store.issue({ prId: 1 });
    assert.equal(store.consume(token, { prId: 2 }).ok, false);
    const second = store.issue({ prId: 1 });
    clock += 101;
    assert.equal(store.consume(second.token, { prId: 1 }).reason, "unknown_or_expired");
    assert.equal(store.consume("", { prId: 1 }).reason, "missing");
    assert.equal(store.size(), 0);
});

test("run_pipeline posts a branch target with optional custom selector and variables", async () => {
    const requests = [];
    const client = {
        repoPath(path) {
            return `/repositories/ws/repo/${path}`;
        },
        async request(method, path, { body } = {}) {
            requests.push({ method, path, body });
            return {
                uuid: "{pipe-1}",
                build_number: 12,
                state: { name: "PENDING" },
                target: { ref_name: body.target.ref_name },
                links: { html: { href: "https://bitbucket/pipelines/12" } },
            };
        },
    };

    const simple = await handleToolCall("run_pipeline", { branch: "develop" }, client);
    assert.equal(simple.started, true);
    assert.equal(simple.pipeline.build_number, 12);
    assert.deepEqual(requests[0].body, {
        target: { type: "pipeline_ref_target", ref_type: "branch", ref_name: "develop" },
    });

    await handleToolCall(
        "run_pipeline",
        {
            branch: "release/1.0",
            pipeline_name: "deploy-staging",
            commit_hash: "A".repeat(40),
            variables: { TARGET_ENV: "staging" },
        },
        client,
    );
    assert.deepEqual(requests[1].body, {
        target: {
            type: "pipeline_ref_target",
            ref_type: "branch",
            ref_name: "release/1.0",
            commit: { type: "commit", hash: "a".repeat(40) },
            selector: { type: "custom", pattern: "deploy-staging" },
        },
        variables: [{ key: "TARGET_ENV", value: "staging", secured: false }],
    });

    await assert.rejects(() => handleToolCall("run_pipeline", {}, client), /branch/);
    await assert.rejects(
        () => handleToolCall("run_pipeline", { branch: "x", commit_hash: "short" }, client),
        /commit_hash/,
    );
    await assert.rejects(
        () =>
            handleToolCall("run_pipeline", { branch: "x", variables: { "bad key": "v" } }, client),
        /Invalid pipeline variable name/,
    );
});

test("pipeline step logs are requested with an octet-stream friendly Accept header", async () => {
    const requests = [];
    const client = {
        repoPath(path) {
            return `/repositories/ws/repo/${path}`;
        },
        async request(method, path, options = {}) {
            requests.push({ method, path, options });
            if (path.endsWith("/log")) {
                return "line 1\nline 2";
            }
            if (path.endsWith("/steps")) {
                return {
                    values: [
                        {
                            uuid: "{22222222-2222-2222-2222-222222222222}",
                            name: "build",
                            state: { name: "COMPLETED", result: { name: "FAILED" } },
                        },
                        {
                            uuid: "{33333333-3333-3333-3333-333333333333}",
                            name: "test",
                            state: { name: "COMPLETED", result: { name: "SUCCESSFUL" } },
                        },
                    ],
                };
            }
            if (path.endsWith("/steps/{33333333-3333-3333-3333-333333333333}")) {
                return {
                    uuid: "{33333333-3333-3333-3333-333333333333}",
                    name: "test",
                    state: { name: "COMPLETED", result: { name: "SUCCESSFUL" } },
                };
            }
            return {
                uuid: "{11111111-1111-1111-1111-111111111111}",
                state: { name: "COMPLETED", result: { name: "FAILED" } },
            };
        },
    };

    const failures = await handleToolCall(
        "get_pipeline_failure_output",
        { pipeline_ref: "11111111-1111-1111-1111-111111111111" },
        client,
    );
    assert.equal(failures.failure_count, 1);
    assert.equal(failures.failures[0].log, "line 1\nline 2");
    const logRequest = requests.find((r) => r.path.endsWith("/log"));
    assert.match(logRequest.options.accept, /application\/octet-stream/);
    assert.match(logRequest.options.accept, /\*\/\*/);

    const steps = await handleToolCall(
        "list_pipeline_steps",
        { pipeline_ref: "11111111-1111-1111-1111-111111111111" },
        client,
    );
    assert.equal(steps.step_count, 2);
    assert.equal(steps.steps[1].name, "test");

    const stepLog = await handleToolCall(
        "get_pipeline_step_log",
        {
            pipeline_ref: "{11111111-1111-1111-1111-111111111111}",
            step_uuid: "33333333-3333-3333-3333-333333333333",
        },
        client,
    );
    assert.equal(stepLog.step.name, "test");
    assert.equal(stepLog.log, "line 1\nline 2");
    await assert.rejects(
        () =>
            handleToolCall(
                "get_pipeline_step_log",
                { pipeline_ref: "11111111-1111-1111-1111-111111111111" },
                client,
            ),
        /step_uuid/,
    );
});

test("merge tool is hidden from the surface unless a repository allows merges", () => {
    const registryWithoutMerge = new BitbucketRepositoryRegistry(
        [{ id: "a", workspace: "ws", repoSlug: "a", status: "active", allowMerge: false }],
        "a",
        () => ({}),
    );
    const registryWithMerge = new BitbucketRepositoryRegistry(
        [
            { id: "a", workspace: "ws", repoSlug: "a", status: "active", allowMerge: false },
            { id: "b", workspace: "ws", repoSlug: "b", status: "active", allowMerge: true },
            { id: "c", workspace: "ws", repoSlug: "c", status: "disabled", allowMerge: true },
        ],
        "a",
        () => ({}),
    );

    assert.equal(registryWithoutMerge.mergeAvailable, false);
    assert.equal(registryWithMerge.mergeAvailable, true);
    assert.equal(registryWithMerge.list().find((r) => r.id === "b").allowMerge, true);
    assert.equal(registryWithMerge.describe(registryWithMerge.resolve("a")).allowMerge, false);

    const hidden = getEnabledToolNames(undefined, { mergeAvailable: false });
    const shown = getEnabledToolNames(undefined, { mergeAvailable: true });
    assert.equal(hidden.has("merge_pull_request"), false);
    assert.equal(hidden.has("run_pipeline"), true);
    assert.equal(shown.has("merge_pull_request"), true);
});

test("write tool allowlist can remove selected write tools from the exposed surface", () => {
    const enabledToolNames = getEnabledToolNames(["add_pull_request_comment"]);

    assert.equal(enabledToolNames.has("add_pull_request_comment"), true);
    assert.equal(enabledToolNames.has("create_pull_request"), false);
    assert.equal(enabledToolNames.has("open_pull_request"), false);
    assert.equal(enabledToolNames.has("run_pipeline"), false);
    assert.equal(enabledToolNames.has("merge_pull_request"), false);
    assert.equal(enabledToolNames.has("get_pull_request"), true);
    assert.equal(enabledToolNames.has("bb_api"), false);
});

test("bitbucket_info exposes tool map and runtime branch semantics", async () => {
    const result = await handleToolCall(
        "bitbucket_info",
        {},
        { defaultDestinationBranch: "develop" },
    );

    assert.equal(result.server, "llm-bitbucket-mcp");
    assert.ok(result.tool_map.discovery.includes("find_open_pull_request"));
    assert.ok(result.tool_map.discovery.includes("get_pull_request_commits"));
    assert.ok(result.tool_map.discovery.includes("get_pull_request_statuses"));
    assert.ok(result.tool_map.discovery.includes("get_pull_request_tasks"));
    assert.ok(result.tool_map.discovery.includes("get_pull_request_pipelines"));
    assert.ok(result.tool_map.discovery.includes("get_pull_request_pipeline_failure_output"));
    assert.ok(result.tool_map.discovery.includes("get_pipeline_run"));
    assert.ok(result.tool_map.discovery.includes("get_pipeline_failure_output"));
    assert.ok(result.tool_map.pr_write.includes("open_pull_request"));
    assert.deepEqual(result.tool_map.utility, []);
    assert.equal(result.runtime_options.auth_enabled, false);
    assert.equal(result.runtime_options.default_destination_branch, "develop");
    assert.deepEqual(result.runtime_options.enabled_write_tools, []);
});

test("create_pull_request is dispatched when explicitly exposed", async () => {
    const requests = [];
    const client = {
        defaultDestinationBranch: "",
        repoPath(path) {
            return `/repositories/ws/repo/${path}`;
        },
        async request(method, path, { body } = {}) {
            requests.push({ method, path, body });
            return {
                id: 77,
                title: body.title,
                links: { html: { href: "https://bitbucket/pr/77" } },
            };
        },
    };

    const result = await handleToolCall(
        "create_pull_request",
        {
            title: "Nuova PR",
            source_branch: "feature/test",
            description: "Descrizione",
            destination_branch: "main",
            reviewers: ["{reviewer-uuid}"],
            close_source_branch: false,
        },
        client,
    );

    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0], {
        method: "POST",
        path: "/repositories/ws/repo/pullrequests",
        body: {
            title: "Nuova PR",
            source: { branch: { name: "feature/test" } },
            destination: { branch: { name: "main" } },
            close_source_branch: false,
            description: "Descrizione",
            reviewers: [{ uuid: "{reviewer-uuid}" }],
        },
    });
    assert.deepEqual(result, {
        id: 77,
        title: "Nuova PR",
        link: "https://bitbucket/pr/77",
        source_branch: "feature/test",
        destination_branch: "main",
    });
});

test("find_open_pull_request returns the matching open PR summary", async () => {
    const requests = [];
    const client = {
        repoPath(path) {
            return `/repositories/ws/repo/${path}`;
        },
        async request(method, path, { queryParams } = {}) {
            requests.push({ method, path, queryParams });
            return {
                size: 1,
                page: 1,
                values: [
                    {
                        id: 11,
                        title: "Open match",
                        state: "OPEN",
                        author: { display_name: "Alice" },
                        source: { branch: { name: "feature/match" } },
                        destination: { branch: { name: "main" } },
                        created_on: "2026-03-25T10:00:00Z",
                        updated_on: "2026-03-25T11:00:00Z",
                        comment_count: 3,
                        links: { html: { href: "https://bitbucket/pr/11" } },
                    },
                ],
            };
        },
    };

    const result = await handleToolCall(
        "find_open_pull_request",
        {
            source_branch: "feature/match",
            destination_branch: "main",
        },
        client,
    );

    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].queryParams, {
        state: "OPEN",
        q: 'source.branch.name="feature/match" AND destination.branch.name="main"',
        page: "1",
        pagelen: "50",
    });
    assert.deepEqual(result, {
        pull_request: {
            id: 11,
            title: "Open match",
            state: "OPEN",
            author: "Alice",
            source_branch: "feature/match",
            destination_branch: "main",
            created_on: "2026-03-25T10:00:00Z",
            updated_on: "2026-03-25T11:00:00Z",
            comment_count: 3,
            link: "https://bitbucket/pr/11",
        },
        truncated: false,
    });
});

test("find_open_pull_request returns null when no open PR matches", async () => {
    const client = {
        repoPath(path) {
            return `/repositories/ws/repo/${path}`;
        },
        async request() {
            return { size: 0, page: 1, values: [] };
        },
    };

    const result = await handleToolCall(
        "find_open_pull_request",
        {
            source_branch: "feature/missing",
        },
        client,
    );

    assert.deepEqual(result, { pull_request: null, truncated: false });
});

test("open_pull_request is a thin alias for create_pull_request", async () => {
    const requests = [];
    const client = {
        defaultDestinationBranch: "",
        repoPath(path) {
            return `/repositories/ws/repo/${path}`;
        },
        async request(method, path, { body } = {}) {
            requests.push({ method, path, body });
            return {
                id: 91,
                title: body.title,
                links: { html: { href: "https://bitbucket/pr/91" } },
            };
        },
    };

    const result = await handleToolCall(
        "open_pull_request",
        {
            title: "Alias PR",
            source_branch: "feature/alias",
            destination_branch: "main",
        },
        client,
    );

    assert.equal(requests.length, 1);
    assert.equal(requests[0].path, "/repositories/ws/repo/pullrequests");
    assert.equal(result.id, 91);
    assert.equal(result.destination_branch, "main");
});

test("create_pull_request uses configured default destination branch when omitted", async () => {
    const client = {
        defaultDestinationBranch: "develop",
        repoPath(path) {
            return `/repositories/ws/repo/${path}`;
        },
        async request(_method, _path, { body } = {}) {
            return {
                id: 88,
                title: body.title,
                links: { html: { href: "https://bitbucket/pr/88" } },
            };
        },
    };

    const result = await handleToolCall(
        "create_pull_request",
        {
            title: "PR default branch",
            source_branch: "feature/default",
        },
        client,
    );

    assert.equal(result.destination_branch, "develop");
});

test("create_pull_request fails without explicit or configured destination branch", async () => {
    const client = {
        defaultDestinationBranch: "",
        repoPath(path) {
            return `/repositories/ws/repo/${path}`;
        },
        async request() {
            throw new Error("should not be called");
        },
    };

    await assert.rejects(
        () =>
            handleToolCall(
                "create_pull_request",
                { title: "No target", source_branch: "feature/x" },
                client,
            ),
        /destination_branch/,
    );
});

test("bb_api rejects non-GET methods", async () => {
    await assert.rejects(
        () =>
            handleToolCall(
                "bb_api",
                { method: "POST", path: "/repositories/ws/repo/pipelines" },
                {},
            ),
        /only supports read-only GET/,
    );
});

test("bb_api rejects paths outside the configured repository scope", async () => {
    const client = {
        repoScope: { workspace: "ws", repoSlug: "repo" },
        async request() {
            throw new Error("should not be called");
        },
    };

    await assert.rejects(
        () =>
            handleToolCall(
                "bb_api",
                { method: "GET", path: "/repositories/other/workspace/pipelines" },
                client,
            ),
        /configured repository/,
    );
});

test("bb_api allows repo-scoped paths", async () => {
    const calls = [];
    const client = {
        repoScope: { workspace: "ws", repoSlug: "repo" },
        async request(method, path, { queryParams } = {}) {
            calls.push({ method, path, queryParams });
            return { values: [] };
        },
    };

    const result = await handleToolCall(
        "bb_api",
        {
            method: "GET",
            path: "/repositories/ws/repo/pipelines",
            queryParams: { state: "SUCCESSFUL" },
        },
        client,
    );

    assert.deepEqual(result, { values: [] });
    assert.deepEqual(calls[0], {
        method: "GET",
        path: "/repositories/ws/repo/pipelines",
        queryParams: { state: "SUCCESSFUL" },
    });
});

test("get_pull_request_commits returns commit summaries", async () => {
    const calls = [];
    const client = {
        repoPath(path) {
            return `/repositories/ws/repo/${path}`;
        },
        async request(method, path, { queryParams } = {}) {
            calls.push({ method, path, queryParams });
            return {
                values: [
                    {
                        hash: "abc123",
                        message: "Add feature",
                        summary: { raw: "Add feature summary" },
                        author: { raw: "Alice <alice@example.com>" },
                        date: "2026-03-26T12:00:00Z",
                        parents: [{ hash: "parent1" }],
                        links: { html: { href: "https://bitbucket/commit/abc123" } },
                    },
                ],
            };
        },
    };

    const result = await handleToolCall("get_pull_request_commits", { pr_id: 42 }, client);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, "/repositories/ws/repo/pullrequests/42/commits");
    assert.deepEqual(calls[0].queryParams, { pagelen: "100" });
    assert.deepEqual(result, {
        count: 1,
        truncated: false,
        commits: [
            {
                hash: "abc123",
                message: "Add feature",
                summary: "Add feature summary",
                author: "Alice <alice@example.com>",
                date: "2026-03-26T12:00:00Z",
                parents: ["parent1"],
                link: "https://bitbucket/commit/abc123",
            },
        ],
    });
});

test("get_pull_request_statuses returns build status summaries", async () => {
    const client = {
        repoPath(path) {
            return `/repositories/ws/repo/${path}`;
        },
        async request() {
            return {
                values: [
                    {
                        key: "CI",
                        name: "CI pipeline",
                        state: "SUCCESSFUL",
                        description: "42 tests passed",
                        refname: "feature/test",
                        url: "https://ci.example.com/build/42",
                        created_on: "2026-03-26T11:00:00Z",
                        updated_on: "2026-03-26T11:05:00Z",
                    },
                ],
            };
        },
    };

    const result = await handleToolCall("get_pull_request_statuses", { pr_id: 42 }, client);

    assert.deepEqual(result, {
        count: 1,
        truncated: false,
        statuses: [
            {
                key: "CI",
                name: "CI pipeline",
                state: "SUCCESSFUL",
                description: "42 tests passed",
                refname: "feature/test",
                url: "https://ci.example.com/build/42",
                created_on: "2026-03-26T11:00:00Z",
                updated_on: "2026-03-26T11:05:00Z",
            },
        ],
    });
});

test("get_pull_request_tasks returns task summaries", async () => {
    const client = {
        repoPath(path) {
            return `/repositories/ws/repo/${path}`;
        },
        async request() {
            return {
                values: [
                    {
                        id: 7,
                        state: "OPEN",
                        content: { raw: "Follow up on naming" },
                        creator: { display_name: "Alice" },
                        created_on: "2026-03-26T10:00:00Z",
                        updated_on: "2026-03-26T10:05:00Z",
                        comment: { id: 99 },
                    },
                ],
            };
        },
    };

    const result = await handleToolCall("get_pull_request_tasks", { pr_id: 42 }, client);

    assert.deepEqual(result, {
        count: 1,
        truncated: false,
        tasks: [
            {
                id: 7,
                state: "OPEN",
                content: "Follow up on naming",
                creator: "Alice",
                created_on: "2026-03-26T10:00:00Z",
                updated_on: "2026-03-26T10:05:00Z",
                comment_id: 99,
            },
        ],
    });
});

test("get_pull_request_pipelines correlates pipelines from PR statuses and full commit hash", async () => {
    const calls = [];
    const client = {
        repoPath(path) {
            return `/repositories/ws/repo/${path}`;
        },
        async request(method, path, { queryParams } = {}) {
            calls.push({ method, path, queryParams });
            if (path === "/repositories/ws/repo/pullrequests/42") {
                return {
                    id: 42,
                    title: "Feature PR",
                    source: {
                        branch: { name: "feature/test" },
                        commit: { hash: "abc123" },
                    },
                    destination: { branch: { name: "main" } },
                    links: { html: { href: "https://bitbucket/pr/42" } },
                };
            }
            if (path === "/repositories/ws/repo/pullrequests/42/statuses") {
                return {
                    values: [
                        {
                            key: "default",
                            state: "SUCCESSFUL",
                            url: "https://bitbucket.org/ws/repo/pipelines/results/201",
                            commit: {
                                hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                            },
                        },
                        {
                            key: "prs:**:main",
                            state: "FAILED",
                            url: "https://bitbucket.org/ws/repo/pipelines/results/202",
                            commit: {
                                hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                            },
                        },
                    ],
                };
            }
            if (path === "/repositories/ws/repo/pipelines") {
                return {
                    values: [
                        {
                            uuid: "{11111111-2222-3333-4444-555555555555}",
                            build_number: 201,
                            state: { name: "COMPLETED", result: { name: "FAILED" } },
                            target: {
                                pullrequest: { id: 42 },
                                ref_name: "feature/test",
                                commit: {
                                    hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                                    message: "feature push",
                                },
                            },
                            links: {
                                html: {
                                    href: "https://bitbucket.org/ws/repo/pipelines/results/201",
                                },
                            },
                        },
                        {
                            uuid: "{66666666-2222-3333-4444-555555555555}",
                            build_number: 202,
                            state: { name: "COMPLETED", result: { name: "SUCCESSFUL" } },
                            target: {
                                pullrequest: { id: 42 },
                                ref_name: "feature/test",
                                commit: {
                                    hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                                    message: "feature push",
                                },
                            },
                            links: {
                                html: {
                                    href: "https://bitbucket.org/ws/repo/pipelines/results/202",
                                },
                            },
                        },
                    ],
                };
            }
            throw new Error(`Unexpected path ${path}`);
        },
    };

    const result = await handleToolCall("get_pull_request_pipelines", { pr_id: 42 }, client);

    assert.equal(calls.length, 3);
    assert.deepEqual(calls[2], {
        method: "GET",
        path: "/repositories/ws/repo/pipelines",
        queryParams: {
            sort: "-created_on",
            pagelen: "20",
            "target.commit.hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
    });
    assert.equal(result.match_mode, "pr_status_commit");
    assert.equal(result.pipeline_count, 2);
    assert.equal(
        result.pull_request.source_commit_hash,
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    assert.equal(result.pull_request.source_commit_hash_source, "pr_statuses");
    assert.deepEqual(
        result.pipelines.map((pipeline) => pipeline.build_number),
        [201, 202],
    );
});

test("get_pull_request_pipelines falls back to source branch when commit correlation is empty", async () => {
    const calls = [];
    const client = {
        repoPath(path) {
            return `/repositories/ws/repo/${path}`;
        },
        async request(method, path, { queryParams } = {}) {
            calls.push({ method, path, queryParams });
            if (path === "/repositories/ws/repo/pullrequests/42") {
                return {
                    id: 42,
                    title: "Feature PR",
                    source: {
                        branch: { name: "feature/test" },
                        commit: { hash: "abc123" },
                    },
                };
            }
            if (path === "/repositories/ws/repo/pullrequests/42/statuses") {
                return {
                    values: [
                        {
                            key: "prs:**:main",
                            state: "FAILED",
                            url: "https://bitbucket.org/ws/repo/pipelines/results/777",
                            commit: {
                                hash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                            },
                        },
                    ],
                };
            }
            if (
                path === "/repositories/ws/repo/pipelines" &&
                queryParams["target.commit.hash"] === "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
            ) {
                return { values: [] };
            }
            if (path === "/repositories/ws/repo/pipelines") {
                return {
                    values: [
                        {
                            uuid: "{77777777-2222-3333-4444-555555555555}",
                            build_number: 301,
                            state: { name: "COMPLETED", result: { name: "FAILED" } },
                            target: {
                                ref_name: "feature/test",
                                commit: { hash: "older", message: "older push" },
                            },
                        },
                    ],
                };
            }
            throw new Error(`Unexpected path ${path}`);
        },
    };

    const result = await handleToolCall("get_pull_request_pipelines", { pr_id: 42 }, client);

    assert.equal(calls.length, 4);
    assert.equal(result.match_mode, "source_branch_fallback");
    assert.equal(result.pipeline_count, 1);
    assert.equal(result.pipelines[0].build_number, 301);
});

test("get_pull_request_pipeline_failure_output aggregates failures across related pipelines", async () => {
    const calls = [];
    const client = {
        repoPath(path) {
            return `/repositories/ws/repo/${path}`;
        },
        async request(method, path, { accept, queryParams } = {}) {
            calls.push({ method, path, accept, queryParams });
            if (path === "/repositories/ws/repo/pullrequests/42") {
                return {
                    id: 42,
                    title: "Feature PR",
                    source: {
                        branch: { name: "feature/test" },
                        commit: { hash: "abc123" },
                    },
                    destination: { branch: { name: "main" } },
                };
            }
            if (path === "/repositories/ws/repo/pullrequests/42/statuses") {
                return {
                    values: [
                        {
                            key: "default",
                            state: "FAILED",
                            url: "https://bitbucket.org/ws/repo/pipelines/results/401",
                            commit: {
                                hash: "cccccccccccccccccccccccccccccccccccccccc",
                            },
                        },
                        {
                            key: "prs:**:main",
                            state: "FAILED",
                            url: "https://bitbucket.org/ws/repo/pipelines/results/402",
                            commit: {
                                hash: "cccccccccccccccccccccccccccccccccccccccc",
                            },
                        },
                    ],
                };
            }
            if (path === "/repositories/ws/repo/pipelines") {
                return {
                    values: [
                        {
                            uuid: "{11111111-2222-3333-4444-555555555555}",
                            build_number: 401,
                            state: { name: "COMPLETED", result: { name: "FAILED" } },
                            target: {
                                pullrequest: { id: 42 },
                                ref_name: "feature/test",
                                commit: {
                                    hash: "cccccccccccccccccccccccccccccccccccccccc",
                                    message: "frontend push",
                                },
                            },
                            links: {
                                html: {
                                    href: "https://bitbucket.org/ws/repo/pipelines/results/401",
                                },
                            },
                        },
                        {
                            uuid: "{22222222-2222-3333-4444-555555555555}",
                            build_number: 402,
                            state: { name: "COMPLETED", result: { name: "FAILED" } },
                            target: {
                                pullrequest: { id: 42 },
                                ref_name: "feature/test",
                                commit: {
                                    hash: "cccccccccccccccccccccccccccccccccccccccc",
                                    message: "backend push",
                                },
                            },
                            links: {
                                html: {
                                    href: "https://bitbucket.org/ws/repo/pipelines/results/402",
                                },
                            },
                        },
                    ],
                };
            }
            if (path.endsWith("/pipelines/{11111111-2222-3333-4444-555555555555}/steps")) {
                return {
                    values: [
                        {
                            uuid: "{aaaaaaaa-2222-3333-4444-555555555555}",
                            name: "Frontend tests",
                            state: { name: "COMPLETED", result: { name: "FAILED" } },
                        },
                    ],
                };
            }
            if (path.endsWith("/pipelines/{22222222-2222-3333-4444-555555555555}/steps")) {
                return {
                    values: [
                        {
                            uuid: "{bbbbbbbb-2222-3333-4444-555555555555}",
                            name: "Backend tests",
                            state: { name: "COMPLETED", result: { name: "FAILED" } },
                        },
                    ],
                };
            }
            if (
                path.endsWith(
                    "/pipelines/{11111111-2222-3333-4444-555555555555}/steps/{aaaaaaaa-2222-3333-4444-555555555555}/log",
                )
            ) {
                return "frontend exploded";
            }
            if (
                path.endsWith(
                    "/pipelines/{22222222-2222-3333-4444-555555555555}/steps/{bbbbbbbb-2222-3333-4444-555555555555}/log",
                )
            ) {
                return "backend exploded";
            }
            throw new Error(`Unexpected path ${path}`);
        },
    };

    const result = await handleToolCall(
        "get_pull_request_pipeline_failure_output",
        { pr_id: 42 },
        client,
    );

    assert.equal(result.match_mode, "pr_status_commit");
    assert.equal(result.pipeline_count, 2);
    assert.equal(result.failure_count, 2);
    assert.deepEqual(
        result.failures.map((failure) => failure.pipeline.build_number),
        [401, 402],
    );
    assert.deepEqual(
        result.failures.map((failure) => failure.failures[0].log),
        ["frontend exploded", "backend exploded"],
    );
});

test("get_pipeline_run returns pipeline summary fields", async () => {
    const calls = [];
    const client = {
        repoPath(path) {
            return `/repositories/ws/repo/${path}`;
        },
        async request(method, path) {
            calls.push({ method, path });
            return {
                uuid: "{11111111-2222-3333-4444-555555555555}",
                build_number: 17,
                state: {
                    name: "COMPLETED",
                    result: { name: "FAILED" },
                },
                target: {
                    ref_name: "feature/test",
                    commit: {
                        hash: "abc123",
                        message: "Break pipeline",
                    },
                },
                creator: { display_name: "Alice" },
                created_on: "2026-03-30T10:00:00Z",
                completed_on: "2026-03-30T10:03:00Z",
                duration_in_seconds: 180,
                links: { html: { href: "https://bitbucket/pipelines/17" } },
            };
        },
    };

    const result = await handleToolCall(
        "get_pipeline_run",
        { pipeline_ref: "11111111-2222-3333-4444-555555555555" },
        client,
    );

    assert.deepEqual(calls, [
        {
            method: "GET",
            path: "/repositories/ws/repo/pipelines/{11111111-2222-3333-4444-555555555555}",
        },
    ]);
    assert.deepEqual(result, {
        pipeline: {
            uuid: "{11111111-2222-3333-4444-555555555555}",
            build_number: 17,
            state: "COMPLETED",
            result: "FAILED",
            branch: "feature/test",
            commit_hash: "abc123",
            commit_message: "Break pipeline",
            creator: "Alice",
            created_on: "2026-03-30T10:00:00Z",
            completed_on: "2026-03-30T10:03:00Z",
            duration_in_seconds: 180,
            link: "https://bitbucket/pipelines/17",
        },
    });
});

test("get_pipeline_failure_output returns failed steps and log output", async () => {
    const calls = [];
    const client = {
        repoPath(path) {
            return `/repositories/ws/repo/${path}`;
        },
        async request(method, path, { accept, queryParams } = {}) {
            calls.push({ method, path, accept, queryParams });
            if (path.endsWith("pipelines/{11111111-2222-3333-4444-555555555555}")) {
                return {
                    uuid: "{11111111-2222-3333-4444-555555555555}",
                    build_number: 18,
                    state: {
                        name: "COMPLETED",
                        result: { name: "FAILED" },
                    },
                    target: { ref_name: "feature/failing" },
                    links: { html: { href: "https://bitbucket/pipelines/18" } },
                };
            }
            if (path.endsWith("pipelines/{11111111-2222-3333-4444-555555555555}/steps")) {
                return {
                    values: [
                        {
                            uuid: "{aaaaaaaa-2222-3333-4444-555555555555}",
                            name: "Unit tests",
                            state: {
                                name: "COMPLETED",
                                result: { name: "FAILED" },
                            },
                            started_on: "2026-03-30T10:00:00Z",
                            completed_on: "2026-03-30T10:02:00Z",
                            links: { html: { href: "https://bitbucket/steps/a" } },
                        },
                        {
                            uuid: "{bbbbbbbb-2222-3333-4444-555555555555}",
                            name: "Build",
                            state: {
                                name: "COMPLETED",
                                result: { name: "SUCCESSFUL" },
                            },
                        },
                    ],
                };
            }
            if (
                path.endsWith(
                    "pipelines/{11111111-2222-3333-4444-555555555555}/steps/{aaaaaaaa-2222-3333-4444-555555555555}/log",
                )
            ) {
                return "TypeError: pipeline exploded";
            }
            throw new Error(`Unexpected path ${path}`);
        },
    };

    const result = await handleToolCall(
        "get_pipeline_failure_output",
        {
            pipeline_ref:
                "https://bitbucket.org/workspace/repo/addon/pipelines/home#!/results/{11111111-2222-3333-4444-555555555555}",
        },
        client,
    );

    assert.equal(calls.length, 3);
    assert.deepEqual(calls[1], {
        method: "GET",
        path: "/repositories/ws/repo/pipelines/{11111111-2222-3333-4444-555555555555}/steps",
        accept: undefined,
        queryParams: { pagelen: "100" },
    });
    assert.equal(calls[2].accept, "application/octet-stream, text/plain;q=0.9, */*;q=0.8");
    assert.equal(result.failure_count, 1);
    assert.deepEqual(result.failures, [
        {
            step: {
                uuid: "{aaaaaaaa-2222-3333-4444-555555555555}",
                name: "Unit tests",
                state: "COMPLETED",
                result: "FAILED",
                started_on: "2026-03-30T10:00:00Z",
                completed_on: "2026-03-30T10:02:00Z",
                duration_in_seconds: null,
                link: "https://bitbucket/steps/a",
            },
            log: "TypeError: pipeline exploded",
            truncated: false,
        },
    ]);
});

test("get_pipeline_run rejects invalid pipeline refs", async () => {
    await assert.rejects(
        () => handleToolCall("get_pipeline_run", { pipeline_ref: "not-a-pipeline" }, {}),
        /pipeline_ref must contain a valid Bitbucket UUID/,
    );
});

test("bb_api normalizes Bitbucket API paths", () => {
    assert.equal(
        normalizeBitbucketApiPath("/repositories/ws/repo/pullrequests"),
        "/2.0/repositories/ws/repo/pullrequests",
    );
    assert.equal(
        normalizeBitbucketApiPath("/2.0/repositories/ws/repo/pullrequests"),
        "/2.0/repositories/ws/repo/pullrequests",
    );
});

test("repo scoped API path helper accepts only the configured repository", () => {
    assert.equal(
        isRepoScopedBitbucketApiPath("/repositories/ws/repo/pipelines", "ws", "repo"),
        true,
    );
    assert.equal(
        isRepoScopedBitbucketApiPath("/repositories/ws/other/pipelines", "ws", "repo"),
        false,
    );
});

test("create_pull_request rejects identical source and destination branches", async () => {
    const client = {
        defaultDestinationBranch: "",
        repoPath(path) {
            return `/repositories/ws/repo/${path}`;
        },
        async request() {
            throw new Error("should not be called");
        },
    };

    await assert.rejects(
        () =>
            handleToolCall(
                "create_pull_request",
                {
                    title: "Same branch",
                    source_branch: "main",
                    destination_branch: "main",
                },
                client,
            ),
        /must differ/,
    );
});

test("add_pull_request_comment requires both file_path and line_to for inline comments", async () => {
    const client = {
        async request() {
            throw new Error("should not be called");
        },
    };

    await assert.rejects(
        () =>
            handleToolCall(
                "add_pull_request_comment",
                {
                    pr_id: 123,
                    content: "Inline comment",
                    file_path: "src/file.js",
                },
                client,
            ),
        /both file_path and line_to/,
    );
});

test("repo scoped API path helper rejects traversal and encoded escapes", () => {
    const rejected = [
        "/repositories/ws/repo/../../workspaces",
        "/repositories/ws/repo/..",
        "/repositories/ws/repo/pipelines/../../other/pipelines",
        "/repositories/ws/repo/./../other",
        "/repositories/ws/repo/%2e%2e/%2e%2e/workspaces",
        "/repositories/ws/repo/%2F..%2Fother",
        "/repositories/ws/repo/..\\..\\other",
        "/repositories/ws/repo\\..\\other",
        "/repositories/ws/repository-other/pipelines",
        "",
    ];
    for (const rawPath of rejected) {
        assert.equal(isRepoScopedBitbucketApiPath(rawPath, "ws", "repo"), false, rawPath);
    }
    assert.equal(isRepoScopedBitbucketApiPath("/2.0/repositories/ws/repo", "ws", "repo"), true);
    assert.equal(
        isRepoScopedBitbucketApiPath("repositories/ws/repo/pullrequests/1", "ws", "repo"),
        true,
    );
    assert.equal(
        isRepoScopedBitbucketApiPath("/repositories/ws/repo/src/main/a..b.txt", "ws", "repo"),
        true,
    );
});

test("bb_api refuses dot-segment traversal out of the repository scope", async () => {
    const client = {
        repoScope: { workspace: "ws", repoSlug: "repo" },
        async request() {
            throw new Error("should not be called");
        },
    };

    await assert.rejects(
        () =>
            handleToolCall(
                "bb_api",
                { method: "GET", path: "/repositories/ws/repo/../../workspaces" },
                client,
            ),
        /configured repository/,
    );
});

function createMergeClient(requests) {
    return {
        repoPath(path) {
            return `/repositories/ws/repo/${path}`;
        },
        async request(method, path, { body } = {}) {
            requests.push({ method, path, body });
            if (method === "GET") {
                return { id: 42, title: "Feature", state: "OPEN" };
            }
            return { state: "MERGED", merge_commit: { hash: "abc123" } };
        },
    };
}

test("merge confirmation tokens are bound to the MCP session that requested them", async () => {
    mergeConfirmations.clear();
    const requests = [];
    const client = createMergeClient(requests);
    const repository = { id: "repo", allowMerge: true };
    const sessionA = { selectedRepository: repository, sessionId: "session-a" };
    const sessionB = { selectedRepository: repository, sessionId: "session-b" };

    const preview = await handleToolCall("merge_pull_request", { pr_id: 42 }, client, sessionA);
    await assert.rejects(
        () =>
            handleToolCall(
                "merge_pull_request",
                { pr_id: 42, confirmation_token: preview.confirmation_token },
                client,
                sessionB,
            ),
        /Invalid confirmation_token/,
    );
    await assert.rejects(
        () =>
            handleToolCall(
                "merge_pull_request",
                { pr_id: 42, confirmation_token: preview.confirmation_token },
                client,
                { selectedRepository: repository },
            ),
        /Invalid confirmation_token/,
    );
    assert.equal(requests.filter((r) => r.method === "POST").length, 0);

    const merged = await handleToolCall(
        "merge_pull_request",
        { pr_id: 42, confirmation_token: preview.confirmation_token },
        client,
        sessionA,
    );
    assert.equal(merged.merged, true);
    mergeConfirmations.clear();
});

test("confirmation store evicts only the oldest token of the same owner", () => {
    const store = createConfirmationStore({ maxPending: 100, maxPendingPerOwner: 2 });
    const victim = store.issue({ prId: 1 }, { owner: "victim" });
    const first = store.issue({ prId: 2 }, { owner: "attacker" });
    store.issue({ prId: 3 }, { owner: "attacker" });
    for (let index = 0; index < 50; index += 1) {
        store.issue({ prId: 4 }, { owner: "attacker" });
    }

    assert.equal(store.size(), 3);
    assert.equal(store.consume(first.token, { prId: 2 }, { owner: "attacker" }).ok, false);
    assert.equal(store.consume(victim.token, { prId: 1 }, { owner: "victim" }).ok, true);
});

test("confirmation store refuses new tokens instead of evicting other owners when full", () => {
    const store = createConfirmationStore({ maxPending: 2, maxPendingPerOwner: 5 });
    const a = store.issue({ prId: 1 }, { owner: "a" });
    store.issue({ prId: 2 }, { owner: "b" });

    assert.throws(
        () => store.issue({ prId: 3 }, { owner: "c" }),
        (error) => error instanceof ConfirmationStoreCapacityError && error.status === 503,
    );
    assert.equal(store.consume(a.token, { prId: 1 }, { owner: "a" }).ok, true);
    assert.ok(store.issue({ prId: 3 }, { owner: "c" }).token);
});

test("a token presented by another owner is not burned", () => {
    const store = createConfirmationStore();
    const issued = store.issue({ prId: 1 }, { owner: "a" });

    assert.equal(
        store.consume(issued.token, { prId: 1 }, { owner: "b" }).reason,
        "unknown_or_expired",
    );
    assert.equal(store.consume(issued.token, { prId: 1 }, { owner: "a" }).ok, true);
});
