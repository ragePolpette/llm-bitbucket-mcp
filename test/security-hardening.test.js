import test from "node:test";
import assert from "node:assert/strict";
import { handleToolCall } from "../src/lib/handlers.js";
import {
    isRepoScopedBitbucketApiPath,
    normalizeBitbucketApiPath,
} from "../src/lib/bitbucket-client.js";

test("still-hidden pull request mutation handlers are rejected by dispatcher", async () => {
    await assert.rejects(
        () => handleToolCall("approve_pull_request", { pr_id: 123 }, {}),
        /Tool non supportato/,
    );
    await assert.rejects(
        () => handleToolCall("merge_pull_request", { pr_id: 123 }, {}),
        /Tool non supportato/,
    );
});

test("bitbucket_info exposes tool map and runtime branch semantics", async () => {
    const result = await handleToolCall(
        "bitbucket_info",
        {},
        { defaultDestinationBranch: "develop" },
    );

    assert.equal(result.server, "llm-bitbucket-mcp");
    assert.ok(result.tool_map.discovery.includes("find_open_pull_request"));
    assert.ok(result.tool_map.pr_write.includes("open_pull_request"));
    assert.deepEqual(result.tool_map.utility, ["bb_api"]);
    assert.equal(result.runtime_options.default_destination_branch, "develop");
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

    assert.deepEqual(result, { pull_request: null });
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
        /solo richieste read-only GET/,
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
        /repository configurato/,
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
        /non possono coincidere/,
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
        /sia file_path sia line_to/,
    );
});
