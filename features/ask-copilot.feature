Feature: Ask Copilot about the workflow
  As a developer
  I want to ask a question about the step I am looking at
  So that Copilot answers with the context of my workflow

  Scenario: Ask about a selected step
    Given an open workflow "adopt-pet" with the step "getPet" which has a problem
    When the developer asks "how do I pass the pet id?" about "getPet"
    Then Copilot receives the question with the document path, the step and its problems
