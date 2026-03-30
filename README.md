# llm-bitbucket-mcp

`llm-bitbucket-mcp` is a local/internal MCP server for Bitbucket Cloud.

It is designed for:

- personal automation
- small-team developer workflows
- portfolio-quality public source code

It is not designed as a public multi-tenant SaaS service.

## What It Does

The server exposes a focused Bitbucket MCP surface for:

- pull request discovery and inspection
- pipeline run inspection and failed-step log extraction
- pull request commits, statuses and tasks
- pull request comments
- pull request creation
- a constrained read-only Bitbucket API escape hatch

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
- `get_pipeline_run`
- `get_pipeline_failure_output`
- `add_pull_request_comment`
- `create_pull_request`
- `open_pull_request`
- `bb_api`

## Scope And Non-Goals

This project intentionally keeps a narrow boundary.

In scope:

- Bitbucket Cloud read/write operations around pull requests
- streamable HTTP MCP sessions for local tools and dashboards

Out of scope:

- local branch checkout
- commit creation
- merge automation
- approval automation
- generic git workstation orchestration
- public internet deployment concerns such as multi-tenant auth or distributed session storage

The idea is simple: remote Bitbucket actions stay here, local git workflow stays in the harness or in a dedicated git MCP.

## Architecture

The runtime is intentionally small:

- [server.js](/C:/Users/Gianmarco/Urgewalt/Yetzirah/llm-bitbucket-mcp/src/server.js): minimal CLI entrypoint
- [runtime.js](/C:/Users/Gianmarco/Urgewalt/Yetzirah/llm-bitbucket-mcp/src/lib/runtime.js): bootstrap wiring for config, sessions, Bitbucket client and HTTP startup
- [app.js](/C:/Users/Gianmarco/Urgewalt/Yetzirah/llm-bitbucket-mcp/src/lib/app.js): MCP HTTP app factory, session routing, CORS handling
- [config.js](/C:/Users/Gianmarco/Urgewalt/Yetzirah/llm-bitbucket-mcp/src/lib/config.js): environment loading and runtime config validation
- [runtime-policy.js](/C:/Users/Gianmarco/Urgewalt/Yetzirah/llm-bitbucket-mcp/src/lib/runtime-policy.js): shared runtime constants and HTTP/security policy
- [bitbucket-client.js](/C:/Users/Gianmarco/Urgewalt/Yetzirah/llm-bitbucket-mcp/src/lib/bitbucket-client.js): Bitbucket REST client and repository-scoped API helpers
- [tool-policy.js](/C:/Users/Gianmarco/Urgewalt/Yetzirah/llm-bitbucket-mcp/src/lib/tool-policy.js): shared tool contracts and validation limits
- [handlers.js](/C:/Users/Gianmarco/Urgewalt/Yetzirah/llm-bitbucket-mcp/src/lib/handlers.js): tool dispatcher and runtime input validation
- [session-store.js](/C:/Users/Gianmarco/Urgewalt/Yetzirah/llm-bitbucket-mcp/src/lib/session-store.js): in-memory session lifecycle with TTL and capacity cap

## Security Posture

Security is calibrated for a local/internal tool, not for a public service.

Current guardrails:

- `BITBUCKET_API_TOKEN` is rejected if found in `.env`
- runtime config is validated at startup with explicit bounds
- MCP sessions have a safe TTL by default and a maximum in-memory capacity
- optional API-key auth can protect `/health` and `/mcp` in shared environments
- exposed write tools can be restricted through a runtime allowlist
- `/health` returns a minimal runtime payload
- transient Bitbucket read failures use bounded retry/backoff
- `/metrics` exposes essential runtime counters for local/internal troubleshooting
- `bb_api` is read-only and constrained to the configured repository scope

This is the intended posture:

- safe by default for local use
- constrained enough for a shared internal environment
- not pretending to solve internet-facing production security problems it does not need to solve

## Requirements

- Node.js 22+
- Bitbucket Cloud credentials:
    - `BITBUCKET_USER_EMAIL`
    - `BITBUCKET_API_TOKEN`

## Setup

Install dependencies:

```bash
npm install
```

Use [`.env.example`](/C:/Users/Gianmarco/Urgewalt/Yetzirah/llm-bitbucket-mcp/.env.example) as reference.

Important notes:

