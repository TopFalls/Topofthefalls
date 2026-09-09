-- Give "Force Cancel" something that actually cancels.
--
-- The admin Challenges tab cancelled a challenge by updating the row straight
-- from the browser. `challenges` has RLS on and exactly one policy -- SELECT,
-- "Anyone can view challenges" -- so there is no UPDATE policy for the row to
-- match. `authenticated` still holds the table-level UPDATE grant, so Postgres
-- raises nothing: zero rows qualify, the statement succeeds, and PostgREST
-- returns success with a null error. The screen closed its confirm box and
-- refetched a list that had not changed. Carl reported it as "the force cancel
-- for challenges does not seem to be working"; it had never worked once.
--
-- The fix is the shape that already works elsewhere in this schema:
-- admin_resolve_wash is SECURITY DEFINER, checks is_league_admin() itself, and
-- writes the audit trail alongside the state change. This does the same.

CREATE OR REPLACE FUNCTION public.admin_cancel_challenge(
  p_challenge_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_c            public.challenges%ROWTYPE;
  v_cn           text;
  v_dn           text;
  v_match_id     uuid;
  v_match_status text;
  v_reason       text;
BEGIN
  IF NOT public.is_league_admin() THEN
    RAISE EXCEPTION 'admin_cancel_challenge: admin role required';
  END IF;

  SELECT * INTO v_c FROM public.challenges WHERE id = p_challenge_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Challenge not found';
  END IF;

  -- Already over, one way or another. Say so plainly instead of pretending.
  IF v_c.status IN ('cancelled', 'expired', 'washed', 'confirmed',
                    'resolved', 'declined', 'forfeited') THEN
    RAISE EXCEPTION 'That challenge is already % and cannot be cancelled.', v_c.status;
  END IF;

  SELECT id, status INTO v_match_id, v_match_status
  FROM public.matches
  WHERE challenge_id = p_challenge_id
  ORDER BY created_at DESC
  LIMIT 1;

  -- A finished match has already moved the ladder and the win/loss records, and
  -- nothing in this app reopens one -- resolve-dispute only accepts 'disputed',
  -- and force-complete only 'scheduled', 'in_progress' or 'submitted'. So say
  -- what is true rather than pointing at a button that does not exist.
  IF v_match_status IS NOT NULL AND v_match_status IN ('confirmed', 'resolved') THEN
    RAISE EXCEPTION 'That match already has a final result and the ladder has moved. Cancelling the challenge would not put that right.';
  END IF;

  -- Once a result has been submitted the match is money as well as standings:
  -- submit-result books the match fees into the treasury ledger on every path
  -- that reaches 'disputed', and nothing here reverses them. Send the admin to
  -- the tools that finish these properly -- the Disputes tab, or force-complete
  -- on the Matches tab -- instead of voiding a match that has already been paid
  -- for. admin_resolve_wash draws the same line: it only ever cancels a match
  -- still in 'scheduled' or 'in_progress'.
  IF v_match_status IS NOT NULL AND v_match_status IN ('submitted', 'confirming', 'disputed') THEN
    RAISE EXCEPTION 'A result has already been submitted for that match, and the match fees are on the books. Settle it on the Disputes or Matches tab instead of cancelling.';
  END IF;

  SELECT full_name INTO v_cn FROM public.players WHERE id = v_c.challenger_id;
  SELECT full_name INTO v_dn FROM public.players WHERE id = v_c.challenged_id;
  v_reason := NULLIF(btrim(COALESCE(p_reason, '')), '');

  UPDATE public.challenges
  SET status            = 'cancelled',
      wash_requested_by = NULL,
      wash_requested_at = NULL,
      wash_reason       = NULL,
      updated_at        = now()
  WHERE id = p_challenge_id;

  -- An arranged-but-unplayed match goes with it, or it hangs around as a
  -- scheduled game for a challenge that no longer exists.
  IF v_match_id IS NOT NULL THEN
    UPDATE public.matches
    SET status = 'cancelled', updated_at = now()
    WHERE id = v_match_id;
  END IF;

  -- A wash decision on a cancelled challenge is moot.
  UPDATE public.admin_alerts
  SET acknowledged_at = now(), acknowledged_by = auth.uid()
  WHERE alert_type = 'wash_requested'
    AND acknowledged_at IS NULL
    AND player_id IN (v_c.challenger_id, v_c.challenged_id);

  INSERT INTO public.activity_feed (event_type, headline, detail, actor_player_id)
  VALUES (
    'challenge_cancelled',
    COALESCE(v_cn, 'A challenger') || ' vs ' || COALESCE(v_dn, 'an opponent')
      || ' was cancelled by a league admin.',
    COALESCE(v_reason, 'No ranking change. Either player can challenge again straight away.'),
    v_c.challenger_id
  );

  INSERT INTO public.notifications (player_id, type, title, body, reference_id, reference_type)
  VALUES
    (v_c.challenger_id, 'challenge_cancelled', 'Challenge cancelled',
     'Your challenge to ' || COALESCE(v_dn, 'your opponent')
       || ' was cancelled by a league admin. No ranking change, and you can challenge again straight away.'
       || COALESCE(' Reason: ' || v_reason, ''),
     p_challenge_id, 'challenge'),
    (v_c.challenged_id, 'challenge_cancelled', 'Challenge cancelled',
     'The challenge from ' || COALESCE(v_cn, 'your challenger')
       || ' was cancelled by a league admin. No ranking change.'
       || COALESCE(' Reason: ' || v_reason, ''),
     p_challenge_id, 'challenge');

  INSERT INTO public.audit_events (actor_profile_id, action, target_type, target_id, detail)
  VALUES (
    auth.uid(), 'challenge.cancelled', 'challenge', p_challenge_id,
    jsonb_build_object(
      'challenger_id',   v_c.challenger_id,
      'challenged_id',   v_c.challenged_id,
      'previous_status', v_c.status,
      'match_id',        v_match_id,
      'reason',          v_reason
    )
  );

  RETURN jsonb_build_object(
    'cancelled',       true,
    'previous_status', v_c.status,
    'match_cancelled', v_match_id IS NOT NULL
  );
END;
$$;

COMMENT ON FUNCTION public.admin_cancel_challenge(uuid, text) IS
  'Admin-only: cancel a live challenge, void any unplayed match under it, notify both players and record the audit trail. Refuses once a result is final.';

-- The browser calls this under the admin's own session, never an edge function,
-- so service_role has no need of it. Revoked explicitly, matching
-- admin_override_wash_cooldown rather than leaving it to the blanket REVOKE.
REVOKE ALL ON FUNCTION public.admin_cancel_challenge(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_cancel_challenge(uuid, text) TO authenticated;
