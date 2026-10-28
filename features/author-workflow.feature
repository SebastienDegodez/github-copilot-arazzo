Feature: Author an Arazzo workflow on a visual canvas
  As a developer describing how API calls chain together
  I want to build an Arazzo workflow by placing operations of my APIs on a canvas
  So that I get a valid Arazzo document without writing its YAML by hand

  Background:
    Given an OpenAPI description "petstore" offering "findPets", "getPet" and "placeOrder"

  @smoke
  Scenario: Start a new workflow document
    Given no Arazzo document exists at "workflows/adopt.arazzo.yaml"
    When the developer opens "workflows/adopt.arazzo.yaml" on the canvas
    Then a new Arazzo 1.0.1 document is saved with one empty workflow
    And the canvas lists the operations of the described APIs

  @smoke
  Scenario: Drop an operation on the canvas to add a step
    Given an open workflow "adopt-pet" without any step
    When the developer drops the operation "findPets" on the workflow
    Then the workflow has a step "findPets" calling "findPets"
    And the document on disk contains that step

  Scenario: Two drops of the same operation get distinct step ids
    Given an open workflow "adopt-pet" with a step "findPets"
    When the developer drops the operation "findPets" on the workflow again
    Then the workflow has the steps "findPets" and "findPets-2"

  Scenario: Drop an operation between two steps
    Given an open workflow "adopt-pet" with the steps "findPets" and "placeOrder"
    When the developer drops the operation "getPet" before "placeOrder"
    Then the steps run in the order "findPets", "getPet", "placeOrder"

  Scenario: Reorder steps by dragging one onto another
    Given an open workflow "adopt-pet" with the steps "findPets", "getPet" and "placeOrder"
    When the developer drags "placeOrder" to the first position
    Then the steps run in the order "placeOrder", "findPets", "getPet"

  Scenario: Pass a value from one step to a later one
    Given an open workflow "adopt-pet" with the steps "findPets" and "getPet"
    And "findPets" exposes the output "petId" from "$response.body#/0/id"
    When the developer drags the output "petId" of "findPets" onto the path parameter "petId" of "getPet"
    Then "getPet" sends "$steps.findPets.outputs.petId" as its path parameter "petId"
    And the diagram shows a data edge from "findPets" to "getPet" labelled "outputs.petId"

  Scenario: Pass a workflow input to a step
    Given an open workflow "adopt-pet" with the step "findPets" and the input "status"
    When the developer drags the input "status" onto the query parameter "status" of "findPets"
    Then "findPets" sends "$inputs.status" as its query parameter "status"

  Scenario: Refuse to pass a value backwards
    Given an open workflow "adopt-pet" with the steps "findPets" and "getPet"
    And "getPet" exposes the output "name"
    When the developer drags the output "name" of "getPet" onto a parameter of "findPets"
    Then the canvas refuses because "getPet" runs after "findPets"

  Scenario: Retry a step and end on failure
    Given an open workflow "adopt-pet" with the step "placeOrder"
    When the developer adds to "placeOrder" a retry of 3 attempts after 2 seconds on failure
    Then the diagram shows a retry loop on "placeOrder" labelled "retry ×3 · 2 s"

  Scenario: Remove a step
    Given an open workflow "adopt-pet" with the steps "findPets" and "getPet"
    When the developer removes "findPets"
    Then the workflow only has the step "getPet"
