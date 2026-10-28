Feature: Describe the APIs a workflow calls
  As a developer
  I want to see which API descriptions my workflow uses and whether the canvas can read them
  So that I only add APIs that exist and know at once when one cannot be read

  Background:
    Given the Arazzo document "adopt.arazzo.yaml" describing the API "petstore" from "apis/petstore.yaml"

  @smoke
  Scenario: See the APIs of the document
    When the developer opens the canvas
    Then the canvas lists the API "petstore", its file "apis/petstore.yaml", its type "openapi" and its 3 operations

  @smoke
  Scenario: Add an API that can be read
    Given the file "apis/store.yaml" holds an OpenAPI description
    When the developer adds the API "store" from "apis/store.yaml"
    Then the canvas lists the API "store" with its operations
    And the document describes the API "store"

  Scenario Outline: Refuse an API that cannot be read
    When the developer adds the API "store" from "<location>"
    Then the canvas refuses because <reason>
    And the document does not describe the API "store"

    Examples:
      | location            | reason                                                     |
      | apis/missing.yaml   | no file "apis/missing.yaml" exists next to the document   |
      | apis/broken.yaml    | "apis/broken.yaml" is neither YAML nor JSON               |
      | apis/notes.yaml     | "apis/notes.yaml" is not an OpenAPI or Arazzo description |
      | apis/huge.yaml      | "apis/huge.yaml" is larger than 5 MB                       |

  Scenario: Pick the file of an API among those of the workspace
    Given the workspace holds the OpenAPI descriptions "apis/petstore.yaml" and "apis/store.yaml"
    When the developer adds an API
    Then the canvas proposes "apis/store.yaml", relative to the document

  Scenario: An API of the document that can no longer be read
    Given the file "apis/petstore.yaml" was deleted
    When the developer opens the canvas
    Then the canvas lists the API "petstore" as not found at "apis/petstore.yaml"
    And the steps calling its operations are not reported as unknown operations

  Scenario: A message about an API never shows a path outside the workspace
    Given the API "petstore" points to a file that cannot be read
    When the developer looks at its problem
    Then the message names "apis/petstore.yaml" as written in the document
    And it shows no absolute path of the machine

  Scenario: Remove an API no step calls
    Given the document also describes the API "store" that no step calls
    When the developer removes the API "store"
    Then the document no longer describes the API "store"

  Scenario: Refuse to remove an API a step calls
    When the developer removes the API "petstore"
    Then the canvas refuses because the steps "findPets", "getPet" and "placeOrder" call it
