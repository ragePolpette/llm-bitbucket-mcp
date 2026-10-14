export class BitbucketRepositoryRegistry {
    constructor(repositories, defaultRepositoryId, createClient) {
        this._repositories = new Map();
        for (const repository of repositories) {
            this._repositories.set(repository.id, {
                ...repository,
                allowMerge: repository.allowMerge === true,
                client: createClient(repository),
            });
        }
        this._defaultRepositoryId = defaultRepositoryId || "";
    }

    resolve(repositoryId) {
        const selectedId = String(repositoryId || this._defaultRepositoryId || "").trim();
        if (!selectedId) {
            throw new Error(
                "repository_id e' obbligatorio quando non e' configurato un repository predefinito.",
            );
        }
        const repository = this._repositories.get(selectedId);
        if (!repository || repository.status !== "active") {
            throw new Error(`Repository non configurato o disabilitato: ${selectedId}`);
        }
        return repository;
    }

    describe(repository) {
        return {
            id: repository.id,
            displayName: repository.displayName,
            workspace: repository.workspace,
            repoSlug: repository.repoSlug,
            defaultDestinationBranch: repository.defaultDestinationBranch || "",
            status: repository.status,
            allowMerge: repository.allowMerge === true,
            isDefault: repository.id === this._defaultRepositoryId,
        };
    }

    list() {
        return [...this._repositories.values()].map((repository) => this.describe(repository));
    }

    get mergeAvailable() {
        return [...this._repositories.values()].some(
            (repository) => repository.status === "active" && repository.allowMerge === true,
        );
    }

    get defaultRepositoryId() {
        return this._defaultRepositoryId;
    }
}
