-- Following players, and push notifications for people who are not on the list.
--
-- Two additive tables, both readable and writable only by their owner.
--
--   player_follows  which players an account follows. Keyed by the account
--                   (profile), not by a claimed player, so a signed-in visitor
--                   who has not claimed a name can follow players too.
--
--   push_devices    a phone/browser that wants notifications. push_subscriptions
--                   is one row per *player*, which excludes visitors and drops
--                   the first phone when a second one signs in. This is one row
--                   per account per device. push_subscriptions is left alone and
--                   still read by the senders, so existing players keep working.
--
-- Nothing here is granted to `anon`: the guest surface stays the six views.

CREATE TABLE IF NOT EXISTS public.player_follows (
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  player_id  uuid NOT NULL REFERENCES public.players(id)  ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, player_id)
);

CREATE INDEX IF NOT EXISTS player_follows_player_idx
  ON public.player_follows (player_id);

ALTER TABLE public.player_follows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read own follows"   ON public.player_follows;
DROP POLICY IF EXISTS "Add own follows"    ON public.player_follows;
DROP POLICY IF EXISTS "Remove own follows" ON public.player_follows;

CREATE POLICY "Read own follows" ON public.player_follows
  FOR SELECT TO authenticated USING (profile_id = auth.uid());
CREATE POLICY "Add own follows" ON public.player_follows
  FOR INSERT TO authenticated WITH CHECK (profile_id = auth.uid());
CREATE POLICY "Remove own follows" ON public.player_follows
  FOR DELETE TO authenticated USING (profile_id = auth.uid());

REVOKE ALL ON public.player_follows FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.player_follows TO authenticated;

CREATE TABLE IF NOT EXISTS public.push_devices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint     text NOT NULL,
  subscription jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, endpoint)
);

ALTER TABLE public.push_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Manage own devices" ON public.push_devices;
CREATE POLICY "Manage own devices" ON public.push_devices
  FOR ALL TO authenticated
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());

REVOKE ALL ON public.push_devices FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_devices TO authenticated;
