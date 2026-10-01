/** What declining a challenge means right now. See useAutomaticListChanges. */
export function DeclineConsequences({ automatic }: { automatic: boolean }) {
  return (
    <>
      <div className="text-sm font-[Barlow] font-semibold text-[#E8E2D6]">
        {automatic ? 'Decline counts as a forfeit' : 'Decline this challenge?'}
      </div>
      <ul className="text-xs font-[Barlow] text-[#9CA3AF] space-y-1 list-disc list-inside">
        {automatic ? (
          <>
            <li>The challenger gets a win by forfeit and may take your spot if they are lower ranked.</li>
            <li>You get a forfeit on your record and a post-match cooldown.</li>
            <li>No match fee is owed.</li>
            <li>An admin can reverse this only if your rankings and stats have not changed yet.</li>
          </>
        ) : (
          <>
            <li>Neither player's spot on the list changes.</li>
            <li>Nothing is added to either record, and no wait starts.</li>
            <li>No match fee is owed.</li>
            <li>The league admin is told and decides whether anything should change.</li>
          </>
        )}
      </ul>
    </>
  );
}
