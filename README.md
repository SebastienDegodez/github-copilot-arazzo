# github-copilot-arazzo

A GitHub Copilot plugin to author [Arazzo](https://spec.openapis.org/arazzo/latest.html) workflows
on a visual canvas, after the Arazzo workflow diagram of [Microcks](https://microcks.io).

- **See** the workflow as a flow chart: inputs, steps in order, outputs; the values each step gets
  (workflow inputs on the left, outputs of earlier steps on the right); retries, gotos and ends.
- **Drag and drop**: an operation of your OpenAPI descriptions onto the workflow adds a step (onto a
  step, before it); a step onto another moves it; an input or a step output onto a parameter passes
  the value; a step output onto *Outputs* gives it back from the workflow.
- **Know what is wrong** while you edit: unknown operations, undeclared inputs, outputs nobody
  exposes, missing steps, duplicated ids… on the step and in a list.
- **Ask Copilot** about the workflow or the selected step: the question goes to the chat with the
  step, its problems and the document path, and Copilot answers by editing the canvas.

Every change is written at once to the `*.arazzo.yaml` (or `.json`) file; edits made to the file
by any other tool show on the canvas.

## Install

```sh
copilot plugin marketplace add <path or URL of this repository>
copilot plugin install arazzo@github-copilot-arazzo
```

Then ask Copilot to *open the Arazzo canvas*, or open it with
`{ "canvasId": "arazzo", "input": { "path": "flows/adopt.arazzo.yaml" } }`.
The `arazzo-workflow-authoring` skill tells the agent how to drive it.

## Layout

| Path | Role |
|---|---|
| `plugin.json`, `.github/plugin/marketplace.json` | plugin and marketplace manifests |
| `com.github.copilot/extensions/arazzo-canvas/extension.mjs` | extension entry, the only file importing the Copilot SDK |
| `skills/arazzo-workflow-authoring/` | how the agent drives the canvas |
| `src/arazzo-domain/` | Arazzo edits, validation, OpenAPI catalog, diagram layout — pure functions |
| `src/arazzo-application/studio.mjs` | the use cases, behind the ports `documents`, `sources`, `assistant` |
| `src/infrastructure/` | workspace files (YAML via the vendored [`yaml`](https://eemeli.org/yaml/), ISC) and HTTP |
| `src/presentation/` | canvas declaration, actions, loopback server, panel UI |
| `src/composition.mjs` | composition root |
| `features/` | the Gherkin scenarios the tests implement |

The plugin has no runtime dependency; `package.json` only holds development tooling.

## Tests

Tests follow the SKRAFT mandates: acceptance tests enter through the studio use cases with
in-memory ports, adapters are tested on real files and a real loopback server, the dependency rule
is checked on the imports, and every visual scenario is measured in a real browser.

```sh
npm install
npm test                    # acceptance + integration + architecture (node --test)
npm run test:e2e            # Playwright, the @visual scenarios
npm run mutation:core       # Stryker on domain + application, break at 100
npm run mutation:boundary   # Stryker on infrastructure + presentation, break at 80
```

## License

Apache-2.0. The diagram layout is adapted from Microcks (Copyright The Microcks Authors, Apache-2.0).
