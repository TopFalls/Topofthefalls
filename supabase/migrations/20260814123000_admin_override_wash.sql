-- A wash keeps its automatic penalty, but an admin may override it.
--
-- Carl's rule: "If both players give times but can't agree, match is a wash.
-- Challenging player will sit for 24 hrs; challenged player may challenge up
-- immediately." That remains the default. Because Top of the Falls has final
-- say, an admin can now clear that wash cooldown or shorten its remaining time.
--
-- Resolving a wash raises a focused admin alert for the challenger so the
-- override is available after the default penalty has actually been created.

-- ─── Keep the default and raise an actionable alert ─────────────────────────

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

-- ─── Admin override ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_override_wash_cooldown(
  p_player_id uuid,
  p_remaining_hours integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows integer := 0;
  v_action text;
BEGIN
  IF NOT public.is_league_admin() THEN
    RAISE EXCEPTION 'admin_override_wash_cooldown: admin role required';
  END IF;

  IF p_remaining_hours IS NOT NULL AND p_remaining_hours < 0 THEN
    RAISE EXCEPTION 'Remaining hours cannot be negative';
  END IF;

  IF p_remaining_hours IS NULL OR p_remaining_hours = 0 THEN
    DELETE FROM public.cooldowns
    WHERE player_id = p_player_id
      AND type = 'wash'
      AND expires_at > now();

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_action := 'cleared';
  ELSE
    UPDATE public.cooldowns
    SET expires_at = LEAST(
      expires_at,
      now() + make_interval(hours => p_remaining_hours)
    )
    WHERE player_id = p_player_id
      AND type = 'wash'
      AND expires_at > now();

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_action := 'shortened';
  END IF;

  UPDATE public.admin_alerts
  SET acknowledged_at = now(), acknowledged_by = auth.uid()
  WHERE player_id = p_player_id
    AND alert_type = 'wash_penalty'
    AND acknowledged_at IS NULL;

  INSERT INTO public.audit_events (actor_profile_id, action, target_type, target_id, detail)
  VALUES (
    auth.uid(),
    'cooldowns.wash_override',
    'player',
    p_player_id,
    jsonb_build_object(
      'action', v_action,
      'remaining_hours', p_remaining_hours,
      'affected_rows', v_rows
    )
  );

  RETURN jsonb_build_object(
    'action', v_action,
    'remaining_hours', p_remaining_hours,
    'affected_rows', v_rows
  );
END;
$$;

COMMENT ON FUNCTION public.admin_override_wash_cooldown(uuid, integer) IS
  'Admin-only exception: clear a live wash cooldown with NULL or zero, or shorten it to at most the supplied number of hours.';

REVOKE ALL ON FUNCTION public.admin_override_wash_cooldown(uuid, integer)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_override_wash_cooldown(uuid, integer)
  TO authenticated;
