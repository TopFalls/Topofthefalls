-- Mike Birkoski receives league-admin access on his existing account.
--
-- Carl's request: "Grant disturbingiraq@gmail.com admin access." Mike has
-- already signed in and claimed his roster row. He is an admin, not a second
-- super_admin; Carl remains the sole super_admin for this instance.
--
-- The auth id is resolved by email rather than copied into migration history.
-- Reapplying this update is harmless, and a missing account is a no-op.

-- ─── Grant the role ─────────────────────────────────────────────────────────

UPDATE public.profiles AS profile
SET role = 'admin'
FROM auth.users AS account
WHERE profile.id = account.id
  AND lower(account.email) = lower('disturbingiraq@gmail.com')
  AND profile.role IS DISTINCT FROM 'admin';
