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

## Architecture

Clean Architecture, enforced by a test on the import graph:

```
com.github.copilot/extensions/arazzo-canvas/extension.mjs   ← only file importing the Copilot SDK
src/composition.mjs                                         ← composition root
src/presentation/      canvas declaration, actions, loopback server (token + SSE), panel UI
src/infrastructure/    workspace files, HTTP sources, preferences, comment-preserving YAML codec
src/arazzo-application/studio.mjs                           ← use cases behind ports
src/arazzo-domain/     edits, spectral:arazzo rules, schema, catalog, history, layout — pure
```

YAML is handled by a vendored copy of [`yaml`](https://eemeli.org/yaml/) (ISC). The panel is served
on `127.0.0.1` only, and every mutating call carries a per-process token.

## Quality

Developed with the [SKRAFT](https://github.com/SebastienDegodez/skraft-plugin) engineering
practices: Gherkin scenarios first (`features/`), outside-in TDD, and blocking quality gates.

| Gate | Tool | Bar |
|---|---|---|
| Acceptance, integration, architecture | `node --test` | all green |
| Browser behaviour and `@visual` scenarios | Playwright | all green |
| Line coverage | Node test coverage | 100 % lines, ≥ 95 % branches and functions |
| Mutation — domain & application | StrykerJS | 100 % |
| Mutation — infrastructure & presentation | StrykerJS | ≥ 80 % |

```sh
npm ci
npm test                    # acceptance + integration + architecture
npm run test:coverage       # with coverage thresholds, writes coverage/lcov.info
npm run test:e2e            # Playwright (npx playwright install chromium first)
npm run mutation:core       # Stryker, breaks under 100
npm run mutation:boundary   # Stryker, breaks under 80
```

Every gate runs in [CI](.github/workflows/ci.yml) on each pull request. Mutation testing only
mutates the source files a pull request changes, and is skipped when it changes none (tests or docs
only); a change of the Stryker configs or package manifests mutates the whole scope, and a
[weekly run](.github/workflows/mutation-full.yml) mutates everything.

## Demo video

The video is a page, not a recording: `video/scenario.mjs` plays the story on the plugin's studio
with in-memory ports, and `video/app.jsx` renders every frame as a function of time, with the
canvas styled by `src/presentation/ui/styles.css`. Change the canvas and the video follows. Its
colours and type are those of [sebastiendegodez.github.io](https://sebastiendegodez.github.io).
The GIF loop, poster, soundtrack and subtitles are in `docs/media/`; the exported MP4 is git-ignored (it is published on YouTube).

The soundtrack is made from code too (`video/audio.mjs`): an original music bed and the sound
effects are synthesized, the English narration is spoken by a macOS voice, and ffmpeg mixes them
at −16 LUFS, the music ducked under the voice. The subtitles (English and French, SubRip) are timed
on the spoken voice. `video/timeline.mjs` times picture, sound and subtitles alike.

```sh
npm run video               # serves it: open the printed URL; space plays, m toggles the sound, ← → jump chapters, ?t=12 starts at 12 s
npx playwright install chromium   # once, for the export
npm run video:export        # docs/media/arazzo-canvas.mp4, git-ignored (1920×1080, 30 fps, AAC), .m4a, .gif, .png and .en/.fr.srt subtitles
npm run video:export -- --from 12 --to 22   # a part only: arazzo-canvas-12-22.mp4
npm run video:audio         # the soundtrack and subtitles only: arazzo-canvas.m4a, .en.srt, .fr.srt
```

The narration needs macOS and the voice *Ava (Enhanced or Premium)*: System Settings >
Accessibility > Read & Speak > System voice ⓘ > English (US) > Ava. Pick another with
`--voice "Zoe"`, or leave it out with `--no-voice` (music and effects only) or `--no-audio`.
The export seeks the page frame by frame (`window.__video.seek(t)`), screenshots it with Playwright
and encodes with ffmpeg (`ffmpeg-static`), so the result does not depend on the machine's speed.

## Repository rules

`main` is protected by a ruleset: changes land through a squash-merged pull request whose
CI checks pass (tests, coverage, browser tests, mutation, Conventional Commit title), with CodeQL
code scanning. The coverage job enforces 100 % line coverage and at least 95 % branch and function
coverage. Code owners review every change. Only the release job pushes to `main` directly, with a
dedicated deploy key.

## Releases

Versions are cut automatically by [semantic-release](https://github.com/semantic-release/semantic-release)
from [Conventional Commits](https://www.conventionalcommits.org/) on `main`: `feat` → minor,
`fix`/`perf`/`refactor` → patch, `BREAKING CHANGE` → major. The version is written to `plugin.json`
and `package.json`, and the [changelog](CHANGELOG.md) and GitHub release notes are generated.
