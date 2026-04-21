# Functional Specification

## Document Purpose

This document defines the expected business behavior of Clinical Trial Finder from a user and feature perspective. It focuses on what the system must do, what user outcomes it must support, and what conditions govern the experience.

![Clinical Trial Finder start-to-end screen guide](assets/playbook-screen-guide.svg)

*Figure 1. Start-to-end screen guide for the user-facing application flow.*

![Functional user flow](assets/functional-user-flow.svg)

*Figure 2. End-to-end functional flow, including supporting system behaviors such as validation, pagination, and error handling.*

## Product Summary

Clinical Trial Finder is a web application that enables a public user to search ClinicalTrials.gov studies, filter result sets, inspect trial summaries, and review study site locations through both a map view and a structured location list.

## Business Objective

The product exists to reduce the effort required to move from a general condition search to a shortlist of relevant clinical studies and site locations.

## Primary Actors

| Actor | Description | Main Goal |
| --- | --- | --- |
| Public user | A patient, caregiver, or researcher using the public interface | Find relevant clinical trials and review site locations |
| Support user | A staff member demonstrating or assisting with the product | Help another person understand search outcomes and site availability |

## In-Scope Capabilities

| Capability | Description | Priority |
| --- | --- | --- |
| Search by condition | Run a trial search using a required condition or disease term | High |
| Optional filters | Narrow the search by city, state, phase, and status | High |
| Paginated result list | Show the first page of trial summaries and allow more results to load | High |
| Trial detail review | Open one trial and inspect summary, description, and locations | High |
| Site mapping | Plot available site coordinates on a map | High |
| Graceful recovery states | Show loading, empty, and error states clearly | High |

## Out-Of-Scope Capabilities

- User authentication
- Saved searches
- Trial enrollment workflows
- Administrative management
- Persistent reporting or analytics dashboards

## User Goals

1. Run a search quickly without needing training.
2. Narrow results without losing visibility into the original disease area.
3. Compare multiple studies from one result set.
4. Review location availability before opening an external registry page.

## End-To-End Functional Flow

1. The user lands on the home page.
2. The user enters a required condition.
3. The user may add optional filters.
4. The system validates that a condition exists before running a search.
5. The system retrieves and filters studies.
6. The system displays a results list with summary cards.
7. The user selects one trial.
8. The system loads the site detail view.
9. The system shows a map and a complete site list when available.

## Detailed Use Cases

### UC-01 Search For Trials

**Goal:** return a list of studies that match a condition and optional filters.

**Preconditions**

- The application is available.
- The user is on the main search page.

**Trigger**

- The user selects `Search Trials` or uses a quick condition chip.

**Main Success Flow**

1. The user enters a condition.
2. The user optionally adds city, state, phase, or status filters.
3. The user submits the search.
4. The system queries the trial data source.
5. The system returns the first page of matching studies.
6. The interface displays result cards and total match count.

**Alternative Flows**

- If the condition is empty, the system does not run the search.
- If no matches are returned, the system shows an empty state.
- If the search request fails, the system shows a retryable error state.

### UC-02 Load Additional Results

**Goal:** allow the user to continue exploring a longer match set.

**Main Success Flow**

1. The user reviews the current page of results.
2. The user selects `Load more trials`.
3. The system requests the next page using an updated offset.
4. The system appends additional trial cards to the existing list.

### UC-03 Review Trial Details And Sites

**Goal:** show deeper information for one selected study.

**Main Success Flow**

1. The user selects a trial card.
2. The system requests site detail for that trial.
3. The system loads the detail panel.
4. The system displays title, status, phases, sponsor, description, and sites.
5. The system plots mappable sites on the map.
6. The system displays all returned sites in a location list.

**Alternative Flow**

- If site detail fails to load, the system shows a site-level error message in the detail panel.

### UC-04 Inspect Sites On A Map

**Goal:** let the user understand geographic distribution quickly.

**Main Success Flow**

1. The user opens a trial with available site detail.
2. The system displays site markers using status-based colors.
3. The user hovers or selects a marker for facility detail.
4. The user may zoom or fit the map to all sites.
5. The user may select a site card to center the map on that location.

## Functional Requirements

| ID | Requirement |
| --- | --- |
| FR-01 | The system shall require a `condition` value before executing a search. |
| FR-02 | The system shall accept optional `city`, `state`, `phase`, and `status` filters. |
| FR-03 | The system shall provide quick-start condition chips for common search terms. |
| FR-04 | The system shall retrieve studies from ClinicalTrials.gov using the supplied condition. |
| FR-05 | The system shall apply local filtering by city, state, phase, and status before returning results to the UI. |
| FR-06 | The system shall present trial results in pages of 10 records. |
| FR-07 | The system shall display total matched result count in the results area. |
| FR-08 | The system shall allow the user to load additional result pages when more matches exist. |
| FR-09 | The system shall display `NCT ID`, title, status, phase, and site count in each visible result card when available. |
| FR-10 | The system shall allow a user to select one trial from the result set. |
| FR-11 | The system shall retrieve site details for the selected trial by `NCT ID`. |
| FR-12 | The system shall display trial title, status, phases, sponsor, and description when available in the detail panel. |
| FR-13 | The system shall show returned site locations in both a map and a list view. |
| FR-14 | The system shall use embedded coordinates when they exist and attempt fallback geocoding when they do not. |
| FR-15 | The system shall color map markers based on recruitment status. |
| FR-16 | The system shall display loading states during both search and site detail retrieval. |
| FR-17 | The system shall display an empty state when no matching studies are found. |
| FR-18 | The system shall display recoverable error messaging when search or site retrieval fails. |

## Validation Rules

- Search cannot proceed without a non-empty condition value.
- `limit` must be at least 1.
- `offset` must be 0 or greater.
- Empty optional filters must not block a search.
- Trial site detail must be tied to a specific `NCT ID`.

## Business Rules

- The current implementation restricts search results to studies with US locations.
- City and state filtering is based on the normalized location values returned for a study.
- Site status falls back to the study-level status when a site-specific status is missing.
- Frontend pagination is fixed to 10 records per page.
- The map is a convenience view and does not replace the full site list.

## State And UX Expectations

| State | Expected Behavior |
| --- | --- |
| Initial state | Show the full search experience with no results panel |
| Search loading | Show a visible loading indicator in the results area |
| Search success | Show result cards and result count |
| Search empty | Show a friendly no-results state with guidance |
| Search failure | Show an error message and retry option |
| Trial selected | Highlight the selected trial and open the detail panel |
| Site loading | Show a loading indicator in the detail panel |
| Site failure | Show a site-specific error state without destroying the result list |

## Data Visibility Requirements

- The user shall see a study identifier for every displayed trial.
- The user shall see a readable study title for every displayed trial.
- The user shall see the number of visible trials and the total matched count.
- The user shall see all returned sites in list form, even if some sites cannot be mapped.

## Non-Functional Expectations

- The interface should be usable on desktop and mobile layouts.
- External failures should degrade gracefully rather than crash the UI.
- The backend should expose a simple `/health` endpoint for operational checks.
- The application should keep the search interaction understandable for a first-time user.

## Acceptance Summary

The feature set should be considered functionally complete when a first-time user can:

1. Search by condition.
2. Narrow the search with optional filters.
3. Review a paginated result list.
4. Open one trial and view site detail.
5. Use both the map and the location list without confusion.
