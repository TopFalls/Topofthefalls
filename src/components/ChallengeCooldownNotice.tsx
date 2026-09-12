import type { useChallengeCooldown } from '../hooks/useChallengeCooldown';

export function ChallengeCooldownNotice({ state }: { state: ReturnType<typeof useChallengeCooldown> }) {
  if (!state.cooldown && !state.isLoading && !state.isError) return null;
  return (
    <div role="status" className="my-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 font-[Barlow] text-sm text-amber-200">
      {state.isError ? (
        <>Could not check your challenge wait. <button className="underline" onClick={() => void state.refetch()}>Try again</button>. You can still respond to incoming challenges.</>
      ) : state.isLoading ? 'Checking when you can challenge...' : state.cooldown ? (
        <>
          <strong className="block mb-1">Challenge wait</strong>
          You cannot issue a challenge before {new Date(state.cooldown.expires_at).toLocaleString()}.
          {state.cooldown.type === 'post_match' && ' Winning a defence clears this wait. Losing a defence restarts the full 7 days.'}
          {state.cooldown.type === 'reentry' && ' Completing a defence ends the return-from-inactive wait, but a loss starts a new 7-day wait.'}
          {' You can still receive and accept challenges.'}
        </>
      ) : null}
    </div>
  );
}
