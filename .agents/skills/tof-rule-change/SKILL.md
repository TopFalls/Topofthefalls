---
name: tof-rule-change
description: Implement and verify a Top of the Falls league-rule change across player UI, server actions, administrative result paths, database behavior, and regression tests. Use when changing challenge, defense, ranking, cooldown, scoring, eligibility, or match-result rules in TOF.
---

# TOF Rule Change

Translate one stated TOF rule into consistent behavior everywhere it can be
created, resolved, displayed, or overridden. Read `AGENTS.md`, pass the boundary
guard, and use only this repository and its pinned TOF services as evidence.

## Establish the rule table

Write the requested behavior as a small decision table before editing. Include
the actor, precondition, event, allowed or denied action, state transition, time
boundary, and user-facing explanation. Resolve ambiguity from current TOF code,
tests, and the user's instruction; never borrow rules from another league.

## Trace every path

Search for the affected terms and data fields through:

- player controls and disabled-state messaging
- client hooks and shared rule/config modules
- Edge Functions and database functions or policies
- administrator result-entry and correction paths
- scheduled or automatic transitions
- database types, fixtures, and regression tests

Identify the authoritative enforcement point. UI hiding alone is insufficient;
server-side paths must reject invalid actions. Avoid duplicating date or ranking
logic when an existing authoritative helper can serve all callers.

## Implement and test

Keep the change narrow. Add a focused regression test when it proves a meaningful
failure or boundary such as exact-day eligibility, challenger versus defender,
win versus loss, or administrator versus player resolution. Use a fixed clock in
time-based tests.

Run the repository-required tests and build. Verify relevant roles and both the
allowed and denied paths. If production confirmation would mutate league data,
prepare a disposable-data plan and use `tof-production-qa`; do not perform that
mutation without authorization.

## Report

Explain the rule in plain language, list the enforcement locations, show the
decision-table cases verified, and identify any path that could not be tested.
Keep implementation, deployment, and verified-live status separate.

