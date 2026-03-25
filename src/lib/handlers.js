import * as logger from "./logger.js";
import { isRepoScopedBitbucketApiPath, normalizeBitbucketApiPath } from "./bitbucket-client.js";

const MAX_BRANCH_NAME_LENGTH = 255;
const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 10000;
const MAX_COMMENT_LENGTH = 10000;
const MAX_FILE_PATH_LENGTH = 500;
const MAX_REVIEWERS = 10;
const MAX_QUERY_PARAMS = 20;
const MAX_QUERY_VALUE_LENGTH = 200;
const ALLOWED_PR_STATES = new Set(["OPEN", "MERGED", "DECLINED", "SUPERSEDED"]);

// ── Dispatch ─────────────────────────────────────────────────────

export async function handleToolCall(name, args, client) {
    switch (name) {
        case "bitbucket_info":
            return handleBitbucketInfo(client);
        case "list_pull_requests":
            return handleListPRs(args, client);
        case "find_open_pull_request":
            return handleFindOpenPR(args, client);
        case "get_pull_request":
            return handleGetPR(args, client);
        case "get_pull_request_diff":
            return handleGetPRDiff(args, client);
        case "get_pull_request_comments":
            return handleGetPRComments(args, client);
        case "add_pull_request_comment":
            return handleAddPRComment(args, client);
        case "create_pull_request":
            return handleCreatePR(args, client);
        case "open_pull_request":
            return handleCreatePR(args, client);
        case "bb_clone":
            return handleClone(args, client);
        case "bb_api":
            return handleGenericApi(args, client);
        default:
            throw new Error(`Tool non supportato: ${name}`);
    }
}

function handleBitbucketInfo(client) {
    return {
        server: "llm-bitbucket-mcp",
        purpose: "Bitbucket Cloud MCP focalizzato su PR, read API e clone workspace-aware.",
        tool_map: {
            discovery: [
                "bitbucket_info",
                "list_pull_requests",
                "find_open_pull_request",
                "get_pull_request",
                "get_pull_request_diff",
                "get_pull_request_comments",
            ],
            pr_write: ["create_pull_request", "open_pull_request", "add_pull_request_comment"],
            utility: ["bb_clone", "bb_api"],
        },
        usage_notes: {
            find_open_pull_request:
                "Usa source_branch esatto; destination_branch e' opzionale ma consigliato per evitare ambiguita.",
            create_pull_request:
                "Richiede title e source_branch. destination_branch puo' arrivare dal payload oppure da BITBUCKET_DEFAULT_DESTINATION_BRANCH.",
            open_pull_request: "Alias ergonomico di create_pull_request con lo stesso contract.",
            bb_api: "Solo GET read-only, limitato agli endpoint del repository configurato.",
            bb_clone:
                "Clona dentro la clone root configurata; targetPath deve restare sotto quella root e deve essere nuovo.",
        },
        runtime_options: {
            default_destination_branch_configured: Boolean(client.defaultDestinationBranch),
            default_destination_branch: client.defaultDestinationBranch || null,
        },
        boundaries: [
            "Gestisce operazioni Bitbucket remote e clone locale controllato.",
            "Non espone checkout_branch o create_commit del workspace locale.",
            "Per git locale usare l'harness o un eventuale MCP git dedicato.",
        ],
    };
}

// ── PR read handlers ─────────────────────────────────────────────

async function handleListPRs(args, client) {
    validateOptionalEnum(args.state, "state", ALLOWED_PR_STATES);
    validateOptionalString(args.source_branch, "source_branch", {
        maxLength: MAX_BRANCH_NAME_LENGTH,
    });
    validateOptionalInteger(args.page, "page", { min: 1 });
    validateOptionalInteger(args.pagelen, "pagelen", { min: 1, max: 50 });

    const result = await listPullRequests(args, client);
    return {
        count: result.size,
        page: result.page,
        pull_requests: (result.values || []).map(mapPrSummary),
    };
}

