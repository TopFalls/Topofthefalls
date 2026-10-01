import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Phone, KeyRound, AlertCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { callEdgeFunction, edgeErrorMessage } from '../lib/edgeFunctions';
import { normalizePhone, normalizePin, formatPhoneAsTyped, pinAsTyped } from '../lib/phone';
import { useAuthStore } from '../stores/authStore';
import { Button } from '../components/Button';

const INPUT_CLASS =
  'w-full px-4 py-3 rounded-lg bg-[#252525] border border-[#333] text-[#E8E2D6] font-[Barlow] text-base placeholder-[#6B7280] focus:outline-none focus:border-[var(--toc-theme-accent)] focus:ring-1 focus:ring-[var(--toc-theme-glow-soft)] transition-colors';

/**
 * One-time screen for someone who is still signed in the old way. They enter a
 * phone number and choose a 4-digit PIN; from then on that is how they sign in.
 * Already being signed in is the proof of who they are, so nobody has to approve
 * this.
 */
export default function SwitchLoginPage() {
  const navigate = useNavigate();
  const { player, setHasPhoneLogin } = useAuthStore();
  const [phone, setPhone]       = useState('');
  const [pin, setPin]           = useState('');
  const [pinAgain, setPinAgain] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  const cleanPhone = normalizePhone(phone);
  const cleanPin   = normalizePin(pin);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cleanPhone || !cleanPin) return;
    if (pin !== pinAgain) { setError('The two PINs do not match.'); return; }
    setLoading(true);
    setError('');
    try {
      await callEdgeFunction('switch-to-phone', { phone: cleanPhone, pin: cleanPin });
      setHasPhoneLogin(true);
      navigate('/', { replace: true });
    } catch (err) {
      setError(edgeErrorMessage(err, 'Could not save that. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6">
      <motion.form
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        onSubmit={handleSubmit}
        className="glass-card p-6 space-y-4 w-full max-w-sm"
      >
        <div>
          <h1 className="font-[Bebas_Neue] text-4xl text-[#E8E2D6]">New way to sign in</h1>
          <p className="text-[#9CA3AF] text-sm font-[Barlow] mt-2 leading-relaxed">
            {player ? `${player.full_name}, ` : ''}you now sign in with your phone number and a 4-digit
            PIN of your choosing. Do it once here and you are done. Nothing is sent to your phone.
          </p>
        </div>

        <div>
          <label htmlFor="switch-phone" className="flex items-center gap-1.5 text-[#9CA3AF] text-sm font-[Barlow] mb-2">
            <Phone size={14} /> Phone number
          </label>
          <input
            id="switch-phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            value={phone}
            onChange={(e) => { setPhone(formatPhoneAsTyped(e.target.value)); setError(''); }}
            placeholder="(406) 555-0123"
            className={INPUT_CLASS}
          />
        </div>

        <div>
          <label htmlFor="switch-pin" className="flex items-center gap-1.5 text-[#9CA3AF] text-sm font-[Barlow] mb-2">
            <KeyRound size={14} /> Choose a 4-digit PIN
          </label>
          <input
            id="switch-pin"
            name="pin"
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="new-password"
            value={pin}
            onChange={(e) => { setPin(pinAsTyped(e.target.value)); setError(''); }}
            placeholder="••••"
            maxLength={4}
            className={`${INPUT_CLASS} font-[Azeret_Mono] text-2xl tracking-[0.5em] text-center`}
          />
        </div>

        <div>
          <label htmlFor="switch-pin-again" className="block text-[#9CA3AF] text-sm font-[Barlow] mb-2">
            Type the PIN again
          </label>
          <input
            id="switch-pin-again"
            name="pin-again"
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="new-password"
            value={pinAgain}
            onChange={(e) => { setPinAgain(pinAsTyped(e.target.value)); setError(''); }}
            placeholder="••••"
            maxLength={4}
            className={`${INPUT_CLASS} font-[Azeret_Mono] text-2xl tracking-[0.5em] text-center`}
          />
        </div>

        {error && (
          <p role="alert" className="flex items-start gap-1.5 text-[#EF4444] text-sm font-[Barlow]">
            <AlertCircle size={14} className="mt-0.5 shrink-0" /> {error}
          </p>
        )}

        <Button
          type="submit"
          variant="primary"
          fullWidth
          size="lg"
          loading={loading}
          disabled={!cleanPhone || !cleanPin || pinAgain.length !== 4}
        >
          Save and continue
        </Button>

        <p className="text-center text-[#6B7280] text-xs font-[Barlow] leading-relaxed">
          Remember both: you will need your name, phone number and PIN to sign in next time.
        </p>
      </motion.form>
    </div>
  );
}
