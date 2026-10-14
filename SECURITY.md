# Security Policy

## Scope

`llm-bitbucket-mcp` is a local-first MCP server for Bitbucket Cloud. It is designed to run on a developer workstation or in a small internal environment, not as a public internet service. Security reports are in scope when they concern:

- this repository's source code and Docker packaging
- leakage or mishandling of the Bitbucket API token or the optional MCP API key
- bypass of the repository registry, the write-tool allowlist, the per-repository `allowMerge` switch or the merge confirmation flow
- bypass of the optional API-key authentication, host or origin checks, or session limits

## Threat Model

Assets: the Bitbucket API token, access to the approved repositories, and the ability to run write operations (comments, pull request creation, pipeline runs, merges).

The main risk considered is an MCP client, including an LLM agent, performing actions beyond what the operator intended. The current mitigations are:

- `BITBUCKET_API_TOKEN` and `MCP_BB_INTERNAL_API_KEY` are rejected if they are loaded from `.env`; they must be provided through the process environment
- the Bitbucket client only operates on repositories listed in the registry
- write tools can be restricted with `MCP_BB_ENABLED_WRITE_TOOLS`
- `merge_pull_request` is only listed when a repository sets `allowMerge: true`, and always requires a summary step followed by a single-use confirmation token bound to repository, pull request and merge parameters
- optional API-key authentication protects `/health` and `/mcp`
- the server binds to `127.0.0.1` by default and validates allowed hosts and origins
- sessions are bounded by TTL and capacity, and read retries only apply to safe GET requests

## Reporting a Vulnerability

Please do not open a public issue for security problems.

Use GitHub Security Advisories for this repository ("Security" tab, "Report a vulnerability"). If that is not available, open an issue that only asks for a private contact channel and contains no details of the vulnerability.

Include the affected version or commit, a description of the impact and steps to reproduce. Never include real tokens or credentials in a report. If you accidentally exposed a Bitbucket token, revoke it immediately.

This is a personal open source project maintained on a best-effort basis. No response time is guaranteed.

## Not Covered

- exposing the server directly to the public internet or to untrusted networks, or running it without API-key authentication in a shared environment
- vulnerabilities in Bitbucket Cloud, the MCP SDK or other third-party dependencies, which should be reported to their maintainers
- misconfiguration, such as granting the Bitbucket token broader permissions than needed or enabling `allowMerge` on repositories where it is not wanted
- actions an operator explicitly approved through the merge confirmation flow
- multi-tenant isolation, which is a non-goal
