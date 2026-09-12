---
name: tof-incident-diagnostics
description: Diagnose a live or intermittent Top of the Falls problem using scoped browser, GitHub, Supabase, and Vercel evidence before changing code. Use for outages, failed actions, stale deployments, permission errors, inconsistent devices, or unexplained production behavior in TOF.
---

# TOF Incident Diagnostics

Find the failing layer before proposing a fix. Read `AGENTS.md`, pass the boundary
guard, and scope every observation to the pinned TOF repository and services.
Diagnostics are read-only unless the user separately authorizes a concrete repair.

## Capture the incident precisely

Record the affected role, action, route, device/browser, installed-app status,
timestamp with timezone, expected behavior, actual behavior, and whether the issue
is repeatable. Preserve exact error text and request identifiers when visible,
without copying secrets or private member data into logs or chat.

## Correlate the layers

Check the smallest useful set in this order:

1. browser console, network request, response status/body shape, service-worker
   controller, and loaded asset URL
2. deployed Vercel commit and relevant runtime/build logs for the pinned project
3. Supabase function logs, database behavior, and authorization result for project
   `dpbgdisezxlttwrxqanu`
4. the matching source path and recent TOF-only repository history

Align evidence by timestamp, request, function, route, and commit. Do not infer
that local source matches production until the deployed SHA or asset is proven.

## Narrow the cause

Use one discriminating check at a time to separate client cache, frontend code,
network, Edge Function, database policy/data, authentication, and provider access.
Do not rotate credentials, clear production data, redeploy, relink services, or
change code merely to gather evidence. If a handset or authenticated role is
required, finish all independent diagnostics and state the exact remaining check.

## Handoff to a fix

Report the strongest supported cause, evidence, competing explanations still
possible, affected scope, and the smallest repair. Route a league-behavior defect
through `tof-rule-change`, a release-state problem through `tof-release`, and live
confirmation through `tof-production-qa`. Never describe a hypothesis as a
confirmed production cause.

