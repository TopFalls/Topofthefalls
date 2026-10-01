# Live checks (read-only)

Run these only against Supabase project `dpbgdisezxlttwrxqanu`, only with the user's approval under `AGENTS.md`, and only as `SELECT`. Name the project ref explicitly on every call. Never enumerate other projects.

Why live: migration history grants `anon` everything (`20260802121000`) and a later migration revokes it (`20260817122000`). Only the database knows the final state.

**1. What `anon` can reach.** Expected: SELECT on the six guest views, nothing else.
```sql
select table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public'
order by table_name, privilege_type;
```

**2. Tables without RLS.** Expected: none holding user data.
```sql
select c.relname
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
```

**3. Open policies.** Expected: any `true` policy is a deliberate, reviewed read.
```sql
select tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and (qual = 'true' or with_check = 'true');
```

**4. Views and their options.** Expected: the six guest views have no `security_invoker`; every other view does.
```sql
select c.relname, c.reloptions
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'v'
order by c.relname;
```

**5. Definer functions callable by `anon`.** Expected: none unless intended for guests.
```sql
select p.proname
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
  and has_function_privilege('anon', p.oid, 'EXECUTE');
```

Also verify guest access from outside with the public key (the `anon` key) rather than trusting the grants alone: a signed-out request for `players` should be refused and one for `public_players` should succeed.
