import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { handleToolCall } from "../src/lib/handlers.js";
import { assertCloneBasePathAllowed, normalizeBitbucketApiPath } from "../src/lib/bitbucket-client.js";
import { resolveCloneRoot } from "../src/lib/config.js";

test("hidden pull request mutation handlers are rejected by dispatcher", async () => {
    await assert.rejects(
        () => handleToolCall("create_pull_request", { title: "x", source_branch: "y" }, {}),
        /Tool non supportato/
    );
});

test("bb_api rejects non-GET methods", async () => {
    await assert.rejects(
        () => handleToolCall("bb_api", { method: "POST", path: "/repositories/ws/repo/pipelines" }, {}),
        /solo richieste read-only GET/
    );
});

test("bb_api normalizes Bitbucket API paths", () => {
    assert.equal(
        normalizeBitbucketApiPath("/repositories/ws/repo/pullrequests"),
        "/2.0/repositories/ws/repo/pullrequests"
    );
    assert.equal(
        normalizeBitbucketApiPath("/2.0/repositories/ws/repo/pullrequests"),
        "/2.0/repositories/ws/repo/pullrequests"
    );
});

test("clone target path must stay within configured clone root", () => {
    const cloneRoot = path.resolve("C:/tmp/bitbucket-clones");
    const allowed = path.join(cloneRoot, "nested", "repo-name");
    assert.equal(assertCloneBasePathAllowed(allowed, cloneRoot), allowed);

    assert.throws(
        () => assertCloneBasePathAllowed("C:/tmp/outside", cloneRoot),
        /clone root configurata/
    );
});

test("clone target path is the final destination path", () => {
    const cloneRoot = path.resolve("C:/tmp/bitbucket-clones");
    const finalClonePath = path.join(cloneRoot, "team", "custom-repo-dir");
    assert.equal(assertCloneBasePathAllowed(finalClonePath, cloneRoot), finalClonePath);
});

test("default clone root resolves under current working directory", () => {
    const cwd = "C:/workspace/llm-bitbucket-mcp";
    assert.equal(
        resolveCloneRoot("", cwd),
        path.resolve(cwd, "_clones")
    );
});