async function handleFindOpenPR(args, client) {
    requireStringParam(args, "source_branch", { maxLength: MAX_BRANCH_NAME_LENGTH });
    validateOptionalString(args.destination_branch, "destination_branch", {
        maxLength: MAX_BRANCH_NAME_LENGTH,
    });
    validateOptionalInteger(args.pagelen, "pagelen", { min: 1, max: 50 });

    const queryArgs = {
        state: "OPEN",
        source_branch: args.source_branch,
        destination_branch: args.destination_branch,
        pagelen: args.pagelen || 50,
    };

    let page = 1;
    while (true) {
        const result = await listPullRequests({ ...queryArgs, page }, client);
        const match = (result.values || []).find((pr) => isExactOpenMatch(pr, args));
        if (match) {
            return { pull_request: mapPrSummary(match) };
        }
        if (!result.next) {
            return { pull_request: null };
        }
        const nextUrl = new URL(result.next);
        const nextPage = Number(nextUrl.searchParams.get("page"));
        page = Number.isFinite(nextPage) && nextPage > 0 ? nextPage : page + 1;
    }
}

async function handleGetPR(args, client) {
    requirePositiveIntegerParam(args, "pr_id");

    logger.logApiCall("GET", `pullrequests/${args.pr_id}`, "get_pull_request", "in", {});
    const pr = await client.request("GET", client.repoPath(`pullrequests/${args.pr_id}`));
    logger.logApiCall("GET", `pullrequests/${args.pr_id}`, "get_pull_request", "out", {
        success: true,
    });

    return {
        id: pr.id,
        title: pr.title,
        description: pr.description || "",
        state: pr.state,
        author: pr.author?.display_name,
        reviewers: (pr.reviewers || []).map((r) => ({
            display_name: r.display_name,
            uuid: r.uuid,
        })),
        participants: (pr.participants || []).map((p) => ({
            display_name: p.user?.display_name,
            role: p.role,
            approved: p.approved,
        })),
        source_branch: pr.source?.branch?.name,
        destination_branch: pr.destination?.branch?.name,
        created_on: pr.created_on,
        updated_on: pr.updated_on,
        close_source_branch: pr.close_source_branch,
        comment_count: pr.comment_count,
        task_count: pr.task_count,
        link: pr.links?.html?.href,
    };
}

async function handleGetPRDiff(args, client) {
    requirePositiveIntegerParam(args, "pr_id");

    logger.logApiCall("GET", `pullrequests/${args.pr_id}/diff`, "get_pull_request_diff", "in", {});
    const text = await client.request("GET", client.repoPath(`pullrequests/${args.pr_id}/diff`), {
        accept: "text/plain",
    });
    logger.logApiCall("GET", `pullrequests/${args.pr_id}/diff`, "get_pull_request_diff", "out", {
        success: true,
    });

    const maxBytes = 500 * 1024;
    const diffText = typeof text === "string" ? text : JSON.stringify(text);
    if (diffText.length > maxBytes) {
        return {
            diff: diffText.slice(0, maxBytes),
            truncated: true,
            warning: `Diff troncato a ${maxBytes} bytes.`,
        };
    }
    return { diff: diffText, truncated: false };
}

async function handleGetPRComments(args, client) {
    requirePositiveIntegerParam(args, "pr_id");

    logger.logApiCall(
        "GET",
        `pullrequests/${args.pr_id}/comments`,
        "get_pull_request_comments",
        "in",
        {},
    );

    const allComments = [];
    let nextPath = client.repoPath(`pullrequests/${args.pr_id}/comments`);
    const maxComments = 500;
    let isFirstPage = true;

    while (nextPath && allComments.length < maxComments) {
        const qp = isFirstPage ? { pagelen: "100" } : {};
        const result = await client.request("GET", nextPath, { queryParams: qp });
        for (const c of result.values || []) {
            allComments.push({
                id: c.id,
                author: c.user?.display_name,
                content: c.content?.raw,
                created_on: c.created_on,
                updated_on: c.updated_on,
                inline: c.inline || null,
                parent_id: c.parent?.id || null,
            });
        }
        if (result.next) {
            const nextUrl = new URL(result.next);
            nextPath = nextUrl.pathname + nextUrl.search;
        } else {
            nextPath = null;
        }
        isFirstPage = false;
    }

    logger.logApiCall(
        "GET",
        `pullrequests/${args.pr_id}/comments`,
        "get_pull_request_comments",
        "out",
        {
            success: true,
            result_count: allComments.length,
            has_results: allComments.length > 0,
        },
    );

    return {
        count: allComments.length,
        truncated: allComments.length >= maxComments,
        comments: allComments,
    };
}

