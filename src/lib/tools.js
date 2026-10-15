import {
    CONFIRMED_TOOL_NAMES,
    DEFAULT_ENABLED_WRITE_TOOLS,
    WRITE_TOOL_NAMES,
} from "./tool-policy.js";

const PR_ID = { type: "integer", description: "Pull request ID." };

const PIPELINE_REF = {
    type: "string",
    description:
        "Bitbucket pipeline UUID, with or without braces, or a Bitbucket URL containing it.",
};

const CONFIRMATION_TOKEN = {
    type: "string",
    description:
        "Token returned by the first call. Pass it only after the user explicitly confirmed in chat.",
};

const CREATE_PULL_REQUEST_SCHEMA = {
    type: "object",
    properties: {
        title: { type: "string", description: "Pull request title." },
        source_branch: { type: "string", description: "Source branch." },
        description: { type: "string", description: "Markdown description of the pull request." },
        destination_branch: {
            type: "string",
            description:
                "Destination branch. Falls back to the repository default destination branch; fails if neither is set.",
        },
        reviewers: {
            type: "array",
            items: { type: "string" },
            description: "Bitbucket UUIDs of the reviewers.",
        },
        close_source_branch: {
            type: "boolean",
            description: "Close the source branch after merge. Default: true.",
        },
    },
    required: ["title", "source_branch"],
};

function prOnlySchema() {
    return {
        type: "object",
        properties: { pr_id: PR_ID },
        required: ["pr_id"],
    };
}

function pipelineRefSchema() {
    return {
        type: "object",
        properties: { pipeline_ref: PIPELINE_REF },
        required: ["pipeline_ref"],
    };
}

