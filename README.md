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

- [server.js](/C:/Users/Gianmarco/Urgewalt/Yetzirah/llm-bitbucket-mcp/src/server.js): process bootstrap and startup error handling
- [app.js](/C:/Users/Gianmarco/Urgewalt/Yetzirah/llm-bitbucket-mcp/src/lib/app.js): MCP HTTP app factory, session routing, CORS handling
- [config.js](/C:/Users/Gianmarco/Urgewalt/Yetzirah/llm-bitbucket-mcp/src/lib/config.js): environment loading and runtime config validation
- [bitbucket-client.js](/C:/Users/Gianmarco/Urgewalt/Yetzirah/llm-bitbucket-mcp/src/lib/bitbucket-client.js): Bitbucket REST client and repository-scoped API helpers
- [handlers.js](/C:/Users/Gianmarco/Urgewalt/Yetzirah/llm-bitbucket-mcp/src/lib/handlers.js): tool dispatcher and runtime input validation
- [session-store.js](/C:/Users/Gianmarco/Urgewalt/Yetzirah/llm-bitbucket-mcp/src/lib/session-store.js): in-memory session lifecycle with TTL and capacity cap

## Security Posture

Security is calibrated for a local/internal tool, not for a public service.

Current guardrails:

- `BITBUCKET_API_TOKEN` is rejected if found in `.env`
- runtime config is validated at startup with explicit bounds
- MCP sessions have a safe TTL by default and a maximum in-memory capacity
- `/health` returns a minimal runtime payload
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

- `BITBUCKET_API_TOKEN` must not be stored in `.env`
- the token should be injected only at runtime
- `MCP_BB_SESSION_TTL_MS` defaults to 30 minutes
- `MCP_BB_MAX_SESSIONS` limits active in-memory sessions
- `BITBUCKET_DEFAULT_DESTINATION_BRANCH` can supply the default destination branch for PR creation

## Run

```bash
npm start
```

Endpoints:

- health: `http://127.0.0.1:8783/health`
- MCP: `http://127.0.0.1:8783/mcp`

## Quality Gates

Available commands:

```bash
npm run lint
npm run format:check
npm test
npm run check
```

CI runs lint, formatting checks and tests on push and pull request.

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

Current next step:

- `P1.2 Tool Surface Simplification`
