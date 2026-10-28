Feature: A canvas that fits its panel
  As a developer working in the side panel of Copilot
  I want every part of the canvas to stay readable at the width of the panel
  So that I never scroll sideways to read a value

  @visual
  Scenario: Long values wrap in the inspector
    Given a step sending "$steps.findAvailablePetsByStatus.outputs.firstAvailablePetIdentifier"
    When the developer selects that step
    Then the inspector shows the whole value without a horizontal scrollbar

  @visual
  Scenario: Long messages wrap in the problems list
    Given a problem whose message is longer than the inspector
    Then the problems list shows it without a horizontal scrollbar

  @visual
  Scenario: The save status and the views stay in the header
    Given a panel 900 pixels wide
    Then the save status, the autosave switch and the view switch are visible in the header