// ── PR write handlers ────────────────────────────────────────────

async function handleAddPRComment(args, client) {
    requirePositiveIntegerParam(args, "pr_id");
    requireStringParam(args, "content", { maxLength: MAX_COMMENT_LENGTH });
    validateInlineCommentArgs(args);

    const body = { content: { raw: args.content } };
    if (args.file_path && args.line_to) {
        body.inline = { path: args.file_path, to: args.line_to };
    }

    const isInline = !!(args.file_path && args.line_to);
    logger.logApiCall(
        "POST",
        `pullrequests/${args.pr_id}/comments`,
        "add_pull_request_comment",
        "in",
        {
            inline: isInline,
            content_length: String(args.content.length),
        },
    );
    const result = await client.request(
        "POST",
        client.repoPath(`pullrequests/${args.pr_id}/comments`),
        { body },
    );
    logger.logApiCall(
        "POST",
        `pullrequests/${args.pr_id}/comments`,
        "add_pull_request_comment",
        "out",
        {
            success: true,
            entry_id: result.id,
        },
    );

    return { success: true, comment_id: result.id, link: result.links?.html?.href };
}

async function handleCreatePR(args, client) {
    requireStringParam(args, "title", { maxLength: MAX_TITLE_LENGTH });
    requireStringParam(args, "source_branch", { maxLength: MAX_BRANCH_NAME_LENGTH });
    validateOptionalString(args.description, "description", { maxLength: MAX_DESCRIPTION_LENGTH });
    validateOptionalBoolean(args.close_source_branch, "close_source_branch");
    validateReviewerList(args.reviewers);

    const destinationBranch = String(
        args.destination_branch || client.defaultDestinationBranch || "",
    ).trim();
    if (!destinationBranch) {
        throw new Error(
            "Parametro obbligatorio mancante: destination_branch. " +
                "Passalo esplicitamente oppure configura BITBUCKET_DEFAULT_DESTINATION_BRANCH.",
        );
    }
    validateString(destinationBranch, "destination_branch", { maxLength: MAX_BRANCH_NAME_LENGTH });
    if (destinationBranch === args.source_branch) {
        throw new Error("source_branch e destination_branch non possono coincidere.");
    }

    const body = {
        title: args.title,
        source: { branch: { name: args.source_branch } },
        destination: { branch: { name: destinationBranch } },
        close_source_branch: args.close_source_branch ?? true,
    };
    if (args.description) body.description = args.description;
    if (args.reviewers?.length) body.reviewers = args.reviewers.map((uuid) => ({ uuid }));

    logger.logApiCall("POST", "pullrequests", "create_pull_request", "in", { title: args.title });
    const result = await client.request("POST", client.repoPath("pullrequests"), { body });
    logger.logApiCall("POST", "pullrequests", "create_pull_request", "out", {
        success: true,
        entry_id: result.id,
    });

    return {
        id: result.id,
        title: result.title,
        link: result.links?.html?.href,
        source_branch: args.source_branch,
        destination_branch: destinationBranch,
    };
}

async function handleApprovePR(args, client) {
    requirePositiveIntegerParam(args, "pr_id");

    logger.logApiCall(
        "POST",
        `pullrequests/${args.pr_id}/approve`,
        "approve_pull_request",
        "in",
        {},
    );
    const result = await client.request(
        "POST",
        client.repoPath(`pullrequests/${args.pr_id}/approve`),
    );
    logger.logApiCall("POST", `pullrequests/${args.pr_id}/approve`, "approve_pull_request", "out", {
        success: true,
    });

    return { approved: true, user: result.user?.display_name };
}

