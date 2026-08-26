-- Two holes the open-player rule turned from harmless into consequential.
--
-- 1. A washed challenge left its match row alive forever.
--
--    respond-to-challenge creates the matches row the moment a challenge is
--    accepted. admin_resolve_wash then sets challenges.status='washed' and
--    never touches that row, and nothing anywhere sweeps a 'scheduled' match.
--    Before the open-player rule that was untidy but inert. Now
--    engaged_player_ids() reads exactly those statuses, so both players of a
--    washed challenge would count as "tied up" permanently: they could never
--    be the open player anyone was obliged to take, and challenging one of
--    them would wrongly cost the challenger their protection.
--
--    A wash means the match was never played, so the row is cancelled. That
--    status is new — 'resolved' would have been wrong, because MatchesPage
--    lists resolved matches as history and this one has a 0-0 score and no
--    winner.
--
-- 2. engaged_player_ids() did not count 'confirming'.
--
--    submit-result moves a match to 'confirming' to claim it while it works
--    out the result. It is short-lived, but a player in it is plainly tied up,
--    and a throw mid-confirmation leaves a match parked there.

-- ─── A cancelled match is a real state now ──────────────────────────────────

ALTER TABLE public.matches DROP CONSTRAINT IF EXISTS matches_status_check;
ALTER TABLE public.matches ADD CONSTRAINT matches_status_check CHECK (status = ANY (ARRAY[
  'scheduled'::text,
  'in_progress'::text,
  'submitted'::text,
  'confirming'::text,
  'confirmed'::text,
  'disputed'::text,
  'resolved'::text,
  'cancelled'::text
]));

-- ─── Washing a challenge closes its match ───────────────────────────────────
-- Only the body changes; the signature, the admin gate, the cooldown and the
-- alert all stay exactly as 20260814123000 left them.

CREATE OR REPLACE FUNCTION public.admin_resolve_wash(p_challenge_id uuid, p_is_wash boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_c public.challenges%ROWTYPE; v_hours integer; v_cn text; v_dn text;
BEGIN
  IF NOT public.is_league_admin() THEN RAISE EXCEPTION 'admin_resolve_wash: admin role required'; END IF;

  SELECT * INTO v_c FROM public.challenges WHERE id = p_challenge_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Challenge not found'; END IF;

  SELECT full_name INTO v_cn FROM public.players WHERE id = v_c.challenger_id;
  SELECT full_name INTO v_dn FROM public.players WHERE id = v_c.challenged_id;

  UPDATE public.admin_alerts SET acknowledged_at = now(), acknowledged_by = auth.uid()
  WHERE alert_type = 'wash_requested' AND acknowledged_at IS NULL
    AND player_id IN (v_c.challenger_id, v_c.challenged_id);

  IF NOT p_is_wash THEN
    UPDATE public.challenges
    SET wash_requested_by = NULL, wash_requested_at = NULL, wash_reason = NULL, updated_at = now()
    WHERE id = p_challenge_id;
    RETURN jsonb_build_object('washed', false, 'message', 'Challenge stands.');
  END IF;

  SELECT cooldown_hours INTO v_hours FROM public.league_settings LIMIT 1;
  v_hours := COALESCE(v_hours, 24);

  UPDATE public.challenges SET status = 'washed', updated_at = now() WHERE id = p_challenge_id;

  -- The match was never played. Leaving it 'scheduled' keeps both players
  -- looking engaged for good.
  UPDATE public.matches
  SET status = 'cancelled', updated_at = now()
  WHERE challenge_id = p_challenge_id
    AND status IN ('scheduled', 'in_progress');

  IF v_hours > 0 THEN
    INSERT INTO public.cooldowns (player_id, type, expires_at)
    VALUES (v_c.challenger_id, 'wash', now() + make_interval(hours => v_hours));

    INSERT INTO public.admin_alerts (alert_type, headline, detail, player_id)
    VALUES (
      'wash_penalty',
      COALESCE(v_cn, 'The challenger') || ' has a wash cooldown.',
      'The default is ' || v_hours || ' hours. Clear it or shorten it here if the circumstances warrant an exception.',
      v_c.challenger_id
    );
  END IF;

  INSERT INTO public.activity_feed (event_type, headline, detail, actor_player_id)
  VALUES ('challenge_washed',
    COALESCE(v_cn,'Challenger') || ' vs ' || COALESCE(v_dn,'opponent') || ' was called a wash.',
    'No ranking change. ' || COALESCE(v_cn,'The challenger') || ' sits ' || v_hours ||
    ' hours; ' || COALESCE(v_dn,'the challenged player') || ' may challenge up straight away.',
    v_c.challenger_id);

  INSERT INTO public.notifications (player_id, type, title, body, reference_id, reference_type)
  VALUES
    (v_c.challenger_id, 'challenge_washed', 'Match called a wash',
     'You could not agree a time with ' || COALESCE(v_dn,'your opponent') ||
     '. No ranking change; you can challenge again in ' || v_hours || ' hours.',
     p_challenge_id, 'challenge'),
    (v_c.challenged_id, 'challenge_washed', 'Match called a wash',
     'You could not agree a time with ' || COALESCE(v_cn,'the challenger') ||
     '. No ranking change; you may challenge up straight away.',
     p_challenge_id, 'challenge');

  INSERT INTO public.audit_events (actor_profile_id, action, target_type, target_id, detail)
  VALUES (auth.uid(), 'challenge.washed', 'challenge', p_challenge_id,
    jsonb_build_object('challenger_id', v_c.challenger_id, 'challenged_id', v_c.challenged_id,
                       'challenger_cooldown_hours', v_hours));

  RETURN jsonb_build_object('washed', true, 'challenger_sits_hours', v_hours);
END; $$;

REVOKE ALL ON FUNCTION public.admin_resolve_wash(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_resolve_wash(uuid, boolean) TO authenticated, service_role;

-- ─── Mid-confirmation counts as tied up ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.engaged_player_ids()
RETURNS TABLE (player_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.challenger_id FROM public.challenges c
   WHERE c.status IN ('pending', 'accepted', 'scheduled', 'in_progress')
  UNION
  SELECT c.challenged_id FROM public.challenges c
   WHERE c.status IN ('pending', 'accepted', 'scheduled', 'in_progress')
  UNION
  SELECT m.player1_id FROM public.matches m
   WHERE m.status IN ('scheduled', 'in_progress', 'submitted', 'confirming', 'disputed')
  UNION
  SELECT m.player2_id FROM public.matches m
   WHERE m.status IN ('scheduled', 'in_progress', 'submitted', 'confirming', 'disputed');
$$;

REVOKE ALL ON FUNCTION public.engaged_player_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.engaged_player_ids() TO authenticated, service_role;

-- Clean up any match already stranded by a wash that happened before this.
UPDATE public.matches m
SET status = 'cancelled', updated_at = now()
FROM public.challenges c
WHERE c.id = m.challenge_id
  AND c.status = 'washed'
  AND m.status IN ('scheduled', 'in_progress');
