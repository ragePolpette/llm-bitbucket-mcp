function incrementCounter(map, key, amount = 1) {
    map[key] = (map[key] || 0) + amount;
}

function normalizeStatusBucket(statusCode) {
    if (!Number.isInteger(statusCode) || statusCode <= 0) {
        return "network";
    }
    const family = Math.floor(statusCode / 100);
    if (family >= 1 && family <= 5) {
        return `${family}xx`;
    }
    return "other";
}

export function createRuntimeMetrics() {
    const state = {
        http: {
            requestsTotal: 0,
            methods: {},
            responsesTotal: 0,
            statusBuckets: {},
        },
        tools: {
            callsTotal: 0,
            failuresTotal: 0,
            byTool: {},
        },
        bitbucket: {
            requestsTotal: 0,
            failuresTotal: 0,
            retriesTotal: 0,
            methods: {},
            failureStatusBuckets: {},
        },
    };

    return {
        recordHttpRequest(method) {
            state.http.requestsTotal += 1;
            incrementCounter(state.http.methods, String(method || "UNKNOWN").toUpperCase());
        },

        recordHttpResponse(statusCode) {
            state.http.responsesTotal += 1;
            incrementCounter(state.http.statusBuckets, normalizeStatusBucket(statusCode));
        },

        recordToolCall(toolName, outcome = "success") {
            const tool = String(toolName || "unknown");
            state.tools.callsTotal += 1;
            if (!state.tools.byTool[tool]) {
                state.tools.byTool[tool] = { success: 0, failure: 0 };
            }

            if (outcome === "failure") {
                state.tools.failuresTotal += 1;
                state.tools.byTool[tool].failure += 1;
                return;
            }

            state.tools.byTool[tool].success += 1;
        },

        recordBitbucketRequest(method) {
            state.bitbucket.requestsTotal += 1;
            incrementCounter(state.bitbucket.methods, String(method || "UNKNOWN").toUpperCase());
        },

        recordBitbucketRetry(statusCode) {
            state.bitbucket.retriesTotal += 1;
            incrementCounter(
                state.bitbucket.failureStatusBuckets,
                normalizeStatusBucket(statusCode),
            );
        },

        recordBitbucketFailure(statusCode) {
            state.bitbucket.failuresTotal += 1;
            incrementCounter(
                state.bitbucket.failureStatusBuckets,
                normalizeStatusBucket(statusCode),
            );
        },

        snapshot() {
            return JSON.parse(JSON.stringify(state));
        },
    };
}
