Feature: See and edit the YAML the canvas produces
  As a developer
  I want to see the Arazzo YAML next to the diagram and change it by hand
  So that I trust what the canvas writes and keep full control of the document

  Background:
    Given the Arazzo document "adopt.arazzo.yaml" open on the canvas

  @smoke
  Scenario: Show the YAML of the document
    When the developer switches to the YAML view
    Then the canvas shows the YAML of the document as it will be saved

  Scenario: Show the diagram and the YAML side by side
    When the developer switches to the split view
    Then the diagram and the YAML are both visible

  Scenario: An edit on the diagram shows in the YAML
    Given the split view
    When the developer adds the step "getPet" on the diagram
    Then the YAML holds the step "getPet"

  @smoke
  Scenario: A valid YAML edit shows on the diagram
    Given the split view
    When the developer renames the step "findPets" to "searchPets" in the YAML
    Then the diagram shows the step "searchPets"
    And the document is shown as modified

  Scenario: A YAML edit that does not parse is not applied
    Given the split view
    When the developer types YAML that does not parse
    Then the canvas shows the parse error with its line
    And the diagram keeps the last valid document
    And the document cannot be saved until the YAML parses

  Scenario: Undo a YAML edit
    Given the developer renamed the step "findPets" to "searchPets" in the YAML
    When the developer undoes
    Then the step is named "findPets" again in the diagram and in the YAML

  Scenario: Go from a problem to its line
    Given the document has a step calling "deletePet", an operation no API offers
    When the developer clicks that problem
    Then the YAML view shows the line of the operationId of that step

  Scenario: Copy the YAML
    When the developer copies the YAML
    Then the clipboard holds the YAML of the document
