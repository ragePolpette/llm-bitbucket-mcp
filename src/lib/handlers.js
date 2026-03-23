import * as logger from "./logger.js";

// ── Dispatch ─────────────────────────────────────────────────────

export async function handleToolCall(name, args, client) {
    switch (name) {
        case "list_pull_requests":        return handleListPRs(args, client);
        case "get_pull_request":          return handleGetPR(args, client);
        case "get_pull_request_diff":     return handleGetPRDiff(args, client);
        case "get_pull_request_comments": return handleGetPRComments(args, client);
        case "add_pull_request_comment":  return handleAddPRComment(args, client);
        case "create_pull_request":       return handleCreatePR(args, client);
        case "bb_clone":                  return handleClone(args, client);
        case "bb_api":                    return handleGenericApi(args, client);
        default: throw new Error(`Tool non supportato: ${name}`);
    }
}

// ── PR read handlers ─────────────────────────────────────────────

async function handleListPRs(args, client) {
    const qp = {};
    if (args.state) qp.state = args.state;
    if (args.source_branch) qp.q = `source.branch.name="${args.source_branch}"`;
    if (args.page) qp.page = String(args.page);
    qp.pagelen = String(args.pagelen || 25);

    logger.logApiCall("GET", "pullrequests", "list_pull_requests", "in", { state: args.state || "OPEN" });
    const result = await client.request("GET", client.repoPath("pullrequests"), { queryParams: qp });
    logger.logApiCall("GET", "pullrequests", "list_pull_requests", "out", {
        success: true, result_count: result.size, has_results: (result.size || 0) > 0
    });

    return {
        count: result.size,
        page: result.page,
        pull_requests: (result.values || []).map(mapPrSummary)
    };
}

async function handleGetPR(args, client) {
    requireParam(args, "pr_id");

    logger.logApiCall("GET", `pullrequests/${args.pr_id}`, "get_pull_request", "in", {});
    const pr = await client.request("GET", client.repoPath(`pullrequests/${args.pr_id}`));
    logger.logApiCall("GET", `pullrequests/${args.pr_id}`, "get_pull_request", "out", { success: true });

    return {
        id: pr.id,
        title: pr.title,
        description: pr.description || "",
        state: pr.state,
        author: pr.author?.display_name,
        reviewers: (pr.reviewers || []).map(r => ({ display_name: r.display_name, uuid: r.uuid })),
        participants: (pr.participants || []).map(p => ({
            display_name: p.user?.display_name, role: p.role, approved: p.approved
        })),
        source_branch: pr.source?.branch?.name,
        destination_branch: pr.destination?.branch?.name,
        created_on: pr.created_on,
        updated_on: pr.updated_on,
        close_source_branch: pr.close_source_branch,
        comment_count: pr.comment_count,
        task_count: pr.task_count,
        link: pr.links?.html?.href
    };
}

async function handleGetPRDiff(args, client) {
    requireParam(args, "pr_id");

    logger.logApiCall("GET", `pullrequests/${args.pr_id}/diff`, "get_pull_request_diff", "in", {});
    const text = await client.request("GET", client.repoPath(`pullrequests/${args.pr_id}/diff`), { accept: "text/plain" });
    logger.logApiCall("GET", `pullrequests/${args.pr_id}/diff`, "get_pull_request_diff", "out", { success: true });

    const maxBytes = 500 * 1024;
    const diffText = typeof text === "string" ? text : JSON.stringify(text);
    if (diffText.length > maxBytes) {
        return { diff: diffText.slice(0, maxBytes), truncated: true, warning: `Diff troncato a ${maxBytes} bytes.` };
    }
    return { diff: diffText, truncated: false };
}

