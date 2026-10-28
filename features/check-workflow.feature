Feature: See what is wrong with a workflow while authoring it
  As a developer
  I want the canvas to check my document with the rules of the spectral:arazzo ruleset
  So that a linter or a tool such as Microcks accepts the document the canvas wrote

  Background:
    Given the Arazzo document "adopt.arazzo.yaml" open on the canvas on the workflow "adopt-pet"

  @smoke
  Scenario: Each problem tells its rule, its severity, where it is and why
    Given the step "getPet" sends "$inputs.status" and the workflow declares no input "status"
    When the developer looks at the problems
    Then the canvas reports an error of the rule "arazzo-step-parameters-validation"
    And it is located at "#/workflows/0/steps/1/parameters/0/value", line 25
    And the step "getPet" is marked with that error on the diagram

  @smoke
  Scenario: The problems of another workflow are not mixed with those of the workflow shown
    Given the document also has the workflow "test" without any step
    When the developer looks at the problems of "adopt-pet"
    Then the problems list holds no problem of "test"
    And the canvas tells that the workflow "test" has 1 problem, and lets the developer go to it

  Scenario: The problems of the document are shown on every workflow
    Given the document has no info.version
    When the developer looks at the problems of any workflow
    Then the problems list holds "the document needs info.version"

  Scenario: The status tells errors and warnings apart
    Given the document has 1 error and 3 warnings
    Then the status shows "1 error · 3 warnings"

  Scenario Outline: The canvas applies the rules of spectral:arazzo
    Given a document where <mistake>
    When the developer looks at the problems
    Then the canvas reports a <severity> of the rule "<rule>"

    Examples: errors
      | mistake                                                              | severity | rule                                     |
      | the arazzo field is missing                                          | error    | arazzo-document-schema                   |
      | a step holds an unknown field "operatonId"                           | error    | arazzo-document-schema                   |
      | two workflows are named "adopt-pet"                                  | error    | arazzo-workflowId-unique                 |
      | two steps of "adopt-pet" are named "getPet"                          | error    | arazzo-workflow-stepId-unique            |
      | a workflow output is "$foo"                                          | error    | arazzo-workflow-output-validation        |
      | a workflow output reads an output no step exposes                    | error    | arazzo-workflow-output-validation        |
      | a step output is "$foo"                                              | error    | arazzo-step-output-validation            |
      | a step sends twice the query parameter "status"                      | error    | arazzo-step-parameters-validation        |
      | a step parameter is "$foo"                                           | error    | arazzo-step-parameters-validation        |
      | a step parameter reads an output of a step that runs after it        | error    | arazzo-step-parameters-validation        |
      | a step parameter refers to "$components.parameters.missing"          | error    | arazzo-step-parameters-validation        |
      | two success actions of a step are both named "done"                  | error    | arazzo-step-success-actions-validation   |
      | a success action names both a stepId and a workflowId                | error    | arazzo-step-success-actions-validation   |
      | a failure action goes to the step "gone" the workflow does not have  | error    | arazzo-step-failure-actions-validation   |
      | a workflow depends on the workflow "gone"                            | error    | arazzo-workflow-depends-on-validation    |
      | a success criterion has a type but no context                        | error    | arazzo-step-success-criteria-validation  |
      | a regex success criterion has the condition "^(200"                  | error    | arazzo-step-success-criteria-validation  |
      | a success criterion has the context "hello"                          | error    | arazzo-step-success-criteria-validation  |
      | a step calls both an operationId and a workflowId                    | error    | arazzo-step-validation                   |
      | a step calls "deletePet", which no described API offers              | error    | arazzo-step-validation                   |
      | a request body has the content type "json"                           | error    | arazzo-step-request-body-validation      |
      | the title holds a "<script>" tag                                     | error    | arazzo-no-script-tags-in-markdown        |

    Examples: warnings
      | mistake                                                              | severity | rule                                     |
      | the document has no info.description                                 | warning  | arazzo-info-description                  |
      | an API description has no type                                       | warning  | arazzo-source-descriptions-type          |
      | a workflow is named "adopt pet"                                      | warning  | arazzo-workflow-workflowId               |
      | a workflow has no description                                        | warning  | arazzo-workflow-description              |
      | a workflow has no summary                                            | warning  | arazzo-workflow-summary                  |
      | a step is named "get pet"                                            | warning  | arazzo-step-stepId                       |
      | a step has no description                                            | warning  | arazzo-step-description                  |
      | a step calls an operationPath                                        | warning  | arazzo-step-operationPath                |

  Scenario: A document opened with mistakes stays editable
    Given a document whose workflow has two steps "getPet"
    When the developer opens it on the canvas
    Then the canvas reports the duplicated step id
    And the diagram still shows both steps