- `BITBUCKET_API_TOKEN` must not be stored in `.env` or in any file under this repo
- `MCP_BB_INTERNAL_API_KEY` is optional and must also stay out of repo files
- both values are expected only at runtime, either from the `.ps1` launcher or from the local dashboard in [mcp-dashboard](/C:/Users/Gianmarco/Urgewalt/Yetzirah/mcp-dashboard)
- `MCP_BB_SESSION_TTL_MS` defaults to 30 minutes
- `MCP_BB_MAX_SESSIONS` limits active in-memory sessions
- `MCP_BB_RETRY_MAX_ATTEMPTS` and `MCP_BB_RETRY_BASE_DELAY_MS` tune Bitbucket GET retry behavior
- `MCP_BB_ENABLED_WRITE_TOOLS` can disable selected write tools from the MCP surface
- `BITBUCKET_DEFAULT_DESTINATION_BRANCH` can supply the default destination branch for PR creation

## Run

```bash
npm start
```

Endpoints:

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

CI runs lint, formatting checks and tests on push and pull request.

## Packaging

This repo now ships with:

- a minimal [Dockerfile](/C:/Users/Gianmarco/Urgewalt/Yetzirah/llm-bitbucket-mcp/Dockerfile) for local/internal distribution
- a small [.dockerignore](/C:/Users/Gianmarco/Urgewalt/Yetzirah/llm-bitbucket-mcp/.dockerignore) to keep build context tight
- a [CHANGELOG.md](/C:/Users/Gianmarco/Urgewalt/Yetzirah/llm-bitbucket-mcp/CHANGELOG.md) for release notes
- a [RELEASE.md](/C:/Users/Gianmarco/Urgewalt/Yetzirah/llm-bitbucket-mcp/RELEASE.md) file that defines the release process

Build the local image with:

```bash
npm run docker:build
```

Runtime secrets still stay outside the image and outside repo files.

## Usage Examples

### Discover an open pull request

```json
{
    "tool": "find_open_pull_request",
    "arguments": {
        "source_branch": "feature/my-change",
        "destination_branch": "main"
    }
}
```

### Create a pull request

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

### Add a general PR comment

```json
{
    "tool": "add_pull_request_comment",
    "arguments": {
        "pr_id": 42,
        "content": "Please double-check the migration note before merge."
    }
}
```

### Inspect PR build statuses

```json
{
    "tool": "get_pull_request_statuses",
    "arguments": {
        "pr_id": 42
    }
}
```

### Query a repo-scoped Bitbucket endpoint

```json
{
    "tool": "bb_api",
    "arguments": {
        "method": "GET",
        "path": "/repositories/studioboost/bpopilot/pipelines"
    }
}
```

### Read a pipeline outcome

```json
{
    "tool": "get_pipeline_run",
    "arguments": {
        "pipeline_ref": "{11111111-2222-3333-4444-555555555555}"
    }
}
```

### Read failed pipeline output

```json
{
    "tool": "get_pipeline_failure_output",
    "arguments": {
        "pipeline_ref": "https://bitbucket.org/studioboost/bpopilot/addon/pipelines/home#!/results/{11111111-2222-3333-4444-555555555555}"
    }
}
```

### Shared environment auth

If `MCP_BB_INTERNAL_API_KEY` is configured, the server requires either:

- `x-mcp-api-key` with the runtime-injected value
- `Authorization: Bearer` with the same runtime-injected value

## Why Some Tools Are Missing

`approve_pull_request` and `merge_pull_request` are intentionally not exposed yet.

That is deliberate, not unfinished by accident:

- they are more sensitive than comment/create flows
- they need stricter policy and stronger tests
- for this project stage, keeping them out of the public MCP surface is the safer product choice

## Roadmap

The implementation roadmap is tracked in [ROADMAP_CHECKLIST.md](/C:/Users/Gianmarco/Urgewalt/Yetzirah/llm-bitbucket-mcp/ROADMAP_CHECKLIST.md).

Completed so far:

- `P0.1 Quality Baseline`
- `P0.2 Config And Runtime Hardening`
- `P0.3 API Boundary Hardening`
- `P0.4 Test Expansion`
- `P0.5 README And Portfolio Polish`
- `P1.1 Observability Lite`
- `P1.2 Tool Surface Simplification`
- `P1.3 Better Product Structure`
- `P1.4 More Complete Tool Surface`
- `P2.1 Security And Governance`
- `P2.2 Packaging And Distribution`
- `P2.3 Advanced Reliability`

Current next step:

- roadmap complete for the current internal-grade target
