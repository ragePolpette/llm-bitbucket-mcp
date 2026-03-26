import * as logger from "./logger.js";
import { isRepoScopedBitbucketApiPath, normalizeBitbucketApiPath } from "./bitbucket-client.js";
import { ALLOWED_PR_STATES, TOOL_LIMITS } from "./tool-policy.js";

// ── Dispatch ─────────────────────────────────────────────────────

export async function handleToolCall(name, args, client, policy = {}) {
    switch (name) {
        case "bitbucket_info":
            return handleBitbucketInfo(client, policy);
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
        case "get_pull_request_commits":
            return handleGetPRCommits(args, client);
        case "get_pull_request_statuses":
            return handleGetPRStatuses(args, client);
        case "get_pull_request_tasks":
            return handleGetPRTasks(args, client);
        case "add_pull_request_comment":
            return handleAddPRComment(args, client);
        case "create_pull_request":
            return handleCreatePR(args, client);
        case "open_pull_request":
            return handleCreatePR(args, client);
        case "bb_api":
            return handleGenericApi(args, client);
        default:
            throw new Error(`Tool non supportato: ${name}`);
    }
}

function handleBitbucketInfo(client, policy) {
    return {
        server: "llm-bitbucket-mcp",
        purpose: "Bitbucket Cloud MCP focalizzato su PR e read API repository-scoped.",
        tool_map: {
            discovery: [
                "bitbucket_info",
                "list_pull_requests",
                "find_open_pull_request",
                "get_pull_request",
                "get_pull_request_diff",
                "get_pull_request_comments",
                "get_pull_request_commits",
                "get_pull_request_statuses",
                "get_pull_request_tasks",
            ],
            pr_write: ["create_pull_request", "open_pull_request", "add_pull_request_comment"],
            utility: ["bb_api"],
        },
        usage_notes: {
            find_open_pull_request:
                "Usa source_branch esatto; destination_branch e' opzionale ma consigliato per evitare ambiguita.",
            create_pull_request:
                "Richiede title e source_branch. destination_branch puo' arrivare dal payload oppure da BITBUCKET_DEFAULT_DESTINATION_BRANCH.",
            open_pull_request: "Alias ergonomico di create_pull_request con lo stesso contract.",
            get_pull_request_commits:
                "Espone solo i commit effettivamente inclusi nella PR, con un cap locale di 500 elementi.",
            get_pull_request_statuses:
                "Restituisce gli status Bitbucket associati alla PR, utile per build e check summary.",
            get_pull_request_tasks:
                "Restituisce i task della PR con stato e contenuto raw, utile per follow-up review.",
            bb_api: "Solo GET read-only, limitato agli endpoint del repository configurato.",
        },
        runtime_options: {
            auth_enabled: Boolean(policy.authEnabled),
            default_destination_branch_configured: Boolean(client.defaultDestinationBranch),
            default_destination_branch: client.defaultDestinationBranch || null,
            enabled_write_tools: policy.enabledWriteTools || [],
        },
        boundaries: [
            "Gestisce solo operazioni Bitbucket remote sul repository configurato.",
            "Non espone clone, checkout_branch o create_commit del workspace locale.",
            "I tool write esposti possono essere limitati via configurazione runtime.",
            "Per git locale usare l'harness o un MCP git dedicato.",
        ],
    };
}

// ── PR read handlers ─────────────────────────────────────────────