export const TOOLS = [
    {
        name: "bitbucket_info",
        description:
            "Tool map, operating boundaries and runtime options of this Bitbucket MCP server.",
        annotations: { readOnlyHint: true },
        inputSchema: {
            type: "object",
            properties: {},
        },
    },
    // ── PR read tools ────────────────────────────────────────────
    {
        name: "list_pull_requests",
        description:
            "List pull requests of the Bitbucket repository. Filter by state and optionally by exact source or destination branch.",
        annotations: { readOnlyHint: true },
        inputSchema: {
            type: "object",
            properties: {
                state: {
                    type: "string",
                    enum: ["OPEN", "MERGED", "DECLINED", "SUPERSEDED"],
                    description: "Pull request state. Default: OPEN.",
                },
                source_branch: {
                    type: "string",
                    description: "Filter by source branch (exact match). Optional.",
                },
                destination_branch: {
                    type: "string",
                    description: "Filter by destination branch (exact match). Optional.",
                },
                page: {
                    type: "integer",
                    minimum: 1,
                    description: "Page number (1-based). Default: 1.",
                },
                pagelen: {
                    type: "integer",
                    minimum: 1,
                    maximum: 50,
                    description: "Results per page (max 50). Default: 25.",
                },
            },
        },
    },
    {
        name: "find_open_pull_request",
        description:
            "Find an open pull request by exact source branch and, optionally, destination branch. Scans at most 10 result pages and reports truncated: true when the scan stopped early.",
        annotations: { readOnlyHint: true },
        inputSchema: {
            type: "object",
            properties: {
                source_branch: {
                    type: "string",
                    description: "Source branch to look for (exact match).",
                },
                destination_branch: {
                    type: "string",
                    description: "Destination branch filter. Optional.",
                },
            },
            required: ["source_branch"],
        },
    },
    {
        name: "get_pull_request",
        description:
            "Full details of a pull request (title, description, author, reviewers, state, branches, dates).",
        annotations: { readOnlyHint: true },
        inputSchema: prOnlySchema(),
    },
    {
        name: "get_pull_request_diff",
        description:
            "Unified diff (patch) of a pull request. Truncated to 500 KB (UTF-8 bytes) when larger.",
        annotations: { readOnlyHint: true },
        inputSchema: prOnlySchema(),
    },
    {
        name: "get_pull_request_comments",
        description:
            "All comments of a pull request (general and inline), with parent_id for replies. Automatic pagination, capped at 500.",
        annotations: { readOnlyHint: true },
        inputSchema: prOnlySchema(),
    },
    {
        name: "get_pull_request_commits",
        description:
            "List the commits included in the pull request. Automatic pagination, capped at 500.",
        annotations: { readOnlyHint: true },
        inputSchema: prOnlySchema(),
    },
    {
        name: "get_pull_request_statuses",
        description:
            "Build and check statuses attached to the pull request. Automatic pagination, capped at 500.",
        annotations: { readOnlyHint: true },
        inputSchema: prOnlySchema(),
    },
    {
        name: "get_pull_request_tasks",
        description:
            "List the tasks of the pull request, including state and linked comment. Automatic pagination, capped at 500.",
        annotations: { readOnlyHint: true },
        inputSchema: prOnlySchema(),
    },
    {
        name: "get_pull_request_pipelines",
        description:
            "Starting from pr_id, correlate the pull request pipelines through Bitbucket statuses and the source commit, falling back to the source branch.",
        annotations: { readOnlyHint: true },
        inputSchema: prOnlySchema(),
    },
    {
        name: "get_pull_request_pipeline_failure_output",
        description:
            "Starting from pr_id, find the pipelines related to the pull request through Bitbucket statuses and return the logs of the failed steps.",
        annotations: { readOnlyHint: true },
        inputSchema: prOnlySchema(),
    },
    {
        name: "get_pipeline_run",
        description:
            "Summary of a Bitbucket pipeline: state, result, target branch and commit, build number and link.",
        annotations: { readOnlyHint: true },
        inputSchema: pipelineRefSchema(),
    },
    {
        name: "wait_for_pipeline",
        description:
            "Poll a pipeline until it completes or pauses, or until timeout_seconds elapses (max 600). Returns the last observed state with completed and timed_out flags. Read-only. Your MCP client may enforce a shorter request timeout.",
        annotations: { readOnlyHint: true },
        inputSchema: {
            type: "object",
            properties: {
                pipeline_ref: PIPELINE_REF,
                timeout_seconds: {
                    type: "integer",
                    minimum: 1,
                    maximum: 600,
                    description: "Maximum time to wait, in seconds. Default: 300.",
                },
                poll_interval_seconds: {
                    type: "integer",
                    minimum: 5,
                    maximum: 60,
                    description: "Delay between polls, in seconds. Default: 15.",
                },
            },
            required: ["pipeline_ref"],
        },
    },
    {
        name: "get_pipeline_failure_output",
        description:
            "Return the failed steps of a pipeline and their log output, safely truncated when too long.",
        annotations: { readOnlyHint: true },
        inputSchema: pipelineRefSchema(),
    },
    {
        name: "list_pipeline_steps",
        description:
            "List the steps of a Bitbucket pipeline with state, result and duration, without downloading logs.",
        annotations: { readOnlyHint: true },
        inputSchema: pipelineRefSchema(),
    },
    {
        name: "get_pipeline_step_log",
        description:
            "Read the text log of a pipeline step (any state, not only failed), safely truncated when too long.",
        annotations: { readOnlyHint: true },
        inputSchema: {
            type: "object",
            properties: {
                pipeline_ref: PIPELINE_REF,
                step_uuid: {
                    type: "string",
                    description: "Step UUID, with or without braces (from list_pipeline_steps).",
                },
            },
            required: ["pipeline_ref", "step_uuid"],
        },
    },

    // ── PR write tools ───────────────────────────────────────────
    {
        name: "add_pull_request_comment",
        description:
            "Post a comment on a pull request, either general or inline (on a specific file and line). Supports Markdown.",
        annotations: { readOnlyHint: false, idempotentHint: false },
        inputSchema: {
            type: "object",
            properties: {
                pr_id: PR_ID,
                content: {
                    type: "string",
                    description: "Comment text (Markdown supported).",
                },
                file_path: {
                    type: "string",
                    description: "File path for an inline comment. Omit for a general comment.",
                },
                line_to: {
                    type: "integer",
                    description: "Line number (in the new file) for an inline comment.",
                },
            },
            required: ["pr_id", "content"],
        },
    },
    {
        name: "reply_to_pull_request_comment",
        description: "Reply to an existing pull request comment. Supports Markdown.",
        annotations: { readOnlyHint: false, idempotentHint: false },
        inputSchema: {
            type: "object",
            properties: {
                pr_id: PR_ID,
                parent_id: {
                    type: "integer",
                    description:
                        "ID of the comment being replied to (from get_pull_request_comments).",
                },
                content: {
                    type: "string",
                    description: "Reply text (Markdown supported).",
                },
            },
            required: ["pr_id", "parent_id", "content"],
        },
    },
    {
        name: "update_pull_request",
        description:
            "Update the title and/or description of a pull request. Provide at least one of them; fields omitted keep their current value.",
        annotations: { readOnlyHint: false, idempotentHint: true },
        inputSchema: {
            type: "object",
            properties: {
                pr_id: PR_ID,
                title: {
                    type: "string",
                    description: "New pull request title.",
                },
                description: {
                    type: "string",
                    description: "New pull request description (Markdown supported).",
                },
            },
            required: ["pr_id"],
        },
    },
    {
        name: "create_pull_request_task",
        description: "Create a task on a pull request, optionally attached to an existing comment.",
        annotations: { readOnlyHint: false, idempotentHint: false },
        inputSchema: {
            type: "object",
            properties: {
                pr_id: PR_ID,
                content: { type: "string", description: "Task text." },
                comment_id: {
                    type: "integer",
                    description: "ID of the comment the task is attached to. Optional.",
                },
            },
            required: ["pr_id", "content"],
        },
    },
    {
        name: "resolve_pull_request_task",
        description: "Mark a pull request task as resolved.",
        annotations: { readOnlyHint: false, idempotentHint: true },
        inputSchema: {
            type: "object",
            properties: {
                pr_id: PR_ID,
                task_id: {
                    type: "integer",
                    description: "Task ID (from get_pull_request_tasks).",
                },
            },
            required: ["pr_id", "task_id"],
        },
    },
    {
        name: "approve_pull_request",
        description: "Approve a pull request as the authenticated Bitbucket user.",
        annotations: { readOnlyHint: false, idempotentHint: true },
        inputSchema: prOnlySchema(),
    },
    {
        name: "unapprove_pull_request",
        description: "Remove the approval of the authenticated Bitbucket user from a pull request.",
        annotations: { readOnlyHint: false, idempotentHint: true },
        inputSchema: prOnlySchema(),
    },
    {
        name: "create_pull_request",
        description:
            "Create a new Bitbucket pull request from the source branch to the destination branch.",
        annotations: { readOnlyHint: false, idempotentHint: false },
        inputSchema: CREATE_PULL_REQUEST_SCHEMA,
    },
    {
        name: "open_pull_request",
        description:
            "Ergonomic alias of create_pull_request, with the same contract and creation logic.",
        annotations: { readOnlyHint: false, idempotentHint: false },
        inputSchema: CREATE_PULL_REQUEST_SCHEMA,
    },
    {
        name: "run_pipeline",
        description:
            "Start a Bitbucket pipeline on a branch. Without pipeline_name runs the default pipeline of the branch; with pipeline_name runs that custom pipeline.",
        annotations: { readOnlyHint: false, idempotentHint: false },
        inputSchema: {
            type: "object",
            properties: {
                branch: { type: "string", description: "Branch to run the pipeline on." },
                pipeline_name: {
                    type: "string",
                    description:
                        "Custom pipeline name (pipelines.custom section of bitbucket-pipelines.yml). Omit for the default pipeline of the branch.",
                },
                commit_hash: {
                    type: "string",
                    description:
                        "Specific commit (full 40 character hash) to run the pipeline on. Default: branch HEAD.",
                },
                variables: {
                    type: "object",
                    description:
                        "Pipeline variables as key -> value, passed as non-secret variables.",
                    additionalProperties: { type: "string" },
                },
            },
            required: ["branch"],
        },
    },
    {
        name: "merge_pull_request",
        description:
            "Merge a pull request in two steps. First call without confirmation_token: returns the pull request summary and a token. " +
            "ALWAYS ask the user for explicit confirmation in chat showing the summary; only after confirmation call the tool again with the same parameters and the confirmation_token. " +
            "Only available for repositories with allowMerge enabled. Irreversible operation.",
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
        inputSchema: {
            type: "object",
            properties: {
                pr_id: PR_ID,
                merge_strategy: {
                    type: "string",
                    enum: ["merge_commit", "squash", "fast_forward"],
                    description: "Merge strategy. Default: merge_commit.",
                },
                close_source_branch: {
                    type: "boolean",
                    description: "Close the source branch after merge. Default: true.",
                },
                message: {
                    type: "string",
                    description: "Merge commit message. Optional.",
                },
                confirmation_token: CONFIRMATION_TOKEN,
            },
            required: ["pr_id"],
        },
    },
    {
        name: "decline_pull_request",
        description:
            "Decline a pull request in two steps. First call without confirmation_token: returns the pull request summary and a token. " +
            "ALWAYS ask the user for explicit confirmation in chat showing the summary; only after confirmation call the tool again with the same pr_id and the confirmation_token. " +
            "Only available for repositories with allowMerge enabled.",
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
        inputSchema: {
            type: "object",
            properties: {
                pr_id: PR_ID,
                confirmation_token: CONFIRMATION_TOKEN,
            },
            required: ["pr_id"],
        },
    },
];

