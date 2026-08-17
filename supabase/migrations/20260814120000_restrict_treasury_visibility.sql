-- Treasury records become admin-only.
--
-- Carl's rule: "Treasury is a ledger/admin function." The ledger table still
-- had a USING (true) read policy and all three treasury relations were granted
-- to the anonymous API role, so browser-side navigation was the only thing
-- hiding the league's finances. The database now enforces the rule.
--
-- The insert policy is deliberately untouched. This migration changes only
-- who may read the ledger and its two reporting views.

-- ─── Ledger policy ──────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Anyone can view treasury" ON public.treasury_ledger;
DROP POLICY IF EXISTS "League admins can view treasury" ON public.treasury_ledger;

CREATE POLICY "League admins can view treasury"
  ON public.treasury_ledger
  FOR SELECT
  TO authenticated
  USING (public.is_league_admin());

REVOKE ALL ON public.treasury_ledger FROM anon;

-- ─── Reporting views ────────────────────────────────────────────────────────
-- SECURITY INVOKER makes each view honor treasury_ledger RLS as the caller,
-- rather than reading with the view owner's privileges.

ALTER VIEW public.treasury_summary SET (security_invoker = true);
ALTER VIEW public.treasury_ledger_effects SET (security_invoker = true);

REVOKE ALL ON public.treasury_summary FROM anon;
REVOKE ALL ON public.treasury_ledger_effects FROM anon;
