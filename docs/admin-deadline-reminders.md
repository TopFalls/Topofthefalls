# Admin deadline reminders

Deployment requires separate approval; this document is not proof of live status.

| Situation | Result |
| --- | --- |
| Pending challenge, response deadline within 12 hours and still in the future | One shared admin alert |
| Accepted/scheduled/in-progress challenge, play deadline within 12 hours and no submitted/completed result | One shared admin alert |
| More than 12 hours remaining, expired deadline, cancelled/closed challenge, or missing play deadline | No new alert |
| Job repeats or an admin clicks Done | No duplicate for the same deadline |
| Deadline is changed | A reminder is eligible for the new deadline |

Both admin and super-admin roles use the existing Admin > Needs your attention
panel, including accounts without a player profile. Alerts are shared: Done
acknowledges the alert for all admins. They remain until acknowledged, so their
text states the deadline rather than claiming a fixed amount of time remains.
View challenges opens the Admin Challenges tab.

This version uses in-app alerts, not email or phone push. The scheduled job runs
at the start of every hour (24 checks per day), creating the reminder on the
first successful run in the final 12 hours. Under normal operation this means
roughly 11 to 12 hours before the deadline. An open Admin screen refreshes its
alerts every minute. A late job
catches up only while the deadline is still in the future.

The stored expires_at and match_deadline values are authoritative; the reminder
does not recalculate or change the league's response/play windows. Deadline text
uses America/Denver. No player notifications, rankings or match results change.

## Release and verification

1. Verify the pinned TOF project, existing admin_alerts RLS and pg_cron access.
   Confirm Mike and Carl have admin/super-admin profiles.
2. Apply only 20260912160000_admin_deadline_reminders.sql after approval.
3. Release the frontend through an approved PR merge. No Edge Function deployment
   or secret changes are required. The old frontend can display the new alert
   headline/detail; the new frontend also supports the old table without new columns.
4. Verify the exact cron job and a successful run on the pinned database. Verify
   both admin views and denied member/guest access. Creating production fixtures
   or manually invoking the reminder function requires approval because it writes
   alerts. Do not claim live delivery based on local tests.

Rollback after approval: unschedule only tof-admin-deadline-reminders. This stops
new reminders without deleting alerts or changing deadlines. The additive columns
can remain; do not roll back other migrations.

## Local SQL regression checks

The SQL fixture is self-contained and must run only in a disposable local database.
It uses a frozen transaction clock and tests the real migration function. The
cron stub checks registration but does not simulate the pg_cron worker itself.
Run from the repository root:

```powershell
rtk proxy npm install --prefix work/deadline-test --no-save --package-lock=false @electric-sql/pglite@0.5.8
rtk proxy node test/admin-deadline-reminders.local.mjs
```

This optional harness expects @electric-sql/pglite under work/deadline-test/node_modules.
It does not connect to Supabase or use application environment variables.