/*
 * bb_api has an internal handler but is intentionally NOT exposed. Its definition would be:
 *
 * {
 *     name: "bb_api",
 *     description:
 *         "Generic read-only call to the Bitbucket REST 2.0 API, limited to GET on the selected repository.",
 *     annotations: { readOnlyHint: true },
 *     inputSchema: {
 *         type: "object",
 *         properties: {
 *             method: { type: "string", enum: ["GET"] },
 *             path: { type: "string" },
 *             queryParams: { type: "object", additionalProperties: { type: "string" } },
 *         },
 *         required: ["method", "path"],
 *     }
 * }
 */

const REPOSITORY_SELECTOR = {
    type: "string",
    description: "ID of the configured repository. Optional only when a default repository exists.",
};

export const EXPOSED_TOOL_NAMES = new Set(TOOLS.map((tool) => tool.name));

export const MERGE_TOOL_NAME = "merge_pull_request";

export function getEnabledTools(
    enabledWriteTools = DEFAULT_ENABLED_WRITE_TOOLS,
    { mergeAvailable = true } = {},
) {
    const allowedWriteTools = new Set(enabledWriteTools);
    return TOOLS.filter((tool) => {
        if (CONFIRMED_TOOL_NAMES.has(tool.name) && !mergeAvailable) {
            return false;
        }
        return !WRITE_TOOL_NAMES.has(tool.name) || allowedWriteTools.has(tool.name);
    }).map((tool) => ({
        ...tool,
        inputSchema: {
            ...tool.inputSchema,
            properties: {
                repository_id: REPOSITORY_SELECTOR,
                ...(tool.inputSchema.properties || {}),
            },
        },
    }));
}

export function getEnabledToolNames(enabledWriteTools = DEFAULT_ENABLED_WRITE_TOOLS, options = {}) {
    return new Set(getEnabledTools(enabledWriteTools, options).map((tool) => tool.name));
}

export function buildToolMap(toolNames = EXPOSED_TOOL_NAMES) {
    const allowed = new Set(toolNames);
    const toolMap = { discovery: [], pr_write: [], pipeline_write: [], utility: [] };
    for (const tool of TOOLS) {
        if (!allowed.has(tool.name)) continue;
        if (!WRITE_TOOL_NAMES.has(tool.name)) {
            toolMap.discovery.push(tool.name);
        } else if (tool.name.includes("pipeline")) {
            toolMap.pipeline_write.push(tool.name);
        } else {
            toolMap.pr_write.push(tool.name);
        }
    }
    return toolMap;
}
