Feature: Give a step the values it sends
  As a developer
  I want to set what a step sends in its path, query, header, cookie or body without dragging anything
  So that I can give a fixed value or an expression to any parameter of the operation it calls

  Background:
    Given the Arazzo document "adopt.arazzo.yaml" open on the canvas
    And the step "findPets" calling "findPets", whose operation takes the query parameter "status"

  @smoke
  Scenario: The inspector lists the parameters a step can send
    When the developer selects the step "findPets"
    Then the inspector lists the query parameter "status" of its operation, with no value yet

  @smoke
  Scenario: Give a fixed value to a parameter of the operation
    Given the developer selected the step "findPets"
    When the developer sets the query parameter "status" to "available"
    Then "findPets" sends "available" as its query parameter "status"
    And the slot "query status" of "findPets" shows it is filled

  Scenario: Give an expression to a parameter
    Given the workflow declares the input "status"
    When the developer sets the query parameter "status" of "findPets" to "$inputs.status"
    Then "findPets" sends "$inputs.status" as its query parameter "status"
    And the diagram shows a data edge from the inputs to "findPets"

  Scenario: Add a parameter the operation does not describe
    Given the developer selected the step "findPets"
    When the developer adds the header "X-Request-Id" with the value "$inputs.requestId"
    Then "findPets" sends "$inputs.requestId" as its header "X-Request-Id"

  Scenario: Add a property to the body of a request
    Given the step "placeOrder" calling "placeOrder", whose operation takes a request body
    When the developer adds the body property "quantity" with the value "1"
    Then "placeOrder" sends a JSON body whose "quantity" is "1"

  Scenario: Click an empty slot to fill it
    When the developer clicks the empty slot "query status" of "findPets"
    Then the canvas asks the value of the query parameter "status"

  Scenario: Clear a parameter
    Given "findPets" sends "available" as its query parameter "status"
    When the developer clears the query parameter "status" of "findPets"
    Then "findPets" sends no query parameter "status"
    And the slot "query status" is shown empty again

  Scenario: Refuse a parameter without a name or in an unknown place
    When the developer adds a parameter without a name to "findPets"
    Then the canvas refuses because a parameter needs a name