async function handleGetPRComments(args, client) {
    requireParam(args, "pr_id");

    logger.logApiCall("GET", `pullrequests/${args.pr_id}/comments`, "get_pull_request_comments", "in", {});

    const allComments = [];
    let nextPath = client.repoPath(`pullrequests/${args.pr_id}/comments`);
    const maxComments = 500;
    let isFirstPage = true;

    while (nextPath && allComments.length < maxComments) {
        const qp = isFirstPage ? { pagelen: "100" } : {};
        const result = await client.request("GET", nextPath, { queryParams: qp });
        for (const c of (result.values || [])) {
            allComments.push({
                id: c.id,
                author: c.user?.display_name,
                content: c.content?.raw,
                created_on: c.created_on,
                updated_on: c.updated_on,
                inline: c.inline || null,
                parent_id: c.parent?.id || null
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

    logger.logApiCall("GET", `pullrequests/${args.pr_id}/comments`, "get_pull_request_comments", "out", {
        success: true, result_count: allComments.length, has_results: allComments.length > 0
    });

    return {
        count: allComments.length,
        truncated: allComments.length >= maxComments,
        comments: allComments
    };
}

// ── PR write handlers ────────────────────────────────────────────

async function handleAddPRComment(args, client) {
    requireParam(args, "pr_id");
    requireParam(args, "content");

    const body = { content: { raw: args.content } };
    if (args.file_path && args.line_to) {
        body.inline = { path: args.file_path, to: args.line_to };
    }

    const isInline = !!(args.file_path && args.line_to);
    logger.logApiCall("POST", `pullrequests/${args.pr_id}/comments`, "add_pull_request_comment", "in", {
        inline: isInline,
        content_length: String(args.content.length)
    });
    const result = await client.request("POST", client.repoPath(`pullrequests/${args.pr_id}/comments`), { body });
    logger.logApiCall("POST", `pullrequests/${args.pr_id}/comments`, "add_pull_request_comment", "out", {
        success: true, entry_id: result.id
    });

    return { success: true, comment_id: result.id, link: result.links?.html?.href };
}

async function handleCreatePR(args, client) {
    requireParam(args, "title");
    requireParam(args, "source_branch");

    const body = {
        title: args.title,
        source: { branch: { name: args.source_branch } },
        destination: { branch: { name: args.destination_branch || "BPOFH" } },
        close_source_branch: args.close_source_branch ?? true
    };
    if (args.description) body.description = args.description;
    if (args.reviewers?.length) body.reviewers = args.reviewers.map(uuid => ({ uuid }));

    logger.logApiCall("POST", "pullrequests", "create_pull_request", "in", { title: args.title });
    const result = await client.request("POST", client.repoPath("pullrequests"), { body });
    logger.logApiCall("POST", "pullrequests", "create_pull_request", "out", {
        success: true, entry_id: result.id
    });

    return { id: result.id, title: result.title, link: result.links?.html?.href, source_branch: args.source_branch, destination_branch: args.destination_branch || "BPOFH" };
}

async function handleApprovePR(args, client) {
    requireParam(args, "pr_id");

    logger.logApiCall("POST", `pullrequests/${args.pr_id}/approve`, "approve_pull_request", "in", {});
    const result = await client.request("POST", client.repoPath(`pullrequests/${args.pr_id}/approve`));
    logger.logApiCall("POST", `pullrequests/${args.pr_id}/approve`, "approve_pull_request", "out", { success: true });

    return { approved: true, user: result.user?.display_name };
}

async function handleMergePR(args, client) {
    requireParam(args, "pr_id");

    const body = {
        merge_strategy: args.merge_strategy || "merge_commit",
        close_source_branch: args.close_source_branch ?? true
    };
    if (args.message) body.message = args.message;

    logger.logApiCall("POST", `pullrequests/${args.pr_id}/merge`, "merge_pull_request", "in", {
        merge_strategy: body.merge_strategy
    });
    const result = await client.request("POST", client.repoPath(`pullrequests/${args.pr_id}/merge`), { body });
    logger.logApiCall("POST", `pullrequests/${args.pr_id}/merge`, "merge_pull_request", "out", { success: true });

    return { merged: true, merge_commit: result.merge_commit?.hash, link: result.links?.html?.href };
}

// ── Utility handlers ─────────────────────────────────────────────

async function handleClone(args, client) {
    requireParam(args, "repoSlug");
    requireParam(args, "targetPath");

    logger.logApiCall("POST", `clone/${args.repoSlug}`, "bb_clone", "in", {
        workspace_slug: args.workspaceSlug || "default",
        repo_slug: args.repoSlug
    });
    const result = await client.clone(args.workspaceSlug, args.repoSlug, args.targetPath);
    logger.logApiCall("POST", `clone/${args.repoSlug}`, "bb_clone", "out", { success: true });

    return result;
}

async function handleGenericApi(args, client) {
    requireParam(args, "method");
    requireParam(args, "path");

    const method = String(args.method || "").trim().toUpperCase();
    if (method !== "GET") {
        throw new Error("bb_api supporta solo richieste read-only GET.");
    }

    const tool = "bb_api";
    logger.logApiCall(method, args.path, tool, "in", {});
    const result = await client.request(method, args.path, {
        queryParams: args.queryParams
    });
    logger.logApiCall(method, args.path, tool, "out", { success: true });

    return result;
}

// ── Helpers ──────────────────────────────────────────────────────

function requireParam(args, name) {
    if (args[name] === undefined || args[name] === null || args[name] === "") {
        throw new Error(`Parametro obbligatorio mancante: ${name}`);
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
        link: pr.links?.html?.href
    };
}
