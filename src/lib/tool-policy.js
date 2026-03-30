export const WRITE_TOOL_NAMES = new Set([
    "add_pull_request_comment",
    "create_pull_request",
    "open_pull_request",
]);

export const DEFAULT_ENABLED_WRITE_TOOLS = [...WRITE_TOOL_NAMES];

export const TOOL_LIMITS = {
    branchNameLength: 255,
    titleLength: 200,
    descriptionLength: 10000,
    commentLength: 10000,
    filePathLength: 500,
    pipelineRefLength: 500,
    bitbucketPageLength: 100,
    paginatedCollectionCap: 500,
    pipelineFailedStepsCap: 10,
    pipelineLogBytes: 200 * 1024,
    reviewerIdLength: 100,
    reviewers: 10,
    queryParams: 20,
    queryKeyLength: 100,
    queryValueLength: 200,
};

export const ALLOWED_PR_STATES = new Set(["OPEN", "MERGED", "DECLINED", "SUPERSEDED"]);
