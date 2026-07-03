-- ============================================================
-- TOF App - Atomic admin rankings reorder
-- ============================================================
-- The admin Rankings tab previously saved a reorder as one UPDATE per row from
-- the client; a network failure mid-save could leave the ladder half-reordered.
-- This RPC applies the whole new order in a single transaction, using the same
-- SHARE ROW EXCLUSIVE lock and offset trick as the other rank mutators
-- (see 20260517035337_serialize_ranking_mutations.sql) so it cannot interleave
-- with match confirmations and never trips UNIQUE(position) mid-flight.
--
-- Unlike the service-role rank mutators, this is called directly from the
-- admin UI as the signed-in user, so it authorizes via profiles.role.

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
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'admin_reorder_rankings: admin role required';
  END IF;

  IF p_order IS NULL OR jsonb_typeof(p_order) <> 'array' OR jsonb_array_length(p_order) = 0 THEN
    RAISE EXCEPTION 'admin_reorder_rankings: p_order must be a non-empty array';
  END IF;

  v_expected := jsonb_array_length(p_order);

  -- Reject duplicate players or duplicate target positions up front.
  IF (SELECT count(DISTINCT x.player_id)
      FROM jsonb_to_recordset(p_order) AS x(player_id uuid, position integer, previous_position integer)
     ) <> v_expected
     OR (SELECT count(DISTINCT x.position)
      FROM jsonb_to_recordset(p_order) AS x(player_id uuid, position integer, previous_position integer)
     ) <> v_expected THEN
    RAISE EXCEPTION 'admin_reorder_rankings: duplicate player or position in payload';
  END IF;

  LOCK TABLE public.rankings IN SHARE ROW EXCLUSIVE MODE;

  -- Phase 1: park affected rows out of the live position range so the
  -- UNIQUE(position) constraint never sees overlap.
  UPDATE public.rankings r
  SET
    position = x.position + 1000,
    previous_position = x.previous_position,
    updated_at = now()
  FROM jsonb_to_recordset(p_order) AS x(player_id uuid, position integer, previous_position integer)
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
END;
$$;

COMMENT ON FUNCTION public.admin_reorder_rankings(jsonb) IS
  'Apply a full admin reorder of the rankings ladder atomically. p_order is a jsonb array of {player_id, position, previous_position}. Admin/super_admin only; single transaction; safe against UNIQUE(position).';

REVOKE ALL ON FUNCTION public.admin_reorder_rankings(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_reorder_rankings(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_reorder_rankings(jsonb) TO authenticated, service_role;
