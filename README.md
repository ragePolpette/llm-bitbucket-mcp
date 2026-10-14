# llm-bitbucket-mcp

A local-first MCP server that exposes Bitbucket Cloud pull request and pipeline workflows through a constrained, per-repository tool surface.

[![CI](https://github.com/ragePolpette/llm-bitbucket-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/ragePolpette/llm-bitbucket-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node.js 22](https://img.shields.io/badge/node-22-339933.svg)

## Overview

It is designed for developer tooling, personal automation, and small-team internal environments where Bitbucket actions should be exposed through a constrained MCP surface rather than through a generic workstation agent.

## Features

- pull request discovery and inspection
- diff, comments, commits, tasks, and status retrieval
- pipeline lookup, step listing and log extraction (failed or any step)
- pipeline runs on a branch (default or custom pipeline)
- pull request creation
- pull request comments
- pull request merge gated per repository and by an explicit two-step confirmation
- multiple approved repositories selected per tool call via `repository_id`
- a constrained repository-scoped API escape hatch kept out of the default public tool catalog

### Exposed tools

- `bitbucket_info`
- `list_pull_requests`
- `find_open_pull_request`
- `get_pull_request`
- `get_pull_request_diff`
- `get_pull_request_comments`
- `get_pull_request_commits`
- `get_pull_request_statuses`
- `get_pull_request_tasks`
- `get_pull_request_pipelines`
- `get_pull_request_pipeline_failure_output`
- `get_pipeline_run`
- `get_pipeline_failure_output`
- `list_pipeline_steps`
- `get_pipeline_step_log`
- `add_pull_request_comment`
- `create_pull_request`
- `open_pull_request`
- `run_pipeline`
- `merge_pull_request` (only listed when at least one active repository has `allowMerge: true`)

## Architecture

The runtime is intentionally small:

- `src/server.js`: minimal entrypoint
- `src/lib/runtime.js`: runtime bootstrap and dependency wiring
- `src/lib/app.js`: MCP HTTP app factory, session routing, and CORS handling
- `src/lib/config.js`: environment loading and validation
- `src/lib/runtime-policy.js`: HTTP and security defaults
- `src/lib/bitbucket-client.js`: repository-scoped Bitbucket REST client
- `src/lib/tool-policy.js`: tool contracts and validation limits
- `src/lib/handlers.js`: MCP tool dispatch and validation
- `src/lib/session-store.js`: bounded in-memory session lifecycle

## Quick start

Requirements:

- Node.js 22 (see `.nvmrc`)
- Bitbucket Cloud credentials provided at runtime: `BITBUCKET_USER_EMAIL` and `BITBUCKET_API_TOKEN`

```bash
npm install
export BITBUCKET_USER_EMAIL="you@example.com"
export BITBUCKET_API_TOKEN="<api token>"
export BITBUCKET_REPOSITORIES_JSON='[{"id":"backend","workspace":"workspace-slug","repoSlug":"repo-slug","defaultDestinationBranch":"main","status":"active"}]'
export BITBUCKET_DEFAULT_REPOSITORY=backend
npm start
```

Default endpoints:

- health: `http://127.0.0.1:8783/health`
- metrics: `http://127.0.0.1:8783/metrics`
- MCP: `http://127.0.0.1:8783/mcp`

A Docker image can be built with `npm run docker:build`; see the [Dockerfile](Dockerfile).

## Configuration

Use `.env.example` only as a configuration reference.

Important notes:

- `BITBUCKET_API_TOKEN` must not be stored in `.env` or committed files
- `MCP_BB_INTERNAL_API_KEY` is optional and should also stay outside repo files
- `BITBUCKET_REPOSITORIES_JSON` lists the approved repositories; each entry supports `id`, `displayName`, `workspace`, `repoSlug`, `defaultDestinationBranch`, `status` (`active`/`disabled`) and `allowMerge` (default `false`)
- `BITBUCKET_DEFAULT_REPOSITORY` selects the repository used when a tool call omits `repository_id`
- `BITBUCKET_WORKSPACE`, `BITBUCKET_REPO_SLUG`, `BITBUCKET_DEFAULT_DESTINATION_BRANCH` and `BITBUCKET_ALLOW_MERGE` remain supported as a legacy single-repository configuration
- `MCP_BB_ENABLED_WRITE_TOOLS` can reduce the exposed mutation surface (`add_pull_request_comment`, `create_pull_request`, `open_pull_request`, `run_pipeline`, `merge_pull_request`)

### Merge Confirmation Flow

`merge_pull_request` never merges on the first call:

1. The agent calls the tool with `pr_id` (and optional `merge_strategy`, `close_source_branch`, `message`). The server returns a pull request summary, a single-use `confirmation_token` valid for five minutes, and instructions to ask the user for confirmation.
2. The agent shows the summary in chat and waits for an explicit "yes" from the user.
3. Only then the agent calls the tool again with the same parameters plus `confirmation_token`. Tokens are bound to repository, pull request and merge parameters; mismatches, reuse or expiry are rejected and a new summary must be requested.

Repositories with `allowMerge` unset or `false` reject the tool outright, and the tool is not even listed when no active repository allows merges.

## Usage

Find an open pull request:

```json
{
    "tool": "find_open_pull_request",
    "arguments": {
        "source_branch": "feature/my-change",
        "destination_branch": "main"
    }
}
```

Create a pull request:

```json
{
    "tool": "create_pull_request",
    "arguments": {
        "title": "Add runtime hardening",
        "source_branch": "feature/runtime-hardening",
        "destination_branch": "main",
        "description": "Tighten config validation and session handling."
    }
}
```

Inspect pull request statuses:

```json
{
    "tool": "get_pull_request_statuses",
    "arguments": {
        "pr_id": 42
    }
}
```

Read failed pipeline output:

```json
{
    "tool": "get_pipeline_failure_output",
    "arguments": {
        "pipeline_ref": "{11111111-2222-3333-4444-555555555555}"
    }
}
```

Run a custom pipeline on a branch of a specific repository:

```json
{
    "tool": "run_pipeline",
    "arguments": {
        "repository_id": "backend",
        "branch": "release/1.4",
        "pipeline_name": "deploy-staging"
    }
}
```

Merge a pull request (first call returns the summary and token, second call confirms):

```json
{
    "tool": "merge_pull_request",
    "arguments": {
        "repository_id": "backend",
        "pr_id": 42,
        "merge_strategy": "squash",
        "confirmation_token": "<token from the previous call, after the user confirmed in chat>"
    }
}
```

## Security

This repository is calibrated for a local/internal tool, not for a public internet service.

Current guardrails:

- `BITBUCKET_API_TOKEN` is rejected if loaded from `.env`
- runtime config is validated at startup with explicit bounds
- sessions are bounded by TTL and capacity
- optional API-key auth can protect `/health` and `/mcp`
- exposed write tools can be restricted through a runtime allowlist
- read retries are bounded and only applied to safe GET flows
- `/health` and `/metrics` stay minimal and runtime-oriented

The project aims to be safe by default for local use without pretending to solve infrastructure problems outside its target scope.

See [SECURITY.md](SECURITY.md) for the threat model and how to report vulnerabilities.

## Scope And Non-Goals

In scope:

- Bitbucket Cloud operations centered on pull requests
- local or internal MCP HTTP sessions
- runtime observability for local dashboards and agent workflows

Out of scope:

- local checkout and branch management
- commit creation
- unattended merge automation (merges always require an explicit human confirmation)
- approval automation
- generic git workstation orchestration
- public multi-tenant SaaS concerns

Remote Bitbucket actions belong here. Local git workflow belongs elsewhere.

## Development

```bash
npm run lint
npm run format:check
npm test
npm run check
```

`npm run check` runs lint, the Prettier check and the tests. See [CONTRIBUTING.md](CONTRIBUTING.md) and [RELEASE.md](RELEASE.md).

## Project Status

This repository is in active development and used for local and internal workflows. Merge is available only through the gated flow described above, and approval is not exposed.

## Documentation

- [CHANGELOG.md](CHANGELOG.md)
- [CONTRIBUTING.md](CONTRIBUTING.md)
- [SECURITY.md](SECURITY.md)
- [RELEASE.md](RELEASE.md)
- [.env.example](.env.example)

## Development Process

Built with AI-assisted workflows, while architecture, tradeoffs, integration, review, and validation were directed by the author.

## License

[MIT](LICENSE)
