import React, { useState } from 'react';
import { Megaphone, Send } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { GlassCard } from '../GlassCard';
import { Button } from '../Button';
import { adminInputClass } from './AdminShared';

/**
 * Message the whole league (questionnaire H2 — Carl answered "Yes").
 *
 * Every claimed player gets a notification and the league feed keeps the
 * record. Players who have not claimed a name have no account to receive it,
 * which is stated plainly rather than quietly ignored — Carl still needs
 * Facebook for those.
 */
export function AnnouncementsTab() {
  const [title, setTitle] = useState('');
  const [body, setBody]   = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError]     = useState('');
  const [sent, setSent]       = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);

  const canSend = title.trim().length > 0 && body.trim().length > 0 && !sending;

  const send = async () => {
    setSending(true);
    setError('');
    const { data, error: rpcError } = await supabase.rpc('broadcast_league_announcement', {
      p_title: title.trim(),
      p_body: body.trim(),
    });
    setSending(false);
    setConfirming(false);
    if (rpcError) {
      setError(rpcError.message || 'Could not send the announcement.');
      return;
    }
    setSent((data as { recipients?: number } | null)?.recipients ?? 0);
    setTitle('');
    setBody('');
  };

  return (
    <div className="space-y-4">
      <GlassCard className="p-4">
        <div className="flex items-center gap-2 mb-1">
          <Megaphone size={18} className="text-[var(--toc-theme-accent-2)]" />
          <h2 className="font-[Bebas_Neue] text-xl tracking-wide text-[#E8E2D6]">
            Tell the league
          </h2>
        </div>
        <p className="text-[#9CA3AF] text-xs font-[Barlow] mb-4">
          Goes to every player who has signed in, and onto the league activity
          feed. Players who haven't claimed their name yet won't get it.
        </p>

        <label className="block text-[#9CA3AF] text-xs font-[Barlow] mb-1">Heading</label>
        <input
          value={title}
          onChange={(e) => { setTitle(e.target.value.slice(0, 120)); setSent(null); }}
          placeholder="League night moved to Thursday"
          className={`${adminInputClass} w-full mb-1`}
        />
        <div className="text-right text-[#4B5563] text-[10px] font-[Azeret_Mono] mb-3">
          {title.length}/120
        </div>

        <label className="block text-[#9CA3AF] text-xs font-[Barlow] mb-1">Message</label>
        <textarea
          value={body}
          onChange={(e) => { setBody(e.target.value.slice(0, 2000)); setSent(null); }}
          rows={5}
          placeholder="Silver Spur has us in the back room this week. Same time, 7pm."
          className={`${adminInputClass} w-full resize-y`}
        />
        <div className="text-right text-[#4B5563] text-[10px] font-[Azeret_Mono] mb-3">
          {body.length}/2000
        </div>

        {error && (
          <p className="text-[#EF4444] text-xs font-[Barlow] mb-3">{error}</p>
        )}
        {sent !== null && (
          <p className="text-[#22C55E] text-xs font-[Barlow] mb-3">
            Sent to {sent} {sent === 1 ? 'player' : 'players'}.
          </p>
        )}

        {/* This reaches everyone at once and cannot be unsent, so it asks. */}
        {confirming ? (
          <div className="space-y-2">
            <p className="text-[#F59E0B] text-xs font-[Barlow]">
              This sends to every signed-in player straight away. There's no undo.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => setConfirming(false)} disabled={sending}>
                Cancel
              </Button>
              <Button variant="primary" onClick={send} loading={sending}>
                <Send size={14} /> Send it
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="primary" fullWidth disabled={!canSend} onClick={() => setConfirming(true)}>
            <Megaphone size={14} /> Send to the league
          </Button>
        )}
      </GlassCard>
    </div>
  );
}
