import * as logger from "./logger.js";

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
    401: "Auth failed. Verifica BITBUCKET_USER_EMAIL / BITBUCKET_API_TOKEN.",
    403: "Permission denied. Verifica scope API Token (Repositories: Read, Pull requests: Read+Write).",
    404: "Risorsa non trovata.",
    429: "Rate limited da Bitbucket. Riprova tra qualche secondo.",
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

function computeRetryDelayMs(attempt, baseDelayMs, retryAfterMs) {
    if (retryAfterMs > 0) {
        return retryAfterMs;
    }
    return baseDelayMs * 2 ** Math.max(0, attempt - 1);
}

export function normalizeBitbucketApiPath(rawPath) {
    const apiPath = String(rawPath || "").trim();
    if (!apiPath) {
        throw new Error("API path Bitbucket mancante.");
    }
    if (!apiPath.startsWith("/2.0/") && !apiPath.startsWith("/2.0")) {
        return `/2.0${apiPath.startsWith("/") ? "" : "/"}${apiPath}`;
    }
    return apiPath;
}

export function isRepoScopedBitbucketApiPath(rawPath, workspace, repoSlug) {
    const normalizedPath = normalizeBitbucketApiPath(rawPath);
    const normalizedPrefix = normalizeBitbucketApiPath(`/repositories/${workspace}/${repoSlug}`);
    return normalizedPath === normalizedPrefix || normalizedPath.startsWith(`${normalizedPrefix}/`);
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
                    error: `Request timeout dopo ${this._timeoutMs}ms.`,
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
        const isText = contentType.includes("text/") || accept === "text/plain";

        let responseBody;
        if (isText && !isJson) {
            responseBody = await response.text();
            if (responseBody.length > this._maxBytes) {
                responseBody = responseBody.slice(0, this._maxBytes);
            }
        } else {
            responseBody = await response.json().catch(() => ({}));
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
