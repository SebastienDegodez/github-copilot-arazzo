Feature: See what is wrong with a workflow while authoring it
  As a developer
  I want the canvas to tell me what makes my Arazzo document invalid
  So that I fix it before a tool such as Microcks refuses it

  Scenario: A step calls an operation no API describes
    Given an open workflow "adopt-pet" with a step calling "deletePet"
    When the developer looks at the workflow
    Then the canvas reports that "deletePet" is not an operation of "petstore"

  Scenario: A step uses an input the workflow does not declare
    Given a step "findPets" sending "$inputs.status"
    And the workflow declares no input "status"
    When the developer looks at the workflow
    Then the canvas reports that the input "status" is not declared

  Scenario: A step uses an output no step exposes
    Given a step "getPet" sending "$steps.findPets.outputs.petId"
    And "findPets" exposes no output "petId"
    When the developer looks at the workflow
    Then the canvas reports that "findPets" has no output "petId"

  Scenario: A document opened with mistakes stays editable
    Given an Arazzo document whose workflow has two steps "getPet"
    When the developer opens it on the canvas
    Then the canvas reports the duplicated step id
    And the diagram still shows both steps
