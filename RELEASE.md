# Release Process

This repo uses semantic versioning with tags in the form `vX.Y.Z`.

## Scope

- `PATCH`: fixes, docs corrections, packaging-only changes, low-risk hardening.
- `MINOR`: new MCP read/write capabilities that keep backward compatibility.
- `MAJOR`: breaking contract changes to exposed tools, runtime auth expectations, or transport behavior.

## Pre-release Checklist

1. Update [CHANGELOG.md](/C:/Users/Gianmarco/Urgewalt/Yetzirah/llm-bitbucket-mcp/CHANGELOG.md):
   move relevant entries from `Unreleased` into the new version section.
2. Run the full quality gate:

```bash
npm run check
docker build --build-arg APP_VERSION=<next-version> -t llm-bitbucket-mcp:<next-version> .
```

3. Ensure runtime secrets are not in repo files:
   `BITBUCKET_API_TOKEN` and `MCP_BB_INTERNAL_API_KEY` must be injected only at runtime
   via the PowerShell launcher or the local dashboard in [mcp-dashboard](/C:/Users/Gianmarco/Urgewalt/Yetzirah/mcp-dashboard).

## Version Bump

Use one of:

```bash
npm version patch
npm version minor
npm version major
```

That updates `package.json`, creates a version commit, and creates the matching git tag.

## Publish

1. Push the release commit and tag:

```bash
git push origin main
git push origin --tags
```

2. The GitHub release workflow runs on `v*.*.*` tags and:
    - executes `npm run check`
    - builds the Docker image
    - creates the GitHub release with generated notes

## Post-release

- Add new upcoming changes back under `Unreleased` in [CHANGELOG.md](/C:/Users/Gianmarco/Urgewalt/Yetzirah/llm-bitbucket-mcp/CHANGELOG.md).
- Keep release PRs small and prefer one release tag per merged milestone slice.
