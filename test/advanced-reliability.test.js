import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import {
    BitbucketClient,
    BitbucketApiError,
    computeRetryDelayMs,
    truncateUtf8,
} from "../src/lib/bitbucket-client.js";
import { createRuntimeMetrics } from "../src/lib/runtime-metrics.js";
import { MAX_RETRY_DELAY_MS } from "../src/lib/runtime-policy.js";

function createClient(apiBase, overrides = {}) {
    return new BitbucketClient({
        apiBase,
        workspace: "ws",
        repoSlug: "repo",
        userEmail: "dev@example.com",
        apiToken: "runtime-token",
        requestTimeoutMs: 2_000,
        retryMaxAttempts: 1,
        retryBaseDelayMs: 5,
        maxResponseBytes: 1_024,
        defaultDestinationBranch: "main",
        ...overrides,
    });
}

async function withStubBitbucketServer(handler, run) {
    const server = http.createServer(handler);

    await new Promise((resolve, reject) => {
        server.listen(0, "127.0.0.1", (error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });

    const { port } = server.address();
    const apiBase = `http://127.0.0.1:${port}`;

    try {
        await run({ apiBase });
    } finally {
        await new Promise((resolve, reject) => {
            server.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve();
            });
        });
    }
}

test("BitbucketClient reads pipeline step logs served as octet-stream and follows redirects", async () => {
    const seenAccept = [];

    await withStubBitbucketServer(
        (req, res) => {
            seenAccept.push(req.headers.accept);
            if (req.url.endsWith("/log")) {
                res.writeHead(302, { Location: "/download/log.txt" });
                res.end();
                return;
            }
            if (req.url === "/download/log.txt") {
                res.writeHead(200, { "Content-Type": "application/octet-stream" });
                res.end("step output\nline 2");
                return;
            }
            if (req.url.endsWith("/strict")) {
                if (!String(req.headers.accept || "").includes("application/octet-stream")) {
                    res.writeHead(406, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: { message: "Not Acceptable" } }));
                    return;
                }
                res.writeHead(200, { "Content-Type": "application/octet-stream" });
                res.end("strict log");
                return;
            }
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: { message: "nope" } }));
        },
        async ({ apiBase }) => {
            const client = new BitbucketClient({
                apiBase,
                workspace: "ws",
                repoSlug: "repo",
                userEmail: "dev@example.com",
                apiToken: "runtime-token",
                requestTimeoutMs: 2_000,
                retryMaxAttempts: 1,
                retryBaseDelayMs: 5,
                maxResponseBytes: 1_024,
                defaultDestinationBranch: "main",
            });
            const accept = "application/octet-stream, text/plain;q=0.9, */*;q=0.8";

            const log = await client.request(
                "GET",
                "/repositories/ws/repo/pipelines/{p}/steps/{s}/log",
                { accept },
            );
            assert.equal(log, "step output\nline 2");

            const strict = await client.request("GET", "/repositories/ws/repo/strict", { accept });
            assert.equal(strict, "strict log");

            await assert.rejects(
                () =>
                    client.request("GET", "/repositories/ws/repo/strict", { accept: "text/plain" }),
                (error) => error instanceof BitbucketApiError && error.status === 406,
            );
            assert.ok(seenAccept.every(Boolean));
        },
    );
});

test("BitbucketClient retries transient GET failures against a controlled sandbox", async () => {
    let requests = 0;
    const metrics = createRuntimeMetrics();

    await withStubBitbucketServer(
        (req, res) => {
            requests += 1;
            if (requests === 1) {
                res.writeHead(429, {
                    "Content-Type": "application/json",
                    "Retry-After": "0",
                });
                res.end(JSON.stringify({ error: { message: "rate limited" } }));
                return;
            }

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ values: [{ id: 42, title: "Recovered" }] }));
        },
        async ({ apiBase }) => {
            const client = new BitbucketClient({
                apiBase,
                workspace: "ws",
                repoSlug: "repo",
                userEmail: "dev@example.com",
                apiToken: "runtime-token",
                requestTimeoutMs: 2_000,
                retryMaxAttempts: 3,
                retryBaseDelayMs: 5,
                maxResponseBytes: 1_024,
                defaultDestinationBranch: "main",
                metrics,
            });

            const result = await client.request("GET", "/repositories/ws/repo/pipelines");

            assert.equal(requests, 2);
            assert.deepEqual(result, { values: [{ id: 42, title: "Recovered" }] });
            assert.equal(metrics.snapshot().bitbucket.requestsTotal, 1);
            assert.equal(metrics.snapshot().bitbucket.retriesTotal, 1);
        },
    );
});

