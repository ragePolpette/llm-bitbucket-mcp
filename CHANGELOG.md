# Changelog

All notable changes to this project will be documented in this file.

The format is inspired by Keep a Changelog.
Versioning follows Semantic Versioning (`MAJOR.MINOR.PATCH`).

## [Unreleased]

### Added

- Opt-in review tools `approve_pull_request`, `unapprove_pull_request`, `reply_to_pull_request_comment`, `create_pull_request_task` and `resolve_pull_request_task`. They are write tools that are not enabled by default and must be listed in `MCP_BB_ENABLED_WRITE_TOOLS`.
- Opt-in `decline_pull_request` tool with the same two-step confirmation as `merge_pull_request`, gated by the per-repository `allowMerge` switch.
- `wait_for_pipeline` read-only tool that polls a pipeline until it completes or pauses, bounded by `timeout_seconds` (max 600) and `poll_interval_seconds` (5 to 60).
- `list_pull_requests` accepts and validates an optional `destination_branch` filter.
- End-to-end HTTP test covering initialize, tools/list and tools/call against a stub Bitbucket API, and test coverage reporting in `npm test`.

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

- The internal `bb_api` repository scope check now rejects dot segments, backslashes and percent-encoded sequences, and compares the resolved path, so `/repositories/ws/repo/../../workspaces` no longer passes.
- `Retry-After` waits and exponential backoff are capped at 40 seconds.
- Merge confirmation tokens are bound to the MCP session that requested them; a token cannot be spent from another session and a full store no longer evicts tokens of other sessions (at most 10 pending tokens per session, new previews are refused with 503 when the server-wide limit is reached).
- The Docker `HEALTHCHECK` works when API-key auth is enabled.
- Response size limits are enforced while reading the body for JSON and text responses; oversized JSON responses and malformed JSON on successful responses now fail with an explicit error instead of returning an empty object.
- `find_open_pull_request` scans at most 10 pages and reports `truncated: true` when it stops early, and no longer loops on a non-advancing `next` link.
- `get_pull_request_diff` and pipeline log truncation count UTF-8 bytes and never split a character.
- A new MCP session is refused with a clean `503` before any transport is created when the session limit is reached.
- Pipeline step logs no longer fail with `406 Not Acceptable`: the client now accepts `application/octet-stream` responses, which is how Bitbucket serves step logs.

### Changed

- Hid the generic `bb_api` escape hatch from the exposed MCP catalog while keeping the internal handler in code.
- `/health` no longer requires the API key. Unauthenticated callers receive only `status`, `server` and `uptimeSec`; callers with a valid key still receive the full payload. `/metrics` and `/mcp` still require the key.
- Tool descriptions, error messages and configuration errors are now in English. Clients that matched on the previous Italian messages must be updated.
- `find_open_pull_request` responses now include a `truncated` flag.
- `bitbucket_info` derives its `tool_map` from the tool catalog and only lists the tools enabled for the current session.
- The MCP server version is read from `package.json`.

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
