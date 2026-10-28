---
name: arazzo-workflow-authoring
description: Use when a developer wants to write, change, review or understand an Arazzo workflow (a *.arazzo.yaml or *.arazzo.json document chaining API calls described by OpenAPI) — open the Arazzo canvas, edit the workflow through its actions so the developer sees each change, and fix the problems it reports against the spectral:arazzo rules. Not for writing the OpenAPI descriptions themselves.
---

# Authoring an Arazzo workflow with the canvas

The `arazzo` canvas shows an Arazzo document as a flow chart — inputs, steps in order, outputs —
with the values passed between steps, the retries, gotos and ends of each step, its YAML, and the
problems that keep it from passing the `spectral:arazzo` ruleset. The YAML text is what is saved:
an edit keeps the comments and the key order of the file. With autosave on (the default) each edit
is written at once; with autosave off it waits in a draft until saved. A change made to the file by
any other tool shows on the canvas.

## Open it

`open_canvas({ canvasId: "arazzo", instanceId: "arazzo-1", input: { ... } })`

| input | when |
|---|---|
| `path` | the document to open, relative to the workspace; created with one empty workflow when missing. Without it the canvas opens the first `*.arazzo.yaml` it finds. |
| `workflowId` | the workflow to show, or the id of the workflow a new document gets |
| `sources` | for a new document: the OpenAPI descriptions it calls, `[{ "name": "petstore", "url": "apis/petstore.yaml" }]`, `url` relative to the document |

## Edit through the canvas actions

Editing through the actions keeps the developer's canvas in step and refuses an edit that would
break the workflow, with a message saying why. Start with `get_workflow`: it returns the
workflows, the steps with their `slots` (the values they can send), the `problems`, the `sources`
(each API with its state), the `operations` the readable APIs offer, each named `source.operationId`,
and `save` (`dirty`, `autosave`, `savedAt`, `error`, `conflict`).

| goal | action |
|---|---|
| call an operation | `add_step { operation: "petstore.getPet", before?: "placeOrder" }` |
| reorder, remove | `move_step { stepId, to }`, `remove_step { stepId }` |
| give a step a value | `set_step_value { stepId, name, in, value }` — a fixed value or an expression such as `$inputs.status`; `clear_step_value { stepId, name, in }` stops sending it |
| take a value from the caller | `add_input { name, type }` then `link_data { from: { input }, to: { stepId, name, in } }` |
| pass a response value on | `set_step_output { stepId, name, expression: "$response.body#/id" }` then `link_data { from: { stepId, output }, to: { stepId, name, in } }` — only to a later step |
| check success | `add_success_criterion { stepId, condition: "$statusCode == 200" }` |
| retry, go to, end | `add_action { stepId, on: "failure", type: "retry", retryLimit: 3, retryAfter: 2 }`, `type: "goto", target`, `type: "end"` |
| give a result back | `add_workflow_output { name, stepId, output }` |
| APIs | `list_source_candidates` (the OpenAPI and Arazzo files of the workspace, relative to the document), `add_source { name, url }` (refused unless the file can be read), `remove_source { name }` (refused while a step calls it) |
| another workflow | `add_workflow { workflowId }`, `select_workflow` |
| saving | `save`, `undo`, `redo`, `set_autosave { on }` — the developer's autosave choice is remembered, change it only when asked |
| the text itself | `get_yaml`, `set_yaml { text }` — only for what no other action does (a description, a summary); the diagram shows the text once it parses |

`in` is `path`, `query`, `header`, `cookie` or `body` (a property of a JSON request body).

## When the developer asks from the canvas

A question asked in the canvas arrives as a message starting `About the Arazzo workflow …`, with
the step or workflow in JSON and its problems. Answer it, and when the answer is a change, make it
through the actions above so the developer watches it land on the diagram.

## Problems the canvas reports

Each problem has a `rule` of `spectral:arazzo` (`arazzo-document-schema`, `arazzo-step-validation`,
`arazzo-step-parameters-validation`, …), a `severity` (`error` or `warning`), the JSON `pointer` and
the `line` of what it is about, its `workflowId` and `stepId`, and a `message`. The problems listed
are those of the document and of the workflow shown; `otherWorkflows` counts those of the others.
Warnings ask for descriptions and summaries, a `type` on each API description, ids made of letters,
digits, `_` and `-`, and an `operationId` rather than an `operationPath`. A step calling an operation
of an API the canvas cannot read is not reported as an unknown operation: the API itself is. A
document with problems stays open and editable — fix them one by one, then `get_workflow` again
until `status` is `valid`.
