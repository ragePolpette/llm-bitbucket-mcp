export const DEFAULT_ENABLED_WRITE_TOOLS = [
    "add_pull_request_comment",
    "create_pull_request",
    "open_pull_request",
    "run_pipeline",
    "merge_pull_request",
];

export const OPT_IN_WRITE_TOOLS = [
    "approve_pull_request",
    "unapprove_pull_request",
    "decline_pull_request",
    "reply_to_pull_request_comment",
    "create_pull_request_task",
    "resolve_pull_request_task",
];

export const WRITE_TOOL_NAMES = new Set([...DEFAULT_ENABLED_WRITE_TOOLS, ...OPT_IN_WRITE_TOOLS]);

export const CONFIRMED_TOOL_NAMES = new Set(["merge_pull_request", "decline_pull_request"]);

export const MERGE_STRATEGIES = new Set(["merge_commit", "squash", "fast_forward"]);

export const MERGE_CONFIRMATION_TTL_MS = 5 * 60 * 1000;

export const TOOL_LIMITS = {
    branchNameLength: 255,
    titleLength: 200,
    descriptionLength: 10000,
    commentLength: 10000,
    taskLength: 2000,
    filePathLength: 500,
    pullRequestPipelinesCap: 20,
    pipelineRefLength: 500,
    pipelineNameLength: 200,
    pipelineVariables: 20,
    pipelineVariableKeyLength: 100,
    pipelineVariableValueLength: 2000,
    bitbucketPageLength: 100,
    paginatedCollectionCap: 500,
    findOpenPullRequestPages: 10,
    pipelineFailedStepsCap: 10,
    pipelineStepsCap: 50,
    pipelineLogBytes: 200 * 1024,
    pullRequestDiffBytes: 500 * 1024,
    pipelineWaitMaxSeconds: 600,
    pipelineWaitDefaultSeconds: 300,
    pipelinePollMinSeconds: 5,
    pipelinePollMaxSeconds: 60,
    pipelinePollDefaultSeconds: 15,
    mergeMessageLength: 2000,
    confirmationTokenLength: 128,
    reviewerIdLength: 100,
    reviewers: 10,
    queryParams: 20,
    queryKeyLength: 100,
    queryValueLength: 200,
};

export const ALLOWED_PR_STATES = new Set(["OPEN", "MERGED", "DECLINED", "SUPERSEDED"]);
