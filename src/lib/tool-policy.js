export const WRITE_TOOL_NAMES = new Set([
    "add_pull_request_comment",
    "create_pull_request",
    "open_pull_request",
    "run_pipeline",
    "merge_pull_request",
]);

export const DEFAULT_ENABLED_WRITE_TOOLS = [...WRITE_TOOL_NAMES];

export const MERGE_STRATEGIES = new Set(["merge_commit", "squash", "fast_forward"]);

export const MERGE_CONFIRMATION_TTL_MS = 5 * 60 * 1000;

export const TOOL_LIMITS = {
    branchNameLength: 255,
    titleLength: 200,
    descriptionLength: 10000,
    commentLength: 10000,
    filePathLength: 500,
    pullRequestPipelinesCap: 20,
    pipelineRefLength: 500,
    pipelineNameLength: 200,
    pipelineVariables: 20,
    pipelineVariableKeyLength: 100,
    pipelineVariableValueLength: 2000,
    bitbucketPageLength: 100,
    paginatedCollectionCap: 500,
    pipelineFailedStepsCap: 10,
    pipelineStepsCap: 50,
    pipelineLogBytes: 200 * 1024,
    mergeMessageLength: 2000,
    confirmationTokenLength: 128,
    reviewerIdLength: 100,
    reviewers: 10,
    queryParams: 20,
    queryKeyLength: 100,
    queryValueLength: 200,
};

export const ALLOWED_PR_STATES = new Set(["OPEN", "MERGED", "DECLINED", "SUPERSEDED"]);
