import * as logger from "./logger.js";
import { MAX_RETRY_DELAY_MS } from "./runtime-policy.js";

export class BitbucketApiError extends Error {
    constructor(status, statusText, body) {
        const msg = body?.error?.message || body?.error || statusText;
        super(`Bitbucket API ${status}: ${msg}`);
        this.status = status;
        this.statusText = statusText;
        this.body = body;
    }
}

const FRIENDLY_ERRORS = {
    401: "Auth failed. Check BITBUCKET_USER_EMAIL / BITBUCKET_API_TOKEN.",
    403: "Permission denied. Check the API token scopes (Repositories: Read, Pull requests: Read+Write, Pipelines: Read/Write for pipeline tools).",
    404: "Resource not found.",
    406: "Not Acceptable. Bitbucket cannot serve the resource in the requested format (Accept header).",
    429: "Rate limited by Bitbucket. Retry in a few seconds.",
};
const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);

function wait(delayMs) {
    return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function parseRetryAfterMs(retryAfterHeader) {
    const rawValue = String(retryAfterHeader || "").trim();
    if (!rawValue) {
        return 0;
    }

    const seconds = Number(rawValue);
    if (Number.isFinite(seconds) && seconds >= 0) {
        return seconds * 1000;
    }

    const dateValue = Date.parse(rawValue);
    if (Number.isNaN(dateValue)) {
        return 0;
    }

    return Math.max(0, dateValue - Date.now());
}

export function computeRetryDelayMs(attempt, baseDelayMs, retryAfterMs) {
    const delayMs = retryAfterMs > 0 ? retryAfterMs : baseDelayMs * 2 ** Math.max(0, attempt - 1);
    return Math.min(delayMs, MAX_RETRY_DELAY_MS);
}

async function readBodyBytes(response, maxBytes) {
    if (!response.body || typeof response.body.getReader !== "function") {
        const buffer = Buffer.from(await response.arrayBuffer());
        return buffer.length > maxBytes
            ? { bytes: buffer.subarray(0, maxBytes), truncated: true }
            : { bytes: buffer, truncated: false };
    }

    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    let truncated = false;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const remaining = maxBytes - total;
        if (value.byteLength > remaining) {
            chunks.push(Buffer.from(value.buffer, value.byteOffset, remaining));
            total += remaining;
            truncated = true;
            await reader.cancel().catch(() => {});
            break;
        }
        chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
        total += value.byteLength;
    }
    return { bytes: Buffer.concat(chunks, total), truncated };
}

export function decodeUtf8Prefix(bytes) {
    // stream: true keeps an incomplete trailing code point buffered instead of emitting U+FFFD.
    return new TextDecoder("utf-8").decode(bytes, { stream: true });
}

export function truncateUtf8(text, maxBytes) {
    const value = String(text ?? "");
    const bytes = Buffer.from(value, "utf8");
    if (bytes.length <= maxBytes) {
        return { text: value, truncated: false };
    }
    return { text: decodeUtf8Prefix(bytes.subarray(0, maxBytes)), truncated: true };
}

export function normalizeBitbucketApiPath(rawPath) {
    const apiPath = String(rawPath || "").trim();
    if (!apiPath) {
        throw new Error("Missing Bitbucket API path.");
    }
    if (!apiPath.startsWith("/2.0/") && !apiPath.startsWith("/2.0")) {
        return `/2.0${apiPath.startsWith("/") ? "" : "/"}${apiPath}`;
    }
    return apiPath;
}

