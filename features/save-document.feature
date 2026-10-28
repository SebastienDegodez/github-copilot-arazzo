Feature: Save the Arazzo document the way the developer chooses
  As a developer editing a workflow on the canvas
  I want to see whether my document is saved, save it when I decide or let it save itself, and undo
  So that I never wonder what is on disk and never lose a change

  Background:
    Given the Arazzo document "adopt.arazzo.yaml" open on the canvas

  @smoke
  Scenario: With autosave off, an edit waits for the developer to save
    Given autosave is off
    When the developer adds the step "getPet"
    Then the canvas shows the document as modified
    And the file "adopt.arazzo.yaml" is unchanged

  @smoke
  Scenario: Save the modified document
    Given autosave is off
    And the developer added the step "getPet"
    When the developer saves
    Then the file "adopt.arazzo.yaml" holds the step "getPet"
    And the canvas shows the document as saved, with the time it was saved

  Scenario: Save with the keyboard
    Given autosave is off
    And the developer added the step "getPet"
    When the developer presses Ctrl+S or Cmd+S
    Then the file "adopt.arazzo.yaml" holds the step "getPet"

  @smoke
  Scenario: With autosave on, every edit is saved at once
    Given autosave is on
    When the developer adds the step "getPet"
    Then the file "adopt.arazzo.yaml" holds the step "getPet"
    And the canvas shows the document as saved, with the time it was saved

  Scenario: Turning autosave on saves what was waiting
    Given autosave is off
    And the developer added the step "getPet"
    When the developer turns autosave on
    Then the file "adopt.arazzo.yaml" holds the step "getPet"

  Scenario: The autosave choice is remembered
    Given the developer turned autosave off
    When the developer opens the canvas again
    Then autosave is off

  Scenario: Undo and redo an edit
    Given the developer added the step "getPet" then removed the step "findPets"
    When the developer undoes once
    Then the workflow has the steps "findPets" and "getPet"
    When the developer redoes
    Then the workflow only has the step "getPet"

  Scenario: An edit after an undo drops what could be redone
    Given the developer added the step "getPet" and undid it
    When the developer adds the step "placeOrder"
    Then nothing can be redone

  Scenario: Selecting a step changes nothing in the document
    Given autosave is off and the document is saved
    When the developer selects the step "findPets"
    Then the document is still shown as saved

  Scenario: Saving keeps the comments and the order of the document
    Given "adopt.arazzo.yaml" holds a comment above the step "findPets" and its keys in a custom order
    When the developer adds the step "getPet" and saves
    Then the comment and the order of the keys are still in the file

  Scenario: The file changed by another tool while there are unsaved edits
    Given autosave is off
    And the developer added the step "getPet"
    When another tool changes "adopt.arazzo.yaml"
    Then the canvas warns that the file changed on disk
    And the developer chooses between keeping their edits and reloading the file

  Scenario: A save that fails keeps the edits
    Given the file "adopt.arazzo.yaml" cannot be written
    When the developer saves
    Then the canvas says the document could not be saved and why
    And the document is still shown as modified
