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
        maxResponseBytes,
        defaultDestinationBranch,
    }) {
        this._apiBase = apiBase;
        this._workspace = workspace;
        this._repoSlug = repoSlug;
        this._defaultDestinationBranch = String(defaultDestinationBranch || "").trim();
        this._authHeader = "Basic " + Buffer.from(`${userEmail}:${apiToken}`).toString("base64");
        this._timeoutMs = requestTimeoutMs;
        this._maxBytes = maxResponseBytes;
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
            response = await fetch(url.toString(), fetchOptions);
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
            if (friendly) {
                const err = new BitbucketApiError(response.status, friendly, responseBody);
                throw err;
            }
            throw new BitbucketApiError(response.status, response.statusText, responseBody);
        }

        return responseBody;
    }
}
