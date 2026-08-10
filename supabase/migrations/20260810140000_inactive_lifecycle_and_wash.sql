-- The inactive-player lifecycle and the wash, from Carl's rules.
--
-- "Players may go inactive at any time. If you are inactive for more than 30
--  days you will drop two spots for every 30 days of inactivity. When an
--  inactive player re-enters the list they must either defend or wait 7 days
--  before challenging up. Exception: last player on the list waits 24 hrs. All
--  inactive players will be evaluated every 30 days; if a player does not
--  engage at 90 days they will be removed at the admin's discretion."
--
-- "If both players give times but can't agree, match is a wash. Challenging
--  player will sit for 24 hrs; challenged player may challenge up immediately."
--
-- Drift is applied automatically and raises an admin alert each time, so Carl
-- can put an exception back on the Rankings tab. A wash is raised by either
-- player and decided by Carl.

-- ─── Schema ─────────────────────────────────────────────────────────────────

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS inactive_since timestamptz,
  ADD COLUMN IF NOT EXISTS inactive_drift_periods integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.players.inactive_since IS
  'When the player went inactive. Drives the two-spots-per-30-days drift and the 90-day review.';
COMMENT ON COLUMN public.players.inactive_drift_periods IS
  'How many completed 30-day periods of drift have already been applied, so a drop is never repeated.';