async function handleMergePR(args, client) {
    requirePositiveIntegerParam(args, "pr_id");

    const body = {
        merge_strategy: args.merge_strategy || "merge_commit",
        close_source_branch: args.close_source_branch ?? true,
    };
    if (args.message) body.message = args.message;

    logger.logApiCall("POST", `pullrequests/${args.pr_id}/merge`, "merge_pull_request", "in", {
        merge_strategy: body.merge_strategy,
    });
    const result = await client.request(
        "POST",
        client.repoPath(`pullrequests/${args.pr_id}/merge`),
        { body },
    );
    logger.logApiCall("POST", `pullrequests/${args.pr_id}/merge`, "merge_pull_request", "out", {
        success: true,
    });

    return {
        merged: true,
        merge_commit: result.merge_commit?.hash,
        link: result.links?.html?.href,
    };
}

// ── Utility handlers ─────────────────────────────────────────────

async function handleClone(args, client) {
    requireStringParam(args, "repoSlug", { maxLength: 100 });
    requireStringParam(args, "targetPath", { maxLength: 500 });
    validateOptionalString(args.workspaceSlug, "workspaceSlug", { maxLength: 100 });

    logger.logApiCall("POST", `clone/${args.repoSlug}`, "bb_clone", "in", {
        workspace_slug: args.workspaceSlug || "default",
        repo_slug: args.repoSlug,
    });
    const result = await client.clone(args.workspaceSlug, args.repoSlug, args.targetPath);
    logger.logApiCall("POST", `clone/${args.repoSlug}`, "bb_clone", "out", { success: true });

    return result;
}

async function handleGenericApi(args, client) {
    requireStringParam(args, "method", { maxLength: 10 });
    requireStringParam(args, "path", { maxLength: 500 });

    const method = String(args.method || "")
        .trim()
        .toUpperCase();
    if (method !== "GET") {
        throw new Error("bb_api supporta solo richieste read-only GET.");
    }
    assertRepoScopedApiPath(args.path, client);
    validateQueryParams(args.queryParams);

    const tool = "bb_api";
    logger.logApiCall(method, args.path, tool, "in", {});
    const result = await client.request(method, args.path, {
        queryParams: args.queryParams,
    });
    logger.logApiCall(method, args.path, tool, "out", { success: true });

    return result;
}

// ── Helpers ──────────────────────────────────────────────────────

async function listPullRequests(args, client) {
    const qp = {};
    if (args.state) qp.state = args.state;
    const query = buildPullRequestQuery(args.source_branch, args.destination_branch);
    if (query) qp.q = query;
    if (args.page) qp.page = String(args.page);
    qp.pagelen = String(args.pagelen || 25);

    logger.logApiCall("GET", "pullrequests", "list_pull_requests", "in", {
        state: args.state || "OPEN",
    });
    const result = await client.request("GET", client.repoPath("pullrequests"), {
        queryParams: qp,
    });
    logger.logApiCall("GET", "pullrequests", "list_pull_requests", "out", {
        success: true,
        result_count: result.size,
        has_results: (result.size || 0) > 0,
    });

    return result;
}

function buildPullRequestQuery(sourceBranch, destinationBranch) {
    const clauses = [];
    if (sourceBranch) clauses.push('source.branch.name="' + escapeQueryValue(sourceBranch) + '"');
    if (destinationBranch)
        clauses.push('destination.branch.name="' + escapeQueryValue(destinationBranch) + '"');
    return clauses.join(" AND ");
}

function assertRepoScopedApiPath(rawPath, client) {
    const { workspace, repoSlug } = client.repoScope;
    if (!isRepoScopedBitbucketApiPath(rawPath, workspace, repoSlug)) {
        throw new Error("bb_api puo' interrogare solo endpoint del repository configurato.");
    }
    return normalizeBitbucketApiPath(rawPath);
}

