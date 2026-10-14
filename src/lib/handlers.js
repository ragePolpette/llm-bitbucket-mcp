import * as logger from "./logger.js";
import { isRepoScopedBitbucketApiPath, normalizeBitbucketApiPath } from "./bitbucket-client.js";
import { ALLOWED_PR_STATES, MERGE_STRATEGIES, TOOL_LIMITS } from "./tool-policy.js";
import { createConfirmationStore } from "./merge-confirmations.js";

const PIPELINE_LOG_ACCEPT = "application/octet-stream, text/plain;q=0.9, */*;q=0.8";

export const mergeConfirmations = createConfirmationStore();

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
        case "get_pull_request_pipelines":
            return handleGetPullRequestPipelines(args, client);
        case "get_pull_request_pipeline_failure_output":
            return handleGetPullRequestPipelineFailureOutput(args, client);
        case "get_pipeline_run":
            return handleGetPipelineRun(args, client);
        case "get_pipeline_failure_output":
            return handleGetPipelineFailureOutput(args, client);
        case "list_pipeline_steps":
            return handleListPipelineSteps(args, client);
        case "get_pipeline_step_log":
            return handleGetPipelineStepLog(args, client);
        case "add_pull_request_comment":
            return handleAddPRComment(args, client);
        case "create_pull_request":
            return handleCreatePR(args, client);
        case "open_pull_request":
            return handleCreatePR(args, client);
        case "run_pipeline":
            return handleRunPipeline(args, client);
        case "merge_pull_request":
            return handleMergePR(args, client, policy);
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
                "get_pull_request_pipelines",
                "get_pull_request_pipeline_failure_output",
                "get_pipeline_run",
                "get_pipeline_failure_output",
                "list_pipeline_steps",
                "get_pipeline_step_log",
            ],
            pr_write: [
                "create_pull_request",
                "open_pull_request",
                "add_pull_request_comment",
                "merge_pull_request",
            ],
            pipeline_write: ["run_pipeline"],
            utility: [],
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
            get_pull_request_pipelines:
                "Risalendo da pr_id usa prima gli status della PR per correlare i build pipeline reali; se non basta, fa fallback sul commit o sulla branch sorgente.",
            get_pull_request_pipeline_failure_output:
                "Per una PR recupera i run falliti correlati tramite status/build Bitbucket e ne aggrega i log degli step in errore.",
            get_pipeline_run:
                "Accetta pipeline UUID o URL Bitbucket e restituisce lo stato sintetico della pipeline.",
            get_pipeline_failure_output:
                "Legge gli step falliti di una pipeline e ne recupera il log testuale troncato in modo sicuro.",
            list_pipeline_steps:
                "Elenca gli step di una pipeline con stato e risultato; usa gli uuid restituiti con get_pipeline_step_log.",
            get_pipeline_step_log:
                "Legge il log di un singolo step, anche se riuscito o ancora in corso, troncato in modo sicuro.",
            run_pipeline:
                "Avvia la pipeline di default del branch oppure una custom pipeline per nome; restituisce uuid e build number del run creato.",
            merge_pull_request:
                "Due passi: la prima chiamata restituisce riepilogo e confirmation_token; chiedi conferma esplicita all'utente in chat, poi richiama con il token. Disponibile solo se il repository ha allowMerge attivo.",
        },
        runtime_options: {
            auth_enabled: Boolean(policy.authEnabled),
            default_destination_branch_configured: Boolean(client.defaultDestinationBranch),
            default_destination_branch: client.defaultDestinationBranch || null,
            enabled_write_tools: policy.enabledWriteTools || [],
            selected_repository: policy.selectedRepository || null,
            repositories: policy.repositories || [],
        },
        boundaries: [
            "Gestisce solo operazioni Bitbucket remote sul repository configurato.",
            "Non espone clone, checkout_branch o create_commit del workspace locale.",
            "I tool write esposti possono essere limitati via configurazione runtime.",
            "bb_api resta implementato per uso interno ma non e' esposto nel catalogo MCP pubblico.",
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

async function handleGetPullRequestPipelines(args, client) {
    requirePositiveIntegerParam(args, "pr_id");

    logger.logApiCall(
        "GET",
        `pullrequests/${args.pr_id}/pipelines`,
        "get_pull_request_pipelines",
        "in",
        {},
    );
    const related = await fetchPullRequestPipelines(args.pr_id, client);
    logger.logApiCall(
        "GET",
        `pullrequests/${args.pr_id}/pipelines`,
        "get_pull_request_pipelines",
        "out",
        {
            success: true,
            result_count: related.pipelines.length,
            has_results: related.pipelines.length > 0,
        },
    );

    return related;
}

async function handleGetPullRequestPipelineFailureOutput(args, client) {
    requirePositiveIntegerParam(args, "pr_id");

    logger.logApiCall(
        "GET",
        `pullrequests/${args.pr_id}/pipeline_failures`,
        "get_pull_request_pipeline_failure_output",
        "in",
        {},
    );

    const related = await fetchPullRequestPipelines(args.pr_id, client);
    const failedPipelines = related._rawPipelines.filter(isFailedPipelineRun);
    const failures = [];

    for (const pipeline of failedPipelines) {
        const failure = await buildPipelineFailureOutput(pipeline, client);
        failures.push(failure);
    }

    logger.logApiCall(
        "GET",
        `pullrequests/${args.pr_id}/pipeline_failures`,
        "get_pull_request_pipeline_failure_output",
        "out",
        {
            success: true,
            result_count: failures.length,
            has_results: failures.length > 0,
        },
    );

    return {
        pull_request: related.pull_request,
        match_mode: related.match_mode,
        pipeline_count: related.pipeline_count,
        failure_count: failures.length,
        failures,
    };
}

// ── Pipeline read handlers ──────────────────────────────────────

async function handleGetPipelineRun(args, client) {
    const pipelineUuid = requirePipelineUuid(args.pipeline_ref);

    logger.logApiCall("GET", `pipelines/${pipelineUuid}`, "get_pipeline_run", "in", {});
    const pipeline = await client.request("GET", client.repoPath(`pipelines/${pipelineUuid}`));
    logger.logApiCall("GET", `pipelines/${pipelineUuid}`, "get_pipeline_run", "out", {
        success: true,
    });

    return { pipeline: mapPipelineSummary(pipeline) };
}

async function handleGetPipelineFailureOutput(args, client) {
    const pipelineUuid = requirePipelineUuid(args.pipeline_ref);

    logger.logApiCall(
        "GET",
        `pipelines/${pipelineUuid}/steps`,
        "get_pipeline_failure_output",
        "in",
        {},
    );

    const pipeline = await client.request("GET", client.repoPath(`pipelines/${pipelineUuid}`));
    const failures = await readFailedStepLogs(pipelineUuid, client);

    logger.logApiCall(
        "GET",
        `pipelines/${pipelineUuid}/steps`,
        "get_pipeline_failure_output",
        "out",
        {
            success: true,
            result_count: failures.length,
            has_results: failures.length > 0,
        },
    );

    return {
        pipeline: mapPipelineSummary(pipeline),
        failure_count: failures.length,
        failures,
    };
}

async function handleListPipelineSteps(args, client) {
    const pipelineUuid = requirePipelineUuid(args.pipeline_ref);

    logger.logApiCall("GET", `pipelines/${pipelineUuid}/steps`, "list_pipeline_steps", "in", {});
    const pipeline = await client.request("GET", client.repoPath(`pipelines/${pipelineUuid}`));
    const { items: steps, truncated } = await collectPaginatedValues(
        client,
        client.repoPath(`pipelines/${pipelineUuid}/steps`),
        (step) => step,
    );
    const limitedSteps = steps.slice(0, TOOL_LIMITS.pipelineStepsCap);
    logger.logApiCall("GET", `pipelines/${pipelineUuid}/steps`, "list_pipeline_steps", "out", {
        success: true,
        result_count: limitedSteps.length,
        has_results: limitedSteps.length > 0,
    });

    return {
        pipeline: mapPipelineSummary(pipeline),
        step_count: limitedSteps.length,
        truncated: truncated || steps.length > limitedSteps.length,
        steps: limitedSteps.map(mapPipelineStep),
    };
}

async function handleGetPipelineStepLog(args, client) {
    const pipelineUuid = requirePipelineUuid(args.pipeline_ref);
    if (args.step_uuid === undefined || args.step_uuid === null || args.step_uuid === "") {
        throw new Error("Parametro obbligatorio mancante: step_uuid");
    }
    const stepUuid = normalizeBitbucketUuid(args.step_uuid, "step_uuid");
    const path = `pipelines/${pipelineUuid}/steps/${stepUuid}/log`;

    logger.logApiCall("GET", path, "get_pipeline_step_log", "in", {});
    const step = await client.request(
        "GET",
        client.repoPath(`pipelines/${pipelineUuid}/steps/${stepUuid}`),
    );
    const logText = await readStepLogText(pipelineUuid, stepUuid, client);
    const { text, truncated } = truncateText(logText, TOOL_LIMITS.pipelineLogBytes);
    logger.logApiCall("GET", path, "get_pipeline_step_log", "out", {
        success: true,
        truncated,
    });

    return {
        pipeline_uuid: pipelineUuid,
        step: mapPipelineStep(step),
        log: text,
        truncated,
    };
}

// ── Pipeline write handlers ─────────────────────────────────────

async function handleRunPipeline(args, client) {
    const branch = requireStringParam(args, "branch", { maxLength: TOOL_LIMITS.branchNameLength });
    const pipelineName = validateOptionalString(args.pipeline_name, "pipeline_name", {
        maxLength: TOOL_LIMITS.pipelineNameLength,
    });
    const commitHash = validateOptionalString(args.commit_hash, "commit_hash", { maxLength: 40 });
    if (commitHash && !/^[0-9a-f]{40}$/i.test(commitHash)) {
        throw new Error("commit_hash deve essere un hash completo di 40 caratteri esadecimali.");
    }
    const variables = validatePipelineVariables(args.variables);

    const target = {
        type: "pipeline_ref_target",
        ref_type: "branch",
        ref_name: branch,
    };
    if (commitHash) {
        target.commit = { type: "commit", hash: commitHash.toLowerCase() };
    }
    if (pipelineName) {
        target.selector = { type: "custom", pattern: pipelineName };
    }
    const body = { target };
    if (variables.length) {
        body.variables = variables;
    }

    logger.logApiCall("POST", "pipelines", "run_pipeline", "in", {
        branch,
        pipeline_name: pipelineName || null,
        variable_count: variables.length,
    });
    const result = await client.request("POST", client.repoPath("pipelines"), { body });
    logger.logApiCall("POST", "pipelines", "run_pipeline", "out", {
        success: true,
        entry_id: result.uuid || null,
    });

    return {
        started: true,
        branch,
        pipeline_name: pipelineName || null,
        pipeline: mapPipelineSummary(result),
    };
}

function validatePipelineVariables(raw) {
    if (raw === undefined || raw === null) return [];
    if (typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error("variables deve essere un oggetto chiave -> valore.");
    }
    const entries = Object.entries(raw);
    if (entries.length > TOOL_LIMITS.pipelineVariables) {
        throw new Error(
            `variables supera il massimo consentito (${TOOL_LIMITS.pipelineVariables}).`,
        );
    }
    return entries.map(([key, value]) => {
        const name = validateString(key, "variables.key", {
            maxLength: TOOL_LIMITS.pipelineVariableKeyLength,
        });
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
            throw new Error(`Nome variabile pipeline non valido: ${name}`);
        }
        if (typeof value !== "string") {
            throw new Error(`variables.${name} deve essere una stringa.`);
        }
        if (value.length > TOOL_LIMITS.pipelineVariableValueLength) {
            throw new Error(
                `variables.${name} supera la lunghezza massima consentita (${TOOL_LIMITS.pipelineVariableValueLength}).`,
            );
        }
        return { key: name, value, secured: false };
    });
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

async function handleMergePR(args, client, policy = {}) {
    const prId = requirePositiveIntegerParam(args, "pr_id");
    const repository = policy.selectedRepository || {};
    if (repository.allowMerge !== true) {
        throw new Error(
            `Merge non consentito per il repository '${repository.id || policy.selectedRepositoryId || "?"}': abilita allowMerge nella configurazione del repository.`,
        );
    }

    const mergeStrategy =
        validateOptionalEnum(args.merge_strategy, "merge_strategy", MERGE_STRATEGIES) ||
        "merge_commit";
    const closeSourceBranch =
        validateOptionalBoolean(args.close_source_branch, "close_source_branch") ?? true;
    const message = validateOptionalString(args.message, "message", {
        maxLength: TOOL_LIMITS.mergeMessageLength,
    });
    const confirmationToken = validateOptionalString(
        args.confirmation_token,
        "confirmation_token",
        {
            maxLength: TOOL_LIMITS.confirmationTokenLength,
        },
    );
    const scope = {
        repositoryId: repository.id || policy.selectedRepositoryId || "",
        prId,
        mergeStrategy,
        closeSourceBranch,
        message: message || "",
    };

    if (!confirmationToken) {
        logger.logApiCall("GET", `pullrequests/${prId}`, "merge_pull_request", "in", {
            phase: "preview",
        });
        const pr = await client.request("GET", client.repoPath(`pullrequests/${prId}`));
        const state = String(pr.state || "").toUpperCase();
        if (state && state !== "OPEN") {
            throw new Error(`La pull request ${prId} non e' aperta (stato: ${state}).`);
        }
        const issued = mergeConfirmations.issue(scope);
        logger.logAudit("merge_confirmation_issued", {
            repository_id: scope.repositoryId,
            pr_id: prId,
            merge_strategy: mergeStrategy,
        });
        return {
            merged: false,
            status: "confirmation_required",
            summary: {
                repository_id: scope.repositoryId,
                pr_id: pr.id,
                title: pr.title,
                author: pr.author?.display_name || null,
                source_branch: pr.source?.branch?.name || null,
                destination_branch: pr.destination?.branch?.name || null,
                state: pr.state || null,
                approvals: (pr.participants || []).filter((p) => p.approved).length,
                comment_count: pr.comment_count ?? null,
                task_count: pr.task_count ?? null,
                merge_strategy: mergeStrategy,
                close_source_branch: closeSourceBranch,
                message: message || null,
                link: pr.links?.html?.href || null,
            },
            confirmation_token: issued.token,
            expires_in_seconds: Math.floor(issued.ttlMs / 1000),
            instructions:
                "Mostra il riepilogo all'utente e chiedi conferma esplicita in chat. Solo dopo una risposta affermativa richiama merge_pull_request con gli stessi parametri e questo confirmation_token. Non procedere senza conferma.",
        };
    }

    const consumed = mergeConfirmations.consume(confirmationToken, scope);
    if (!consumed.ok) {
        logger.logAudit("merge_confirmation_rejected", {
            repository_id: scope.repositoryId,
            pr_id: prId,
            reason: consumed.reason,
        });
        const reasonText =
            consumed.reason === "scope_mismatch"
                ? "i parametri non coincidono con quelli del riepilogo confermato"
                : "token sconosciuto, scaduto o gia' usato";
        throw new Error(
            `confirmation_token non valido (${reasonText}). Richiama merge_pull_request senza token per un nuovo riepilogo e chiedi di nuovo conferma all'utente.`,
        );
    }

    const body = {
        merge_strategy: mergeStrategy,
        close_source_branch: closeSourceBranch,
    };
    if (message) body.message = message;

    logger.logApiCall("POST", `pullrequests/${prId}/merge`, "merge_pull_request", "in", {
        merge_strategy: body.merge_strategy,
        phase: "confirmed",
    });
    const result = await client.request("POST", client.repoPath(`pullrequests/${prId}/merge`), {
        body,
    });
    logger.logApiCall("POST", `pullrequests/${prId}/merge`, "merge_pull_request", "out", {
        success: true,
    });
    logger.logAudit("merge_executed", {
        repository_id: scope.repositoryId,
        pr_id: prId,
        merge_strategy: mergeStrategy,
    });

    return {
        merged: true,
        pr_id: prId,
        merge_strategy: mergeStrategy,
        merge_commit: result.merge_commit?.hash || null,
        state: result.state || null,
        link: result.links?.html?.href || null,
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

async function fetchPullRequestPipelines(prId, client) {
    const pr = await client.request("GET", client.repoPath(`pullrequests/${prId}`));
    const sourceBranch = pr.source?.branch?.name || null;
    const sourceCommitHash = pr.source?.commit?.hash || null;
    const statuses = await fetchPullRequestStatusRecords(prId, client);
    const statusContext = buildPullRequestStatusContext(statuses);

    if (!sourceBranch) {
        throw new Error("Impossibile determinare source_branch dalla pull request.");
    }

    const preferredCommitHash =
        statusContext.commitHash || normalizeFullCommitHash(sourceCommitHash);
    const commitHashSource = statusContext.commitHash
        ? "pr_statuses"
        : preferredCommitHash
          ? "pull_request"
          : null;

    let matchMode = preferredCommitHash ? "pr_status_commit" : "source_branch_fallback";
    let pipelines = [];
    let truncated = false;

    if (preferredCommitHash) {
        const commitMatch = await listPipelinesForCommitHash(client, preferredCommitHash);
        pipelines = filterPipelinesForPullRequestContext(commitMatch.items, {
            prId,
            sourceBranch,
            commitHash: preferredCommitHash,
            statusBuildNumbers: statusContext.buildNumbers,
            statusUrls: statusContext.urls,
        });
        truncated = commitMatch.truncated;

        if (
            !pipelines.length &&
            !statusContext.commitHash &&
            sourceCommitHash &&
            preferredCommitHash !== sourceCommitHash
        ) {
            matchMode = "source_commit";
        }
    }

    if (!pipelines.length) {
        const branchFallback = await listPipelinesForPullRequestTarget(client, {
            sourceBranch,
            sourceCommitHash: null,
        });
        matchMode = preferredCommitHash ? "source_branch_fallback" : "source_branch_only";
        pipelines = branchFallback.items;
        truncated = branchFallback.truncated;
    }

    return {
        pull_request: {
            id: pr.id,
            title: pr.title,
            source_branch: sourceBranch,
            destination_branch: pr.destination?.branch?.name || null,
            source_commit_hash: preferredCommitHash || sourceCommitHash || null,
            source_commit_hash_source: commitHashSource,
            link: pr.links?.html?.href || null,
        },
        match_mode: matchMode,
        pipeline_count: pipelines.length,
        truncated,
        pipelines: pipelines.map(mapPipelineSummary),
        _rawPipelines: pipelines,
    };
}

async function fetchPullRequestStatusRecords(prId, client) {
    const { items } = await collectPaginatedValues(
        client,
        client.repoPath(`pullrequests/${prId}/statuses`),
        (status) => status,
    );
    return items;
}

function buildPullRequestStatusContext(statuses) {
    const buildNumbers = new Set();
    const urls = new Set();
    let commitHash = null;

    for (const status of statuses) {
        const normalizedCommitHash = normalizeFullCommitHash(status.commit?.hash);
        if (!commitHash && normalizedCommitHash) {
            commitHash = normalizedCommitHash;
        }

        const normalizedUrl = normalizePipelineResultUrl(status.url);
        if (normalizedUrl) {
            urls.add(normalizedUrl);
        }

        const buildNumber = parsePipelineBuildNumber(status.url);
        if (buildNumber !== null) {
            buildNumbers.add(buildNumber);
        }
    }

    return { commitHash, buildNumbers, urls };
}

function normalizeFullCommitHash(value) {
    if (typeof value !== "string") {
        return null;
    }
    const trimmed = value.trim().toLowerCase();
    return /^[0-9a-f]{40}$/.test(trimmed) ? trimmed : null;
}

function parsePipelineBuildNumber(url) {
    if (typeof url !== "string") {
        return null;
    }
    const match = url.match(/\/pipelines\/results\/(\d+)(?:[/?#]|$)/i);
    return match ? Number(match[1]) : null;
}

function normalizePipelineResultUrl(url) {
    if (typeof url !== "string") {
        return null;
    }
    return url.trim().replace(/\/+$/, "");
}

function filterPipelinesForPullRequestContext(
    pipelines,
    { prId, sourceBranch, commitHash, statusBuildNumbers, statusUrls },
) {
    if (!Array.isArray(pipelines) || pipelines.length === 0) {
        return [];
    }

    const statusMatched = pipelines.filter((pipeline) => {
        const htmlUrl = normalizePipelineResultUrl(pipeline.links?.html?.href);
        const buildNumber = Number.isInteger(pipeline.build_number) ? pipeline.build_number : null;
        return (
            (buildNumber !== null && statusBuildNumbers.has(buildNumber)) ||
            (htmlUrl && statusUrls.has(htmlUrl))
        );
    });
    if (statusMatched.length > 0) {
        return statusMatched;
    }

    const prMatched = pipelines.filter((pipeline) => {
        const pipelinePrId = pipeline.target?.pullrequest?.id;
        return pipelinePrId === prId;
    });
    if (prMatched.length > 0) {
        return prMatched;
    }

    return pipelines.filter((pipeline) => {
        const pipelineCommitHash = normalizeFullCommitHash(pipeline.target?.commit?.hash);
        const pipelineBranch = pipeline.target?.ref_name || pipeline.target?.ref?.name || null;
        return (
            pipelineCommitHash === commitHash &&
            (!sourceBranch || pipelineBranch === sourceBranch || !pipelineBranch)
        );
    });
}

async function listPipelinesForCommitHash(client, commitHash) {
    const result = await client.request("GET", client.repoPath("pipelines"), {
        queryParams: {
            sort: "-created_on",
            pagelen: String(TOOL_LIMITS.pullRequestPipelinesCap),
            "target.commit.hash": commitHash,
        },
    });

    return {
        items: result.values || [],
        truncated: Boolean(result.next),
    };
}

async function listPipelinesForPullRequestTarget(client, { sourceBranch, sourceCommitHash }) {
    const queryParams = {
        sort: "-created_on",
        pagelen: String(TOOL_LIMITS.pullRequestPipelinesCap),
        "target.ref_type": "branch",
        "target.ref_name": sourceBranch,
    };

    if (sourceCommitHash) {
        queryParams["target.commit.hash"] = sourceCommitHash;
    }

    const result = await client.request("GET", client.repoPath("pipelines"), {
        queryParams,
    });

    return {
        items: result.values || [],
        truncated: Boolean(result.next),
    };
}

async function buildPipelineFailureOutput(pipeline, client) {
    const pipelineUuid = normalizeBitbucketUuid(pipeline.uuid, "pipeline uuid");
    const failures = await readFailedStepLogs(pipelineUuid, client);

    return {
        pipeline: mapPipelineSummary(pipeline),
        failure_count: failures.length,
        failures,
    };
}

async function readFailedStepLogs(pipelineUuid, client) {
    const { items: steps } = await collectPaginatedValues(
        client,
        client.repoPath(`pipelines/${pipelineUuid}/steps`),
        (step) => step,
    );

    const failedSteps = steps
        .filter(isFailedPipelineStep)
        .slice(0, TOOL_LIMITS.pipelineFailedStepsCap);
    const failures = [];

    for (const step of failedSteps) {
        const stepUuid = normalizeBitbucketUuid(step.uuid, "step uuid");
        const normalizedLog = await readStepLogText(pipelineUuid, stepUuid, client);
        const { text, truncated } = truncateText(normalizedLog, TOOL_LIMITS.pipelineLogBytes);

        failures.push({
            step: mapPipelineStep(step),
            log: text,
            truncated,
        });
    }

    return failures;
}

async function readStepLogText(pipelineUuid, stepUuid, client) {
    const logText = await client.request(
        "GET",
        client.repoPath(`pipelines/${pipelineUuid}/steps/${stepUuid}/log`),
        { accept: PIPELINE_LOG_ACCEPT },
    );
    if (typeof logText === "string") {
        return logText;
    }
    if (logText && typeof logText === "object" && logText.status === 204) {
        return "";
    }
    return JSON.stringify(logText, null, 2);
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

function requirePipelineUuid(value) {
    if (value === undefined || value === null || value === "") {
        throw new Error("Parametro obbligatorio mancante: pipeline_ref");
    }
    return normalizeBitbucketUuid(value, "pipeline_ref");
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

function normalizeBitbucketUuid(rawValue, label) {
    const normalized = validateString(rawValue, label, {
        maxLength: TOOL_LIMITS.pipelineRefLength,
    });
    const match = normalized.match(/\{?[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}\}?/);
    if (!match) {
        throw new Error(`${label} deve contenere un UUID Bitbucket valido.`);
    }
    const uuid = match[0].replace(/[{}]/g, "").toLowerCase();
    return `{${uuid}}`;
}

function truncateText(value, maxLength) {
    if (value.length <= maxLength) {
        return { text: value, truncated: false };
    }
    return {
        text: value.slice(0, maxLength),
        truncated: true,
    };
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

function mapPipelineSummary(pipeline) {
    return {
        uuid: pipeline.uuid || null,
        build_number: pipeline.build_number || null,
        state: pipeline.state?.name || null,
        result: pipeline.state?.result?.name || null,
        branch: pipeline.target?.ref_name || pipeline.target?.ref?.name || null,
        commit_hash: pipeline.target?.commit?.hash || null,
        commit_message:
            pipeline.target?.commit?.message || pipeline.target?.commit?.summary?.raw || null,
        creator: pipeline.creator?.display_name || pipeline.created_by?.display_name || null,
        created_on: pipeline.created_on || null,
        completed_on: pipeline.completed_on || null,
        duration_in_seconds: pipeline.duration_in_seconds || null,
        link: pipeline.links?.html?.href || null,
    };
}

function mapPipelineStep(step) {
    return {
        uuid: step.uuid || null,
        name: step.name || step.step?.name || step.setup_commands?.[0] || null,
        state: step.state?.name || null,
        result: step.state?.result?.name || null,
        started_on: step.started_on || null,
        completed_on: step.completed_on || null,
        duration_in_seconds: step.duration_in_seconds || null,
        link: step.links?.html?.href || null,
    };
}

function isFailedPipelineStep(step) {
    const state = String(step.state?.name || "")
        .trim()
        .toUpperCase();
    const result = String(step.state?.result?.name || "")
        .trim()
        .toUpperCase();

    return result === "FAILED" || result === "ERROR" || state === "FAILED" || state === "ERROR";
}

function isFailedPipelineRun(pipeline) {
    const state = String(pipeline.state?.name || "")
        .trim()
        .toUpperCase();
    const result = String(pipeline.state?.result?.name || "")
        .trim()
        .toUpperCase();

    return result === "FAILED" || result === "ERROR" || state === "FAILED" || state === "ERROR";
}