-- Carl has no player row, so notifications (which key off player_id) cannot
-- reach him. Admin alerts are how he is told about anything automatic.
CREATE TABLE IF NOT EXISTS public.admin_alerts (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  alert_type text NOT NULL,
  headline text NOT NULL,
  detail text,
  player_id uuid REFERENCES public.players(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid REFERENCES public.profiles(id)
);

CREATE INDEX IF NOT EXISTS admin_alerts_open_idx
  ON public.admin_alerts (created_at DESC) WHERE acknowledged_at IS NULL;

ALTER TABLE public.admin_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read alerts" ON public.admin_alerts;
CREATE POLICY "Admins read alerts" ON public.admin_alerts
  FOR SELECT TO authenticated USING (public.is_league_admin());
DROP POLICY IF EXISTS "Admins ack alerts" ON public.admin_alerts;
CREATE POLICY "Admins ack alerts" ON public.admin_alerts
  FOR UPDATE TO authenticated USING (public.is_league_admin()) WITH CHECK (public.is_league_admin());
REVOKE ALL ON TABLE public.admin_alerts FROM anon;
GRANT SELECT, UPDATE ON TABLE public.admin_alerts TO authenticated;

-- Every cooldown blocks issuing a challenge and none block accepting one.
ALTER TABLE public.cooldowns DROP CONSTRAINT IF EXISTS cooldowns_type_check;
ALTER TABLE public.cooldowns ADD CONSTRAINT cooldowns_type_check
  CHECK (type = ANY (ARRAY['post_match'::text, 'post_decline'::text, 'reentry'::text, 'wash'::text]));
COMMENT ON COLUMN public.cooldowns.type IS
  'post_match — rule 5b/5c after a result. reentry — returning from inactive. wash — rule 4, challenger sits 24 hrs. All block issuing a challenge, never accepting one.';

-- Rule c.I: "Minimum race to six no maximum if it is agreed upon." The tables
-- capped race_length at 15, so an agreed race to 17 was rejected outright. The
-- minimum lives in league_settings.min_race and is enforced by create-challenge.
ALTER TABLE public.challenges DROP CONSTRAINT IF EXISTS challenges_race_length_check;
ALTER TABLE public.challenges ADD CONSTRAINT challenges_race_length_check CHECK (race_length >= 1);
ALTER TABLE public.matches DROP CONSTRAINT IF EXISTS matches_race_length_check;
ALTER TABLE public.matches ADD CONSTRAINT matches_race_length_check CHECK (race_length >= 1);

ALTER TABLE public.challenges
  ADD COLUMN IF NOT EXISTS wash_requested_by uuid REFERENCES public.players(id),
  ADD COLUMN IF NOT EXISTS wash_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS wash_reason text;

ALTER TABLE public.challenges DROP CONSTRAINT IF EXISTS challenges_status_check;
ALTER TABLE public.challenges ADD CONSTRAINT challenges_status_check
  CHECK (status = ANY (ARRAY['pending','accepted','scheduled','in_progress','submitted',
                             'confirmed','disputed','resolved','declined','expired',
                             'forfeited','cancelled','washed']));

-- ─── Ladder movement ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.drop_player_spots(p_player_id uuid, p_spots integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pos integer; v_max integer; v_target integer;
BEGIN
  LOCK TABLE public.rankings IN SHARE ROW EXCLUSIVE MODE;
  SELECT position INTO v_pos FROM public.rankings WHERE player_id = p_player_id;
  IF v_pos IS NULL OR p_spots IS NULL OR p_spots <= 0 THEN RETURN v_pos; END IF;
  SELECT max(position) INTO v_max FROM public.rankings;
  v_target := least(v_pos + p_spots, v_max);
  IF v_target <= v_pos THEN RETURN v_pos; END IF;

  UPDATE public.rankings
  SET position = position + 10000, previous_position = position, updated_at = now()
  WHERE player_id = p_player_id;

  UPDATE public.rankings
  SET position = position - 1, previous_position = position, updated_at = now()
  WHERE position > v_pos AND position <= v_target;

  UPDATE public.rankings SET position = v_target, updated_at = now()
  WHERE player_id = p_player_id;

  RETURN v_target;
END; $$;

REVOKE ALL ON FUNCTION public.drop_player_spots(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.drop_player_spots(uuid, integer) TO service_role;
COMMENT ON FUNCTION public.drop_player_spots(uuid, integer) IS
  'Move a player down N spots, shifting passed players up one each. Clamped at the bottom. Service role only.';

-- ─── Inactivity drift and the 90-day review ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.apply_inactive_drift()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row record; v_days numeric; v_periods integer; v_due integer;
  v_from integer; v_to integer;
  v_dropped jsonb := '[]'::jsonb; v_flagged jsonb := '[]'::jsonb;
BEGIN
  FOR v_row IN
    SELECT p.id, p.full_name, p.inactive_since, p.inactive_drift_periods
    FROM public.players p
    JOIN public.rankings r ON r.player_id = p.id
    WHERE p.is_active = false AND p.inactive_since IS NOT NULL
    ORDER BY r.position
  LOOP
    v_days := EXTRACT(EPOCH FROM (now() - v_row.inactive_since)) / 86400.0;
    v_periods := floor(v_days / 30.0);
    v_due := v_periods - COALESCE(v_row.inactive_drift_periods, 0);

    IF v_due > 0 THEN
      -- Re-read: earlier moves in this loop shift the ladder underneath us.
      SELECT position INTO v_from FROM public.rankings WHERE player_id = v_row.id;
      v_to := public.drop_player_spots(v_row.id, v_due * 2);
      UPDATE public.players SET inactive_drift_periods = v_periods, updated_at = now()
      WHERE id = v_row.id;

      IF v_to IS DISTINCT FROM v_from THEN
        INSERT INTO public.admin_alerts (alert_type, headline, detail, player_id)
        VALUES ('inactive_drift',
          v_row.full_name || ' dropped ' || (v_from - v_to) * -1 || ' spots for inactivity.',
          'Inactive ' || floor(v_days) || ' days · #' || v_from || ' → #' || v_to ||
          '. If this is an exception, put them back on the Rankings tab.',
          v_row.id);
        v_dropped := v_dropped || jsonb_build_object(
          'player', v_row.full_name, 'from', v_from, 'to', v_to, 'days', floor(v_days));
      END IF;
    END IF;

    IF v_days >= 90 AND NOT EXISTS (
      SELECT 1 FROM public.admin_alerts
      WHERE player_id = v_row.id AND alert_type = 'inactive_90_day' AND acknowledged_at IS NULL
    ) THEN
      INSERT INTO public.admin_alerts (alert_type, headline, detail, player_id)
      VALUES ('inactive_90_day',
        v_row.full_name || ' has been inactive ' || floor(v_days) || ' days.',
        'Past 90 days the rules allow removal from the list at your discretion.',
        v_row.id);
      v_flagged := v_flagged || to_jsonb(v_row.full_name);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('dropped', v_dropped, 'flagged_90_day', v_flagged, 'at', now());
END; $$;

REVOKE ALL ON FUNCTION public.apply_inactive_drift() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_inactive_drift() TO service_role;
COMMENT ON FUNCTION public.apply_inactive_drift() IS
  'Two spots per completed 30 days inactive; 90 days raises a removal review. Idempotent via inactive_drift_periods. Scheduled daily by pg_cron.';

-- ─── Going inactive and coming back ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_player_active_state(p_player_id uuid, p_is_active boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_was_active boolean; v_name text; v_pos integer; v_last integer; v_hours integer;
BEGIN
  SELECT is_active, full_name INTO v_was_active, v_name FROM public.players WHERE id = p_player_id;
  IF v_name IS NULL THEN RAISE EXCEPTION 'Player % not found', p_player_id; END IF;
  IF v_was_active = p_is_active THEN
    RETURN jsonb_build_object('changed', false, 'is_active', p_is_active);
  END IF;

  IF p_is_active THEN
    SELECT position INTO v_pos FROM public.rankings WHERE player_id = p_player_id;
    SELECT max(position) INTO v_last FROM public.rankings;
    v_hours := CASE WHEN v_pos IS NOT NULL AND v_pos = v_last THEN 24 ELSE 168 END;

    UPDATE public.players
    SET is_active = true, inactive_since = NULL, inactive_drift_periods = 0, updated_at = now()
    WHERE id = p_player_id;

    DELETE FROM public.cooldowns WHERE player_id = p_player_id AND type = 'reentry';
    INSERT INTO public.cooldowns (player_id, type, expires_at)
    VALUES (p_player_id, 'reentry', now() + make_interval(hours => v_hours));

    UPDATE public.admin_alerts SET acknowledged_at = now()
    WHERE player_id = p_player_id AND alert_type = 'inactive_90_day' AND acknowledged_at IS NULL;

    RETURN jsonb_build_object('changed', true, 'is_active', true, 'reentry_wait_hours', v_hours);
  END IF;

  UPDATE public.players
  SET is_active = false, inactive_since = now(), inactive_drift_periods = 0, updated_at = now()
  WHERE id = p_player_id;
  DELETE FROM public.cooldowns WHERE player_id = p_player_id AND type = 'reentry';

  RETURN jsonb_build_object('changed', true, 'is_active', false);
END; $$;

REVOKE ALL ON FUNCTION public.set_player_active_state(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_player_active_state(uuid, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.set_own_active(p_is_active boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_player_id uuid; v_name text; v_result jsonb;
BEGIN
  SELECT id, full_name INTO v_player_id, v_name FROM public.players WHERE profile_id = auth.uid();
  IF v_player_id IS NULL THEN RAISE EXCEPTION 'set_own_active: claim a player profile first'; END IF;

  v_result := public.set_player_active_state(v_player_id, p_is_active);

  IF (v_result->>'changed')::boolean THEN
    INSERT INTO public.activity_feed (event_type, headline, detail, actor_player_id)
    VALUES (
      CASE WHEN p_is_active THEN 'player_activated' ELSE 'player_deactivated' END,
      v_name || CASE WHEN p_is_active THEN ' is back on the list.' ELSE ' went inactive.' END,
      CASE WHEN p_is_active
        THEN 'Must defend or wait ' || (v_result->>'reentry_wait_hours') || ' hours before challenging up.'
        ELSE 'Cannot be challenged while inactive. Drops two spots for every 30 days out.' END,
      v_player_id);
    INSERT INTO public.admin_alerts (alert_type, headline, detail, player_id)
    VALUES (
      CASE WHEN p_is_active THEN 'player_self_activated' ELSE 'player_self_deactivated' END,
      v_name || CASE WHEN p_is_active THEN ' set themselves active.' ELSE ' set themselves inactive.' END,
      'Changed from their own profile.', v_player_id);
  END IF;

  RETURN v_result;
END; $$;

REVOKE ALL ON FUNCTION public.set_own_active(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_own_active(boolean) TO authenticated, service_role;

-- ─── The wash ───────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.request_wash(p_challenge_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_c public.challenges%ROWTYPE; v_me uuid; v_my_name text; v_other_name text;
BEGIN
  SELECT id, full_name INTO v_me, v_my_name FROM public.players WHERE profile_id = auth.uid();
  IF v_me IS NULL THEN RAISE EXCEPTION 'request_wash: claim a player profile first'; END IF;

  SELECT * INTO v_c FROM public.challenges WHERE id = p_challenge_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Challenge not found'; END IF;
  IF v_me NOT IN (v_c.challenger_id, v_c.challenged_id) THEN
    RAISE EXCEPTION 'request_wash: you are not in this challenge';
  END IF;
  IF v_c.status NOT IN ('pending','accepted','scheduled') THEN
    RAISE EXCEPTION 'A wash can only be raised before the match is played';
  END IF;
  IF v_c.wash_requested_at IS NOT NULL THEN
    RETURN jsonb_build_object('already_requested', true);
  END IF;

  UPDATE public.challenges
  SET wash_requested_by = v_me, wash_requested_at = now(), wash_reason = p_reason, updated_at = now()
  WHERE id = p_challenge_id;

  SELECT full_name INTO v_other_name FROM public.players
  WHERE id = CASE WHEN v_me = v_c.challenger_id THEN v_c.challenged_id ELSE v_c.challenger_id END;

  INSERT INTO public.admin_alerts (alert_type, headline, detail, player_id)
  VALUES ('wash_requested',
    v_my_name || ' says they could not agree on a time with ' || COALESCE(v_other_name, 'their opponent') || '.',
    COALESCE(p_reason, 'No reason given.') || ' Decide whether this is a wash on the Challenges tab.',
    v_me);

  RETURN jsonb_build_object('requested', true);
END; $$;

REVOKE ALL ON FUNCTION public.request_wash(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_wash(uuid, text) TO authenticated, service_role;

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

  IF v_hours > 0 THEN
    INSERT INTO public.cooldowns (player_id, type, expires_at)
    VALUES (v_c.challenger_id, 'wash', now() + make_interval(hours => v_hours));
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

-- ─── Schedule ───────────────────────────────────────────────────────────────
-- Drift has to happen without anyone remembering to run it.

CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'tof-inactive-drift';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule('tof-inactive-drift', '15 9 * * *',
  $$SELECT public.apply_inactive_drift();$$);
