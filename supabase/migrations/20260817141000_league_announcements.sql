-- Carl can message the whole league from the app (questionnaire H2: "Yes").
--
-- Every player with an account gets a notification; the league feed keeps the
-- permanent record. Players who have not claimed a roster row have nowhere to
-- receive a notification, which is the point of Carl also having Facebook.
--
-- Admin-only, and audited — this is the one feature in the app that reaches
-- every player at once, so it should never be quietly available to anyone else.

CREATE OR REPLACE FUNCTION public.broadcast_league_announcement(
  p_title text,
  p_body  text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title text := btrim(coalesce(p_title, ''));
  v_body  text := btrim(coalesce(p_body,  ''));
  v_actor uuid;
  v_actor_name text;
  v_recipients integer := 0;
BEGIN
  IF NOT public.is_league_admin() THEN
    RAISE EXCEPTION 'broadcast_league_announcement: admin role required';
  END IF;

  IF v_title = '' THEN RAISE EXCEPTION 'An announcement needs a heading.'; END IF;
  IF v_body  = '' THEN RAISE EXCEPTION 'An announcement needs a message.'; END IF;
  IF length(v_title) > 120  THEN RAISE EXCEPTION 'Keep the heading under 120 characters.'; END IF;
  IF length(v_body)  > 2000 THEN RAISE EXCEPTION 'Keep the message under 2000 characters.'; END IF;

  SELECT id, full_name INTO v_actor, v_actor_name
  FROM public.players WHERE profile_id = auth.uid();

  -- Only claimed players have an account to read a notification with.
  INSERT INTO public.notifications (player_id, type, title, body, reference_type)
  SELECT p.id, 'league_announcement', v_title, v_body, 'announcement'
  FROM public.players p
  WHERE p.profile_id IS NOT NULL;
  GET DIAGNOSTICS v_recipients = ROW_COUNT;

  INSERT INTO public.activity_feed (event_type, headline, detail, actor_player_id)
  VALUES ('league_announcement',
          coalesce(v_actor_name, 'The league') || ': ' || v_title,
          v_body,
          v_actor);

  INSERT INTO public.audit_events (actor_profile_id, action, target_type, target_id, detail)
  VALUES (auth.uid(), 'league.announcement', 'league', v_actor,
          jsonb_build_object('title', v_title, 'recipients', v_recipients));

  RETURN jsonb_build_object('recipients', v_recipients, 'title', v_title);
END;
$$;

COMMENT ON FUNCTION public.broadcast_league_announcement(text, text) IS
  'Admin-only. Notifies every claimed player and records the announcement in the league feed.';

REVOKE ALL ON FUNCTION public.broadcast_league_announcement(text, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.broadcast_league_announcement(text, text)
  TO authenticated;