async function handleListPRs(args, client) {
    validateOptionalEnum(args.state, "state", ALLOWED_PR_STATES);
    validateOptionalString(args.source_branch, "source_branch", {
        maxLength: TOOL_LIMITS.branchNameLength,
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
    requireStringParam(args, "source_branch", { maxLength: TOOL_LIMITS.branchNameLength });
    validateOptionalString(args.destination_branch, "destination_branch", {
        maxLength: TOOL_LIMITS.branchNameLength,
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

    const { items, truncated } = await collectPullRequestCollection(
        args.pr_id,
        "comments",
        client,
        {
            tool: "get_pull_request_comments",
            mapValue: mapPrComment,
        },
    );

    return { count: items.length, truncated, comments: items };
}

async function handleGetPRCommits(args, client) {
    requirePositiveIntegerParam(args, "pr_id");

    const { items, truncated } = await collectPullRequestCollection(args.pr_id, "commits", client, {
        tool: "get_pull_request_commits",
        mapValue: mapPrCommit,
    });

    return { count: items.length, truncated, commits: items };
}

async function handleGetPRStatuses(args, client) {
    requirePositiveIntegerParam(args, "pr_id");

    const { items, truncated } = await collectPullRequestCollection(
        args.pr_id,
        "statuses",
        client,
        {
            tool: "get_pull_request_statuses",
            mapValue: mapPrStatus,
        },
    );

    return { count: items.length, truncated, statuses: items };
}

async function handleGetPRTasks(args, client) {
    requirePositiveIntegerParam(args, "pr_id");

    const { items, truncated } = await collectPullRequestCollection(args.pr_id, "tasks", client, {
        tool: "get_pull_request_tasks",
        mapValue: mapPrTask,
    });

    return { count: items.length, truncated, tasks: items };
}

// ── PR write handlers ────────────────────────────────────────────

async function handleAddPRComment(args, client) {
    requirePositiveIntegerParam(args, "pr_id");
    requireStringParam(args, "content", { maxLength: TOOL_LIMITS.commentLength });
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
    requireStringParam(args, "title", { maxLength: TOOL_LIMITS.titleLength });
    requireStringParam(args, "source_branch", { maxLength: TOOL_LIMITS.branchNameLength });
    validateOptionalString(args.description, "description", {
        maxLength: TOOL_LIMITS.descriptionLength,
    });
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
    validateString(destinationBranch, "destination_branch", {
        maxLength: TOOL_LIMITS.branchNameLength,
    });
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

async function collectPullRequestCollection(prId, suffix, client, { tool, mapValue }) {
    const path = client.repoPath(`pullrequests/${prId}/${suffix}`);
    logger.logApiCall("GET", `pullrequests/${prId}/${suffix}`, tool, "in", {});

    const { items, truncated } = await collectPaginatedValues(client, path, mapValue);

    logger.logApiCall("GET", `pullrequests/${prId}/${suffix}`, tool, "out", {
        success: true,
        result_count: items.length,
        has_results: items.length > 0,
        truncated,
    });

    return { items, truncated };
}

async function collectPaginatedValues(client, initialPath, mapValue) {
    const items = [];
    let nextPath = initialPath;
    let isFirstPage = true;

    while (nextPath && items.length < TOOL_LIMITS.paginatedCollectionCap) {
        const result = await client.request("GET", nextPath, {
            queryParams: isFirstPage ? { pagelen: String(TOOL_LIMITS.bitbucketPageLength) } : {},
        });

        for (const value of result.values || []) {
            items.push(mapValue(value));
            if (items.length >= TOOL_LIMITS.paginatedCollectionCap) {
                break;
            }
        }

        if (result.next && items.length < TOOL_LIMITS.paginatedCollectionCap) {
            const nextUrl = new URL(result.next);
            nextPath = nextUrl.pathname + nextUrl.search;
        } else {
            nextPath = null;
        }
        isFirstPage = false;
    }

    return {
        items,
        truncated: nextPath !== null,
    };
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
    if (reviewers.length > TOOL_LIMITS.reviewers) {
        throw new Error(`reviewers supera il massimo consentito (${TOOL_LIMITS.reviewers}).`);
    }
    for (const reviewer of reviewers) {
        validateString(reviewer, "reviewers[]", { maxLength: TOOL_LIMITS.reviewerIdLength });
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
        validateString(args.file_path, "file_path", { maxLength: TOOL_LIMITS.filePathLength });
        validateInteger(args.line_to, "line_to", { min: 1 });
    }
}

function validateQueryParams(queryParams) {
    if (queryParams === undefined || queryParams === null) return null;
    if (typeof queryParams !== "object" || Array.isArray(queryParams)) {
        throw new Error("queryParams deve essere un oggetto chiave/valore.");
    }
    const entries = Object.entries(queryParams);
    if (entries.length > TOOL_LIMITS.queryParams) {
        throw new Error(`queryParams supera il massimo consentito (${TOOL_LIMITS.queryParams}).`);
    }
    for (const [key, value] of entries) {
        validateString(key, "queryParams key", { maxLength: TOOL_LIMITS.queryKeyLength });
        const scalar = String(value ?? "").trim();
        if (!scalar) {
            throw new Error(`queryParams['${key}'] non puo' essere vuoto.`);
        }
        if (scalar.length > TOOL_LIMITS.queryValueLength) {
            throw new Error(
                `queryParams['${key}'] supera la lunghezza massima consentita (${TOOL_LIMITS.queryValueLength}).`,
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

function mapPrComment(comment) {
    return {
        id: comment.id,
        author: comment.user?.display_name,
        content: comment.content?.raw,
        created_on: comment.created_on,
        updated_on: comment.updated_on,
        inline: comment.inline || null,
        parent_id: comment.parent?.id || null,
    };
}

function mapPrCommit(commit) {
    return {
        hash: commit.hash,
        message: commit.message || "",
        summary: commit.summary?.raw || "",
        author: commit.author?.user?.display_name || commit.author?.raw || null,
        date: commit.date || null,
        parents: (commit.parents || []).map((parent) => parent.hash),
        link: commit.links?.html?.href || null,
    };
}

function mapPrStatus(status) {
    return {
        key: status.key || null,
        name: status.name || null,
        state: status.state || null,
        description: status.description || "",
        refname: status.refname || null,
        url: status.url || null,
        created_on: status.created_on || null,
        updated_on: status.updated_on || null,
    };
}

function mapPrTask(task) {
    return {
        id: task.id || null,
        state: task.state || null,
        content: task.content?.raw || "",
        creator: task.creator?.display_name || task.creator?.nickname || null,
        created_on: task.created_on || null,
        updated_on: task.updated_on || null,
        comment_id: task.comment?.id || null,
    };
}
