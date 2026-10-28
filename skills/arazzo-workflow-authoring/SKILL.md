---
name: arazzo-workflow-authoring
description: Use when a developer wants to write, change, review or understand an Arazzo workflow (a *.arazzo.yaml or *.arazzo.json document chaining API calls described by OpenAPI) — open the Arazzo canvas, edit the workflow through its actions so the developer sees each change, and fix the problems it reports. Not for writing the OpenAPI descriptions themselves.
---

# Authoring an Arazzo workflow with the canvas

The `arazzo` canvas shows an Arazzo document as a flow chart — inputs, steps in order, outputs —
with the values passed between steps, the retries, gotos and ends of each step, and the problems
that keep the document from being valid Arazzo 1.0.x. Every edit is saved to the document file at
once; a change made to the file by any other tool shows on the canvas.

## Open it

`open_canvas({ canvasId: "arazzo", instanceId: "arazzo-1", input: { ... } })`

| input | when |
|---|---|
| `path` | the document to open, relative to the workspace; created with one empty workflow when missing. Without it the canvas opens the first `*.arazzo.yaml` it finds. |
| `workflowId` | the workflow to show, or the id of the workflow a new document gets |
| `sources` | for a new document: the OpenAPI descriptions it calls, `[{ "name": "petstore", "url": "apis/petstore.yaml" }]`, `url` relative to the document |

## Edit through the canvas actions, never the YAML

Editing through the actions keeps the developer's canvas in step and refuses an edit that would
break the workflow, with a message saying why. Start with `get_workflow`: it returns the
workflows, the steps with their `slots` (parameters they can receive), the `problems`, and the
`operations` the described APIs offer, each named `source.operationId`.

| goal | action |
|---|---|
| call an operation | `add_step { operation: "petstore.getPet", before?: "placeOrder" }` |
| reorder, remove | `move_step { stepId, to }`, `remove_step { stepId }` |
| take a value from the caller | `add_input { name, type }` then `link_data { from: { input }, to: { stepId, name, in } }` |
| pass a response value on | `set_step_output { stepId, name, expression: "$response.body#/id" }` then `link_data { from: { stepId, output }, to: { stepId, name, in } }` — only to a later step |
| check success | `add_success_criterion { stepId, condition: "$statusCode == 200" }` |
| retry, go to, end | `add_action { stepId, on: "failure", type: "retry", retryLimit: 3, retryAfter: 2 }`, `type: "goto", target`, `type: "end"` |
| give a result back | `add_workflow_output { name, stepId, output }` |
| another API, another workflow | `add_source { name, url }`, `add_workflow { workflowId }`, `select_workflow` |

`in` is `path`, `query`, `header`, `cookie` or `body` (a property of a JSON request body).

## When the developer asks from the canvas

A question asked in the canvas arrives as a message starting `About the Arazzo workflow …`, with
the step or workflow in JSON and its problems. Answer it, and when the answer is a change, make it
through the actions above so the developer watches it land on the diagram.

## Problems the canvas reports

Each names the workflow and step it is about: an operation no described API offers, an input not
declared, an output no earlier step exposes, a goto to a missing step, duplicated ids, a missing
title, version or API description. A document with problems stays open and editable — fix them
one by one, then `get_workflow` again until `problems` is empty.