const UNSAFE_API_PATH_PATTERN = /[\\%]|(?:^|\/)\.{1,2}(?:[/?#]|$)/;

export function isRepoScopedBitbucketApiPath(rawPath, workspace, repoSlug) {
    let normalizedPath;
    try {
        normalizedPath = normalizeBitbucketApiPath(rawPath);
    } catch {
        return false;
    }
    if (UNSAFE_API_PATH_PATTERN.test(normalizedPath)) {
        return false;
    }

    let resolvedPath;
    try {
        resolvedPath = new URL(normalizedPath, "https://bitbucket.invalid").pathname;
    } catch {
        return false;
    }
    const normalizedPrefix = normalizeBitbucketApiPath(`/repositories/${workspace}/${repoSlug}`);
    return resolvedPath === normalizedPrefix || resolvedPath.startsWith(`${normalizedPrefix}/`);
}

function parseJsonBody(bytes, status, strict) {
    const text = decodeUtf8Prefix(bytes).trim();
    if (!text) {
        return {};
    }
    try {
        return JSON.parse(text);
    } catch {
        if (!strict) {
            return {};
        }
        throw new BitbucketApiError(status, "InvalidJson", {
            error: "Bitbucket returned a malformed JSON response.",
        });
    }
}

export class BitbucketClient {
    constructor({
        apiBase,
        workspace,
        repoSlug,
        userEmail,
        apiToken,
        requestTimeoutMs,
        retryMaxAttempts,
        retryBaseDelayMs,
        maxResponseBytes,
        defaultDestinationBranch,
        metrics,
        fetchImpl = fetch,
        sleep = wait,
    }) {
        this._apiBase = apiBase;
        this._workspace = workspace;
        this._repoSlug = repoSlug;
        this._defaultDestinationBranch = String(defaultDestinationBranch || "").trim();
        this._authHeader = "Basic " + Buffer.from(`${userEmail}:${apiToken}`).toString("base64");
        this._timeoutMs = requestTimeoutMs;
        this._retryMaxAttempts = retryMaxAttempts;
        this._retryBaseDelayMs = retryBaseDelayMs;
        this._maxBytes = maxResponseBytes;
        this._metrics = metrics;
        this._fetch = fetchImpl;
        this._sleep = sleep;
    }

    repoPath(suffix) {
        return `/repositories/${this._workspace}/${this._repoSlug}/${suffix}`;
    }

    get defaultDestinationBranch() {
        return this._defaultDestinationBranch;
    }

    get repoScope() {
        return {
            workspace: this._workspace,
            repoSlug: this._repoSlug,
        };
    }

    async request(method, rawPath, { body, queryParams, accept } = {}) {
        this._metrics?.recordBitbucketRequest(method);
        let lastError = null;

        for (let attempt = 1; attempt <= this._retryMaxAttempts; attempt += 1) {
            try {
                return await this.#requestOnce(method, rawPath, { body, queryParams, accept });
            } catch (error) {
                lastError = error;
                const isFinalAttempt = attempt >= this._retryMaxAttempts;
                if (!this.#shouldRetry(method, error, isFinalAttempt)) {
                    this._metrics?.recordBitbucketFailure(error?.status || 0);
                    throw error;
                }

                const delayMs = computeRetryDelayMs(
                    attempt,
                    this._retryBaseDelayMs,
                    error.retryAfterMs || 0,
                );
                this._metrics?.recordBitbucketRetry(error?.status || 0);
                logger.logWarn("bitbucket_retry", {
                    method,
                    path: normalizeBitbucketApiPath(rawPath),
                    status: error?.status || 0,
                    attempt,
                    delay_ms: delayMs,
                });
                await this._sleep(delayMs);
            }
        }

        this._metrics?.recordBitbucketFailure(lastError?.status || 0);
        throw lastError;
    }

    #shouldRetry(method, error, isFinalAttempt) {
        if (String(method || "").toUpperCase() !== "GET" || isFinalAttempt) {
            return false;
        }

        const status = error?.status || 0;
        return status === 0 || RETRYABLE_STATUS_CODES.has(status);
    }

    async #requestOnce(method, rawPath, { body, queryParams, accept } = {}) {
        const apiPath = normalizeBitbucketApiPath(rawPath);
        const url = new URL(apiPath, this._apiBase);
        if (queryParams) {
            for (const [key, value] of Object.entries(queryParams)) {
                if (value !== undefined && value !== null && value !== "") {
                    url.searchParams.set(key, String(value));
                }
            }
        }

        const headers = {
            Authorization: this._authHeader,
            Accept: accept || "application/json",
        };
        const fetchOptions = { method, headers };

        if (body && ["POST", "PUT", "PATCH"].includes(method)) {
            headers["Content-Type"] = "application/json";
            fetchOptions.body = JSON.stringify(body);
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this._timeoutMs);
        fetchOptions.signal = controller.signal;

        let response;
        try {
            response = await this._fetch(url.toString(), fetchOptions);
        } catch (err) {
            clearTimeout(timer);
            if (err.name === "AbortError") {
                throw new BitbucketApiError(0, "Timeout", {
                    error: `Request timed out after ${this._timeoutMs}ms.`,
                });
            }
            throw new BitbucketApiError(0, "NetworkError", { error: err.message });
        } finally {
            clearTimeout(timer);
        }

        if (response.status === 204) {
            return { success: true, status: 204 };
        }

        const contentType = response.headers.get("content-type") || "";
        const isJson = contentType.includes("application/json");
        const wantsText = Boolean(accept) && !String(accept).includes("application/json");
        const isText =
            contentType.includes("text/") ||
            contentType.includes("application/octet-stream") ||
            wantsText;

        const { bytes, truncated } = await readBodyBytes(response, this._maxBytes);
        let responseBody;
        if (isText && !isJson) {
            responseBody = decodeUtf8Prefix(bytes);
        } else if (truncated) {
            throw new BitbucketApiError(response.status, "ResponseTooLarge", {
                error: `Bitbucket response exceeds the ${this._maxBytes} byte limit.`,
            });
        } else {
            responseBody = parseJsonBody(bytes, response.status, response.ok);
        }

        if (!response.ok) {
            const friendly = FRIENDLY_ERRORS[response.status];
            const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
            if (friendly) {
                const err = new BitbucketApiError(response.status, friendly, responseBody);
                err.retryAfterMs = retryAfterMs;
                throw err;
            }
            const err = new BitbucketApiError(response.status, response.statusText, responseBody);
            err.retryAfterMs = retryAfterMs;
            throw err;
        }

        return responseBody;
    }
}
