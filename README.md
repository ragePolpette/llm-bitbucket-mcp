# llm-bitbucket-mcp

`llm-bitbucket-mcp` is a local-first MCP server for Bitbucket Cloud pull request and pipeline workflows.

It is designed for developer tooling, personal automation, and small-team internal environments where Bitbucket actions should be exposed through a constrained MCP surface rather than through a generic workstation agent.

## What It Does

The server exposes a focused Bitbucket MCP surface for:

- pull request discovery and inspection
- diff, comments, commits, tasks, and status retrieval
- pipeline lookup and failed-step log extraction
- pull request creation
- pull request comments
- a constrained repository-scoped API escape hatch kept out of the default public tool catalog

Current exposed tools:

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
- `add_pull_request_comment`
- `create_pull_request`
- `open_pull_request`

## Scope And Non-Goals

In scope:

- Bitbucket Cloud operations centered on pull requests
- local or internal MCP HTTP sessions
- runtime observability for local dashboards and agent workflows

Out of scope:

- local checkout and branch management
- commit creation
- merge automation
- approval automation
- generic git workstation orchestration
- public multi-tenant SaaS concerns

Remote Bitbucket actions belong here. Local git workflow belongs elsewhere.

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

## Security Posture

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

## Requirements

- Node.js 22+
- Bitbucket Cloud credentials provided at runtime:
  - `BITBUCKET_USER_EMAIL`
  - `BITBUCKET_API_TOKEN`

## Setup

Install dependencies:

```bash
npm install
```

Use `.env.example` only as a configuration reference.

Important notes:

- `BITBUCKET_API_TOKEN` must not be stored in `.env` or committed files
- `MCP_BB_INTERNAL_API_KEY` is optional and should also stay outside repo files
- `BITBUCKET_DEFAULT_DESTINATION_BRANCH` can provide the default target branch for PR creation
- `MCP_BB_ENABLED_WRITE_TOOLS` can reduce the exposed mutation surface

## Run

```bash
npm start
```

Default endpoints:

- health: `http://127.0.0.1:8783/health`
- metrics: `http://127.0.0.1:8783/metrics`
- MCP: `http://127.0.0.1:8783/mcp`

## Quality Gates

Available commands:

```bash
npm run lint
npm run format:check
npm test
npm run check
npm run docker:build
```

## Example MCP Calls

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

## Project Status

This repository is in active development, but the current tool surface is already stable enough for real local/internal workflows. Sensitive write operations such as approval and merge remain intentionally out of the exposed surface.

## Documentation

- [CHANGELOG.md](CHANGELOG.md)
- [ROADMAP_CHECKLIST.md](ROADMAP_CHECKLIST.md)
- [Dockerfile](Dockerfile)
- [.env.example](.env.example)

## Development Process

Built with AI-assisted workflows, while architecture, tradeoffs, integration, review, and validation were directed by the author.
