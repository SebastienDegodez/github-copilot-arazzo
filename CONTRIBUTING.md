# Contributing

Thanks for helping improve the Arazzo canvas.

## Workflow

1. Open an issue describing the behaviour you want, ideally as a Gherkin scenario.
2. Add or update the scenario in `features/` — scenarios come before code.
3. Write the failing test first (outside-in):
   - acceptance tests enter through `createStudio` with the in-memory ports of `tests/support/`;
   - adapters are tested on real files or a real loopback server in `tests/integration/`;
   - anything visual or about drag and drop is measured in a browser in `tests/e2e/`.
4. Make it pass, then refactor.
5. Run the gates locally:

   ```sh
   npm test && npm run test:coverage && npm run test:e2e
   npm run mutation:core && npm run mutation:boundary
   ```

   To mutate only what you changed, as CI does:

   ```sh
   npx stryker run stryker.core.config.json --mutate "$(node scripts/mutation-scope.mjs stryker.core.config.json origin/main | node -pe 'JSON.parse(require("fs").readFileSync(0)).files.join(",")')"
   ```

## Rules

- `src/arazzo-domain` imports only itself; `src/arazzo-application` only the domain;
  infrastructure and presentation never import each other; only `extension.mjs` imports the
  Copilot SDK. `tests/architecture` enforces it.
- No runtime dependency: the plugin ships as-is.
- Never write to stdout from extension code — it carries JSON-RPC. Log to stderr.
- No mutation suppression comments: kill a surviving mutant with a test or by simplifying the code.

## Commits and pull requests

Commits and pull request titles follow [Conventional Commits](https://www.conventionalcommits.org/)
(`feat:`, `fix:`, `docs:`, `test:`, `ci:`, `chore:`…). Pull requests are squash-merged — the only
merge method `main` accepts — so the title becomes the release note: `feat` cuts a minor release,
`fix` a patch. A Pull request merges once every CI check passes, CodeQL raises no blocking alert, the coverage gate
passes (100 % lines and at least 95 % branches and functions), and a code owner approves.
