---
name: tof-production-qa
description: Plan and perform safe production verification for the Top of the Falls website using the pinned live domains and cloud projects. Use for post-deployment checks, role-based QA, mobile or installed-app testing, and tests that may touch live league data.
---

# TOF Production QA

Prove the released TOF behavior on the allowlisted production site while
protecting real league data. Read `AGENTS.md`, pass its boundary guard, and verify
the deployed project identity before treating a browser result as TOF evidence.

## Choose the least invasive proof

Start with read-only checks: HTTP behavior, deployed commit identity, signed-out
pages, static assets, navigation, and provider logs scoped to the pinned project.
For authenticated behavior, identify the role required and the exact records a
test could change.

Do not create challenges, submit scores, move standings, alter treasury values,
send notifications, or change member state in production without explicit
authorization for that test. When mutation is necessary, propose disposable
accounts or records, expected before/after state, and teardown steps first.

## Build a test matrix

Cover only surfaces affected by the release. Record:

- canonical URL, route, build or commit, date, and device/browser
- signed-out, member, and administrator role when relevant
- expected visible behavior and expected denied behavior
- database or function evidence needed beyond the UI
- cleanup owner and completion status for any mutation

Treat desktop browser, mobile browser, and installed PWA as separate surfaces when
caching, service workers, notifications, or installation behavior is involved.

## Execute and preserve evidence

Use browser tooling for visible behavior and scoped provider tooling for backend
evidence. A `200` response does not prove correct authorization or returned data.
Capture concise evidence without exposing tokens, personal information, or secret
values. Stop if a page, deployment, or API points outside the TOF allowlist.

## Result

Report pass, fail, or blocked for each case; distinguish observed behavior from
inference. Include remaining device or role coverage and confirm teardown of every
temporary production record. A deployment is verified live only after the changed
user behavior and required backend state both match.

