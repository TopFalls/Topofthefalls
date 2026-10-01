import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { callEdgeFunction, edgeErrorMessage } from '../../lib/edgeFunctions';
import { formatPhoneAsTyped } from '../../lib/phone';
import { GlassCard } from '../GlassCard';
import { Button } from '../Button';
import { NamePicker, type PickedPlayer } from '../NamePicker';
import { AdminEmpty, AdminQueryError } from './AdminShared';
import { formatDistanceToNow } from '../../utils/time';

type SignInRequest = {
  id: string;
  player_id: string;
  player_name: string;
  phone: string | null;
  created_at: string;
  /** new = no account yet · switch = has an account, never set a phone · replace = already signs in with a phone */
  kind: 'new' | 'switch' | 'replace';
  is_admin_account: boolean;
};

const KIND_TEXT: Record<SignInRequest['kind'], string> = {
  new: 'First sign-in. No account yet; approving makes one.',
  switch: 'Already has an account. Approving lets them sign in with this phone and PIN.',
  replace: 'Already signs in with a phone. Approving replaces their phone number and PIN.',
};

export function SignInsTab() {
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [unlockId, setUnlockId] = useState<string | null>(null);
  const [lockedPlayer, setLockedPlayer] = useState<PickedPlayer | null>(null);

  const { data: requests = [], isLoading, isError, refetch } = useQuery<SignInRequest[]>({
    queryKey: ['admin-sign-in-requests'],
    refetchInterval: 30_000,
    queryFn: async () => (await callEdgeFunction<{ requests: SignInRequest[] }>('manage-phone-login', { action: 'list' })).requests,
  });

  const decide = async (request: SignInRequest, action: 'approve' | 'reject') => {
    setBusyId(request.id);
    setError('');
    setMessage('');
    try {
      await callEdgeFunction('manage-phone-login', { action, request_id: request.id });
      setMessage(
        action === 'approve'
          ? `${request.player_name} can sign in now. Let them know.`
          : `Turned down ${request.player_name}.`,
      );
      qc.invalidateQueries({ queryKey: ['admin-sign-in-requests'] });
      qc.invalidateQueries({ queryKey: ['admin-alerts'] });
    } catch (err) {
      setError(edgeErrorMessage(err, 'Could not save that decision.'));
    } finally {
      setBusyId(null);
    }
  };

  const unlock = async (target: { id: string; player_id: string; player_name: string }) => {
    setUnlockId(target.id);
    setError('');
    setMessage('');
    try {
      await callEdgeFunction('manage-phone-login', { action: 'unlock', player_id: target.player_id });
      setMessage(`${target.player_name} is unlocked and can try again.`);
    } catch (err) {
      setError(edgeErrorMessage(err, 'Could not unlock.'));
    } finally {
      setUnlockId(null);
    }
  };

  if (isError) return <AdminQueryError onRetry={() => refetch()} />;

  return (
    <div className="space-y-3">
      <p className="text-[#9CA3AF] text-xs font-[Barlow] leading-relaxed">
        Players sign in with their name, a phone number and a 4-digit PIN. Someone who cannot get in
        picks their name on the sign-in page and asks to be let in; it shows up here. Ring or text
        the number to be sure it is really them before you approve. The number is wiped from the
        league the moment you decide.
      </p>

      {message && <p className="text-[#22C55E] text-xs font-[Barlow]">{message}</p>}
      {error && <p className="text-[#EF4444] text-xs font-[Barlow]">{error}</p>}

      {isLoading ? (
        <div className="skeleton h-24 w-full rounded-xl" />
      ) : requests.length === 0 ? (
        <AdminEmpty title="Nobody is waiting" subtitle="New sign-in requests will show up here." />
      ) : (
        requests.map((r) => (
          <GlassCard key={r.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-[Barlow] font-semibold text-[#E8E2D6]">{r.player_name}</div>
                <div className="text-[#E8E2D6] font-[Azeret_Mono] text-sm mt-0.5">
                  {r.phone ? formatPhoneAsTyped(r.phone) : '—'}
                </div>
                <div className="text-[#6B7280] text-xs font-[Barlow] mt-0.5">
                  Asked {formatDistanceToNow(r.created_at)}
                </div>
              </div>
            </div>
            <p className="text-[#9CA3AF] text-xs font-[Barlow] mt-2">{KIND_TEXT[r.kind]}</p>
            {r.is_admin_account && (
              <p className="text-[#F59E0B] text-xs font-[Barlow] mt-2">
                This name has admin access. Only approve it if you have spoken to them.
              </p>
            )}
            <div className="flex gap-2 mt-3">
              <Button variant="ghost" size="sm" disabled={busyId === r.id} onClick={() => decide(r, 'reject')}>
                Turn down
              </Button>
              <Button variant="primary" size="sm" loading={busyId === r.id} onClick={() => decide(r, 'approve')}>
                Approve
              </Button>
              <Button variant="ghost" size="sm" loading={unlockId === r.id} onClick={() => unlock(r)}>
                Clear lockout
              </Button>
            </div>
          </GlassCard>
        ))
      )}

      <GlassCard className="p-4 space-y-3">
        <h3 className="font-[Bebas_Neue] text-lg text-[#E8E2D6]">Locked out?</h3>
        <p className="text-[#9CA3AF] text-xs font-[Barlow]">
          Five wrong tries lock a name for a while, longer each time. If a player is stuck, clear it here.
        </p>
        <NamePicker value={lockedPlayer} onChange={setLockedPlayer} label="Player" />
        <Button
          variant="secondary"
          size="sm"
          disabled={!lockedPlayer}
          loading={unlockId === 'manual'}
          onClick={() => lockedPlayer && unlock({ id: 'manual', player_id: lockedPlayer.id, player_name: lockedPlayer.full_name })}
        >
          Clear lockout
        </Button>
      </GlassCard>
    </div>
  );
}
