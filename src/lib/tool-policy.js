export const TOOL_LIMITS = {
    branchNameLength: 255,
    titleLength: 200,
    descriptionLength: 10000,
    commentLength: 10000,
    filePathLength: 500,
    bitbucketPageLength: 100,
    paginatedCollectionCap: 500,
    reviewerIdLength: 100,
    reviewers: 10,
    queryParams: 20,
    queryKeyLength: 100,
    queryValueLength: 200,
};

export const ALLOWED_PR_STATES = new Set(["OPEN", "MERGED", "DECLINED", "SUPERSEDED"]);
