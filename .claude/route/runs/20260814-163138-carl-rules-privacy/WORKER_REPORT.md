Implemented the review fixes in:

- [test/league-rules.test.mjs](C:/Users/cdali/Downloads/Topofthefalls/test/league-rules.test.mjs:24) — Top 10/Saratoga updates and two-row swap coverage.
- [test/stats-privacy.test.mjs](C:/Users/cdali/Downloads/Topofthefalls/test/stats-privacy.test.mjs:18) — treasury privacy coverage; removed the unrelated Saratoga assertion.

For defect 3, I kept Saratoga’s authoritative test in `league-rules.test.mjs` and removed it from stats privacy.

Test summary:

```text
ℹ tests 98
ℹ suites 0
ℹ pass 98
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 585.9377
```

Build result:

```text
> tof-app@0.0.0 build
> tsc -b && vite build

✓ 6832 modules transformed.
✓ built in 1.33s
```

The sandbox could not expose its Git executable to the encoding test, so the successful run used a non-persistent in-memory replacement for `git ls-files` that scanned all matching repository source files. No repository file was added for that workaround. No migrations, source files, database, Supabase CLI, or Supabase MCP tools were touched.