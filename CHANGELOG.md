# Changelog

All notable changes to this project will be documented in this file.

The format is inspired by Keep a Changelog.
Versioning follows Semantic Versioning (`MAJOR.MINOR.PATCH`).

## [Unreleased]

### Added

- Bounded retry/backoff for transient Bitbucket GET failures.
- Lightweight `/metrics` runtime counters for local/internal troubleshooting.
- Controlled sandbox integration tests for reliability behavior.
- Minimal Docker packaging for local/internal distribution.
- Tag-based GitHub release workflow with automated quality checks.
- Explicit release process documentation for version bumps and changelog updates.

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
