# Changelog

All notable changes to this project will be documented in this file.

The format is inspired by Keep a Changelog.
Versioning follows Semantic Versioning (`MAJOR.MINOR.PATCH`).

## [Unreleased]

### Added

- `run_pipeline` tool to start the default or a custom pipeline on a branch, with optional commit pin and non-secret variables.
- `merge_pull_request` tool with a mandatory two-step confirmation (summary + single-use token) and a per-repository `allowMerge` switch, disabled by default.
- `list_pipeline_steps` and `get_pipeline_step_log` tools to inspect any pipeline step, not only failed ones.
- Multi-repository registry (`BITBUCKET_REPOSITORIES_JSON`, `BITBUCKET_DEFAULT_REPOSITORY`) with `repository_id` selection on every tool call.
- Pull-request-to-pipeline correlation tools using PR statuses, commit correlation and failed-step logs.
- Pipeline run inspection and failed-step log retrieval tools.
- Bounded retry/backoff for transient Bitbucket GET failures.
- Lightweight `/metrics` runtime counters for local/internal troubleshooting.
- Controlled sandbox integration tests for reliability behavior.
- Minimal Docker packaging for local/internal distribution.
- Tag-based GitHub release workflow with automated quality checks.
- Explicit release process documentation for version bumps and changelog updates.

### Fixed

- Pipeline step logs no longer fail with `406 Not Acceptable`: the client now accepts `application/octet-stream` responses, which is how Bitbucket serves step logs.

### Changed

- Hid the generic `bb_api` escape hatch from the exposed MCP catalog while keeping the internal handler in code.

## [1.0.0] - 2026-03-26

### Added

- Quality baseline with lint, Prettier, Node version pinning and CI.
- Runtime hardening for config validation, session TTLs and minimal health payloads.
- Repository-scoped Bitbucket API boundary hardening and stronger tool input validation.
- Expanded automated tests for config, HTTP behavior, logging and runtime wiring.
- Focused read-only PR tools for comments, commits, statuses and tasks.
- Optional runtime-only auth for shared environments and write-tool governance.

### Changed

- Removed `bb_clone` from the exposed MCP surface.
- Refactored server bootstrap into dedicated runtime and policy modules.
- Clarified runtime-only secret handling via PowerShell launcher or local MCP dashboard.
