# Contributing

Thanks for your interest in improving `llm-bitbucket-mcp`.

## Workflow

1. Fork the repository or create a branch from `main`. Branch names follow `feature/<topic>`, `fix/<topic>` or `chore/<topic>`.
2. Make a focused change. Keep pull requests small.
3. Add or update tests for any behavior change.
4. Update `CHANGELOG.md` under `Unreleased` for user-visible changes.
5. Run `npm run check` and make sure it passes.
6. Open a pull request against `main` and fill in the template. CI runs lint, the Prettier check and the tests.

## Development Setup

Requires Node.js 22 (see `.nvmrc`).

```bash
npm install
npm run lint
npm run format:check
npm test
npm run check
```

`npm run format` applies Prettier formatting. Tests run through `node --test` and do not call the real Bitbucket API.

## Security Rules

- Never commit secrets, real `.env` files, tokens or API keys. `BITBUCKET_API_TOKEN` and `MCP_BB_INTERNAL_API_KEY` must only be provided through the process environment.
- Do not log credentials or full request headers.
- Keep Bitbucket access repository-scoped and driven by the registry.
- New write operations must be added to the write-tool allowlist logic and must not weaken the merge confirmation flow.
- Report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md).

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
