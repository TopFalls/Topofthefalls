-- An unanswered challenge is a forfeit when its response window closes.
--
-- Carl's rule: "If the challenged player declines or cannot play, the
-- challenger gets the spot." Ignored challenges previously changed only to
-- expired, so no ranking, record, cooldown, activity, or notification was
-- written. Each overdue pending challenge now uses the same established and
-- reversible forfeit path as an explicit decline.

-- ─── Expire through the forfeit workflow ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.expire_stale_challenges()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_challenge record;
  v_affected_count integer := 0;
BEGIN
  FOR v_challenge IN
    SELECT c.id
    FROM public.challenges c
    WHERE c.status = 'pending'
      AND c.expires_at <= now()
    ORDER BY c.expires_at, c.id
    FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM public.apply_challenge_decline_forfeit(v_challenge.id, NULL);
    v_affected_count := v_affected_count + 1;
  END LOOP;

  RETURN v_affected_count;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_stale_challenges() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_challenges() TO service_role;

COMMENT ON FUNCTION public.expire_stale_challenges() IS
  'Records each overdue pending challenge through the reversible decline-forfeit workflow and returns the number affected. Safe to call repeatedly.';
