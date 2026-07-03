-- Atomic admin rankings reorder.
--
-- The admin Rankings tab previously saved a reorder as one UPDATE per row from
-- the client; a network failure mid-save could leave the ladder half-reordered.
-- admin_reorder_rankings applies the whole new order in a single transaction,
-- using the same SHARE ROW EXCLUSIVE lock and position-offset pattern as the
-- other rank mutators (see 20260517035337_serialize_ranking_mutations.sql) so
-- it cannot interleave with match confirmations and never trips
-- UNIQUE(position) mid-flight.
--
-- Architectural note (deliberate deviation): unlike the service-role rank
-- mutators locked down in 20260517035030_lock_down_security_definer_rpc.sql,
-- this SECURITY DEFINER function is granted to authenticated and authorizes
-- via profiles.role inside the function body. It is called directly from the
-- admin UI as the signed-in admin. profiles.role cannot be self-escalated
-- (20260626121000_prevent_profile_role_self_escalation.sql), the payload
-- carries no trusted state (previous positions are read from the table, not
-- the client), and the function writes its own audit_events row — the audit
-- behavior the Edge Function pattern normally provides.

CREATE OR REPLACE FUNCTION public.admin_reorder_rankings(p_order jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_rows integer;
  v_expected integer;
  v_distinct_players integer;
  v_distinct_positions integer;
  v_before jsonb;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'admin_reorder_rankings: admin role required';
  END IF;

  IF p_order IS NULL OR jsonb_typeof(p_order) <> 'array' OR jsonb_array_length(p_order) = 0 THEN
    RAISE EXCEPTION 'admin_reorder_rankings: p_order must be a non-empty array';
  END IF;

  v_expected := jsonb_array_length(p_order);

  SELECT count(DISTINCT x.player_id), count(DISTINCT x.position)
  INTO v_distinct_players, v_distinct_positions
  FROM jsonb_to_recordset(p_order) AS x(player_id uuid, position integer);

  IF v_distinct_players <> v_expected OR v_distinct_positions <> v_expected THEN
    RAISE EXCEPTION 'admin_reorder_rankings: duplicate player or position in payload';
  END IF;

  LOCK TABLE public.rankings IN SHARE ROW EXCLUSIVE MODE;

  -- The payload must be a complete, dense reorder of the current ladder:
  -- every ranking row covered, positions exactly 1..N.
  IF v_expected <> (SELECT count(*) FROM public.rankings) THEN
    RAISE EXCEPTION 'admin_reorder_rankings: payload must cover the entire ladder';
  END IF;
  IF (SELECT array_agg(x.position ORDER BY x.position)
      FROM jsonb_to_recordset(p_order) AS x(position integer))
     <> (SELECT array_agg(g) FROM generate_series(1, v_expected) g) THEN
    RAISE EXCEPTION 'admin_reorder_rankings: positions must be a contiguous 1..N sequence';
  END IF;

  SELECT jsonb_agg(jsonb_build_object('player_id', player_id, 'position', position) ORDER BY position)
  INTO v_before
  FROM public.rankings;

  -- Phase 1: park affected rows out of the live position range so the
  -- UNIQUE(position) constraint never sees overlap. previous_position is
  -- captured from the live row, never trusted from the client.
  UPDATE public.rankings r
  SET
    position = x.position + 1000,
    previous_position = r.position,
    updated_at = now()
  FROM jsonb_to_recordset(p_order) AS x(player_id uuid, position integer)
  WHERE r.player_id = x.player_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> v_expected THEN
    RAISE EXCEPTION 'admin_reorder_rankings: % rankings rows matched, expected %', v_rows, v_expected;
  END IF;

  -- Phase 2: land on the final positions.
  UPDATE public.rankings
  SET
    position = position - 1000,
    updated_at = now(),
    rank1_since = CASE
      WHEN position - 1000 = 1 AND (previous_position IS DISTINCT FROM 1) THEN now()
      WHEN position - 1000 <> 1 THEN NULL
      ELSE rank1_since
    END
  WHERE position > 1000;

  INSERT INTO public.audit_events (actor_profile_id, action, target_type, target_id, detail)
  VALUES (
    auth.uid(),
    'rankings.admin_reorder',
    'rankings',
    NULL,
    jsonb_build_object('before', v_before, 'after', p_order)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reorder_rankings(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_reorder_rankings(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_reorder_rankings(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_reorder_rankings(jsonb) IS
  'Apply a full admin reorder of the rankings ladder atomically. p_order is a jsonb array of {player_id, position} covering the entire ladder with positions 1..N. Admin/super_admin only; single transaction; safe against UNIQUE(position); writes an audit_events row.';