function escapeQueryValue(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function isExactOpenMatch(pr, args) {
    return (
        pr.state === "OPEN" &&
        pr.source?.branch?.name === args.source_branch &&
        (args.destination_branch ? pr.destination?.branch?.name === args.destination_branch : true)
    );
}

function requireStringParam(args, name, options = {}) {
    if (args[name] === undefined || args[name] === null || args[name] === "") {
        throw new Error(`Parametro obbligatorio mancante: ${name}`);
    }
    return validateString(args[name], name, options);
}

function requirePositiveIntegerParam(args, name) {
    if (args[name] === undefined || args[name] === null || args[name] === "") {
        throw new Error(`Parametro obbligatorio mancante: ${name}`);
    }
    return validateInteger(args[name], name, { min: 1 });
}

function validateOptionalString(value, name, options = {}) {
    if (value === undefined || value === null || value === "") return null;
    return validateString(value, name, options);
}

function validateString(value, name, { maxLength } = {}) {
    if (typeof value !== "string") {
        throw new Error(`${name} deve essere una stringa.`);
    }
    const trimmed = value.trim();
    if (!trimmed) {
        throw new Error(`${name} non puo' essere vuoto.`);
    }
    if (maxLength && trimmed.length > maxLength) {
        throw new Error(`${name} supera la lunghezza massima consentita (${maxLength}).`);
    }
    return trimmed;
}

function validateOptionalInteger(value, name, options = {}) {
    if (value === undefined || value === null || value === "") return null;
    return validateInteger(value, name, options);
}

function validateInteger(value, name, { min, max } = {}) {
    if (!Number.isInteger(value)) {
        throw new Error(`${name} deve essere un intero.`);
    }
    if (min !== undefined && value < min) {
        throw new Error(`${name} deve essere maggiore o uguale a ${min}.`);
    }
    if (max !== undefined && value > max) {
        throw new Error(`${name} deve essere minore o uguale a ${max}.`);
    }
    return value;
}

function validateOptionalBoolean(value, name) {
    if (value === undefined || value === null) return null;
    if (typeof value !== "boolean") {
        throw new Error(`${name} deve essere booleano.`);
    }
    return value;
}

function validateOptionalEnum(value, name, allowedValues) {
    if (value === undefined || value === null || value === "") return null;
    if (!allowedValues.has(value)) {
        throw new Error(`${name} non valido. Valori consentiti: ${[...allowedValues].join(", ")}.`);
    }
    return value;
}

function validateReviewerList(reviewers) {
    if (reviewers === undefined || reviewers === null) return null;
    if (!Array.isArray(reviewers)) {
        throw new Error("reviewers deve essere un array di stringhe.");
    }
    if (reviewers.length > MAX_REVIEWERS) {
        throw new Error(`reviewers supera il massimo consentito (${MAX_REVIEWERS}).`);
    }
    for (const reviewer of reviewers) {
        validateString(reviewer, "reviewers[]", { maxLength: 100 });
    }
    return reviewers;
}

function validateInlineCommentArgs(args) {
    const hasFilePath =
        args.file_path !== undefined && args.file_path !== null && args.file_path !== "";
    const hasLineTo = args.line_to !== undefined && args.line_to !== null && args.line_to !== "";
    if (hasFilePath !== hasLineTo) {
        throw new Error("Per i commenti inline devi passare sia file_path sia line_to.");
    }
    if (hasFilePath) {
        validateString(args.file_path, "file_path", { maxLength: MAX_FILE_PATH_LENGTH });
        validateInteger(args.line_to, "line_to", { min: 1 });
    }
}

function validateQueryParams(queryParams) {
    if (queryParams === undefined || queryParams === null) return null;
    if (typeof queryParams !== "object" || Array.isArray(queryParams)) {
        throw new Error("queryParams deve essere un oggetto chiave/valore.");
    }
    const entries = Object.entries(queryParams);
    if (entries.length > MAX_QUERY_PARAMS) {
        throw new Error(`queryParams supera il massimo consentito (${MAX_QUERY_PARAMS}).`);
    }
    for (const [key, value] of entries) {
        validateString(key, "queryParams key", { maxLength: 100 });
        const scalar = String(value ?? "").trim();
        if (!scalar) {
            throw new Error(`queryParams['${key}'] non puo' essere vuoto.`);
        }
        if (scalar.length > MAX_QUERY_VALUE_LENGTH) {
            throw new Error(
                `queryParams['${key}'] supera la lunghezza massima consentita (${MAX_QUERY_VALUE_LENGTH}).`,
            );
        }
    }
}

function mapPrSummary(pr) {
    return {
        id: pr.id,
        title: pr.title,
        state: pr.state,
        author: pr.author?.display_name,
        source_branch: pr.source?.branch?.name,
        destination_branch: pr.destination?.branch?.name,
        created_on: pr.created_on,
        updated_on: pr.updated_on,
        comment_count: pr.comment_count,
        link: pr.links?.html?.href,
    };
}
