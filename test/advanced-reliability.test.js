import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { BitbucketClient, BitbucketApiError } from "../src/lib/bitbucket-client.js";
import { createRuntimeMetrics } from "../src/lib/runtime-metrics.js";

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