test("BitbucketClient does not retry write requests on Bitbucket failures", async () => {
    let requests = 0;
    const metrics = createRuntimeMetrics();

    await withStubBitbucketServer(
        (req, res) => {
            requests += 1;
            res.writeHead(503, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: { message: "temporary outage" } }));
        },
        async ({ apiBase }) => {
            const client = new BitbucketClient({
                apiBase,
                workspace: "ws",
                repoSlug: "repo",
                userEmail: "dev@example.com",
                apiToken: "runtime-token",
                requestTimeoutMs: 2_000,
                retryMaxAttempts: 3,
                retryBaseDelayMs: 5,
                maxResponseBytes: 1_024,
                defaultDestinationBranch: "main",
                metrics,
            });

            await assert.rejects(
                () =>
                    client.request("POST", "/repositories/ws/repo/pullrequests", {
                        body: { title: "No retry" },
                    }),
                (error) => {
                    assert.equal(error instanceof BitbucketApiError, true);
                    assert.equal(error.status, 503);
                    return true;
                },
            );

            const snapshot = metrics.snapshot();
            assert.equal(requests, 1);
            assert.equal(snapshot.bitbucket.requestsTotal, 1);
            assert.equal(snapshot.bitbucket.retriesTotal, 0);
            assert.equal(snapshot.bitbucket.failuresTotal, 1);
        },
    );
});

test("retry delays honour Retry-After but never exceed the configured ceiling", () => {
    assert.equal(MAX_RETRY_DELAY_MS, 40_000);
    assert.equal(computeRetryDelayMs(1, 250, 0), 250);
    assert.equal(computeRetryDelayMs(3, 250, 0), 1_000);
    assert.equal(computeRetryDelayMs(1, 250, 2_000), 2_000);
    assert.equal(computeRetryDelayMs(1, 250, 3_600_000), MAX_RETRY_DELAY_MS);
    assert.equal(computeRetryDelayMs(5, 5_000, 0), MAX_RETRY_DELAY_MS);
});

test("BitbucketClient caps a huge Retry-After header before sleeping", async () => {
    let requests = 0;
    const sleeps = [];

    await withStubBitbucketServer(
        (req, res) => {
            requests += 1;
            if (requests === 1) {
                res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "3600" });
                res.end(JSON.stringify({ error: { message: "slow down" } }));
                return;
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
        },
        async ({ apiBase }) => {
            const client = createClient(apiBase, {
                retryMaxAttempts: 2,
                sleep: async (delayMs) => {
                    sleeps.push(delayMs);
                },
            });

            const result = await client.request("GET", "/repositories/ws/repo/pullrequests");
            assert.deepEqual(result, { ok: true });
            assert.deepEqual(sleeps, [MAX_RETRY_DELAY_MS]);
        },
    );
});

test("BitbucketClient rejects JSON bodies larger than maxResponseBytes", async () => {
    await withStubBitbucketServer(
        (req, res) => {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ values: ["x".repeat(4_096)] }));
        },
        async ({ apiBase }) => {
            const client = createClient(apiBase);
            await assert.rejects(
                () => client.request("GET", "/repositories/ws/repo/pullrequests"),
                (error) => {
                    assert.equal(error instanceof BitbucketApiError, true);
                    assert.match(error.message, /exceeds the 1024 byte limit/);
                    return true;
                },
            );
        },
    );
});

test("BitbucketClient fails explicitly on malformed JSON from a successful response", async () => {
    let requests = 0;

    await withStubBitbucketServer(
        (req, res) => {
            requests += 1;
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(req.url.endsWith("/empty") ? "" : "{not json");
        },
        async ({ apiBase }) => {
            const client = createClient(apiBase, { retryMaxAttempts: 3 });
            await assert.rejects(
                () => client.request("GET", "/repositories/ws/repo/pullrequests"),
                (error) => {
                    assert.equal(error instanceof BitbucketApiError, true);
                    assert.equal(error.status, 200);
                    assert.match(error.message, /malformed JSON/);
                    return true;
                },
            );
            assert.equal(requests, 1);

            assert.deepEqual(await client.request("GET", "/repositories/ws/repo/empty"), {});
        },
    );
});

test("BitbucketClient truncates text bodies on UTF-8 byte boundaries", async () => {
    await withStubBitbucketServer(
        (req, res) => {
            res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("abcd\u20ac\u20ac");
        },
        async ({ apiBase }) => {
            const client = createClient(apiBase, { maxResponseBytes: 6 });
            const text = await client.request("GET", "/repositories/ws/repo/diff", {
                accept: "text/plain",
            });
            assert.equal(text, "abcd");
        },
    );
});

test("truncateUtf8 limits bytes without splitting code points", () => {
    assert.deepEqual(truncateUtf8("plain", 10), { text: "plain", truncated: false });
    assert.deepEqual(truncateUtf8("\u00e8\u00e8\u00e8", 5), {
        text: "\u00e8\u00e8",
        truncated: true,
    });
    assert.deepEqual(truncateUtf8("a\u{1F600}b", 4), { text: "a", truncated: true });
    assert.equal(Buffer.byteLength(truncateUtf8("\u20ac".repeat(10), 10).text), 9);
});
