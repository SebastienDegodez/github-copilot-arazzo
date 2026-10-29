# AGENTS.md

Guidance for AI coding agents working on the Arazzo canvas plugin for GitHub Copilot.
See [CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow.

## Commands

```sh
npm ci
npm test                  # acceptance + integration + architecture (node --test)
npm run test:coverage     # 100 % lines, ≥ 95 % branches/functions
npm run test:e2e          # Playwright (npx playwright install chromium first)
npm run mutation:core     # Stryker, domain & application, must stay at 100
npm run mutation:boundary # Stryker, infrastructure & presentation, ≥ 80
```

## Architecture rules (enforced by `tests/architecture`)

- `src/arazzo-domain` imports only itself; `src/arazzo-application` only the domain.
- Infrastructure and presentation never import each other.
- Only `com.github.copilot/extensions/arazzo-canvas/extension.mjs` imports the Copilot SDK.
- No runtime dependency: the plugin ships as-is (YAML is vendored).
- Never write to stdout from extension code (it carries JSON-RPC); log to stderr.

## Conventions

- Scenario first: add a Gherkin scenario in `features/`, then a failing test, then the code.
- No mutation suppression comments; kill the mutant with a test or simplify.
- Conventional Commits for commits and PR titles (`feat:`, `fix:`, `docs:`…); squash-merged.
- Do not edit `CHANGELOG.md` or the versions in `plugin.json`/`package.json`: semantic-release does.
- Do not commit the exported MP4 (`docs/media/*.mp4` is git-ignored).
