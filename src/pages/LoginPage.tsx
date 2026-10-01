import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Phone, KeyRound, AlertCircle, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { signInWithPhone, requestToJoin } from '../lib/phoneLogin';
import { normalizePhone, normalizePin, formatPhoneAsTyped, pinAsTyped } from '../lib/phone';
import { NamePicker, type PickedPlayer } from '../components/NamePicker';
import { EKGLine } from '../components/EKGLine';
import { Button } from '../components/Button';
import { LEAGUE } from '../config/league';

type Mode = 'signin' | 'join' | 'sent';

const INPUT_CLASS =
  'w-full px-4 py-3 rounded-lg bg-[#252525] border border-[#333] text-[#E8E2D6] font-[Barlow] text-base placeholder-[#6B7280] focus:outline-none focus:border-[var(--toc-theme-accent)] focus:ring-1 focus:ring-[var(--toc-theme-glow-soft)] transition-colors';

export default function LoginPage() {
  const navigate                = useNavigate();
  const [mode, setMode]         = useState<Mode>('signin');
  const [picked, setPicked]     = useState<PickedPlayer | null>(null);
  const [phone, setPhone]       = useState('');
  const [pin, setPin]           = useState('');
  const [pinAgain, setPinAgain] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  const cleanPhone = normalizePhone(phone);
  const cleanPin   = normalizePin(pin);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError('');
    setPin('');
    setPinAgain('');
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!picked || !cleanPhone || !cleanPin) return;
    setLoading(true);
    setError('');
    try {
      await signInWithPhone(picked.id, cleanPhone, cleanPin);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign you in.');
      setPin('');
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!picked || !cleanPhone || !cleanPin) return;
    if (pin !== pinAgain) { setError('The two PINs do not match.'); return; }
    setLoading(true);
    setError('');
    try {
      await requestToJoin(picked.id, cleanPhone, cleanPin);
      setMode('sent');
      setPin('');
      setPinAgain('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send your request.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 relative overflow-hidden">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at 50% 60%, var(--toc-theme-glow-soft) 0%, transparent 65%)',
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="relative z-10 w-full max-w-sm"
      >
        {/* Logo */}
        <div className="text-center mb-8">
          <motion.div
            animate={{ y: [0, -6, 0] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            className="mb-4 flex justify-center"
          >
            <img
              src="/tof-logo.png"
              alt="Top of the Falls — Bar Box Union Local 406, Great Falls, Montana"
              className="w-28 h-28 rounded-full"
              style={{ filter: 'drop-shadow(0 0 28px var(--toc-theme-glow))' }}
            />
          </motion.div>
          <h1
            className="font-[Bebas_Neue] text-6xl tracking-widest leading-none"
            style={{
              color: '#E8E2D6',
              textShadow: '0 0 40px var(--toc-theme-glow), 0 2px 8px rgba(0,0,0,0.6)',
            }}
          >
            {LEAGUE.name.toUpperCase().includes('TOP OF THE') ? (
              <>TOP OF THE<br />{LEAGUE.name.toUpperCase().replace('TOP OF THE', '').trim()}</>
            ) : (
              <>{LEAGUE.name.toUpperCase()}</>
            )}
          </h1>
          <p className="text-[#9CA3AF] font-[Barlow] text-sm mt-2 tracking-[0.2em] uppercase">
            {LEAGUE.tagline}
          </p>
          <EKGLine className="mx-auto mt-3" />
          {/* Tagline gives first-time visitors a one-line answer to "what is this?" */}
          <p className="text-[#A1A1AA] font-[Barlow] text-base mt-5 leading-relaxed">
            Track your matches. Climb the ladder.{' '}
            <span className="text-[#E8E2D6] font-semibold">Defend your spot.</span>
          </p>
        </div>

        <AnimatePresence mode="wait">
          {mode === 'sent' ? (
            <motion.div
              key="sent"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="glass-card p-6 space-y-4 text-center"
            >
              <h2 className="font-[Bebas_Neue] text-3xl text-[#E8E2D6]">Request sent</h2>
              <p className="text-[#9CA3AF] text-sm font-[Barlow] leading-relaxed">
                A league admin will look at it and let you in. Once they do, come back here and
                sign in with the same name, phone number and PIN.
              </p>
              <Button variant="primary" fullWidth size="lg" onClick={() => switchMode('signin')}>
                Back to sign in
              </Button>
            </motion.div>
          ) : (
            <motion.form
              key={mode}
              initial={{ opacity: 0, x: mode === 'signin' ? -20 : 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: mode === 'signin' ? -20 : 20 }}
              transition={{ duration: 0.25 }}
              onSubmit={mode === 'signin' ? handleSignIn : handleJoin}
              className="glass-card p-6 space-y-4"
            >
              {mode === 'join' && (
                <button
                  type="button"
                  onClick={() => switchMode('signin')}
                  className="flex items-center gap-1.5 text-[#9CA3AF] hover:text-[#E8E2D6] text-sm font-[Barlow] transition-colors"
                >
                  <ArrowLeft size={16} /> Back to sign in
                </button>
              )}

              <NamePicker value={picked} onChange={(p) => { setPicked(p); setError(''); }} />

              <div>
                <label htmlFor="login-phone" className="flex items-center gap-1.5 text-[#9CA3AF] text-sm font-[Barlow] mb-2">
                  <Phone size={14} /> Phone number
                </label>
                <input
                  id="login-phone"
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
                <label htmlFor="login-pin" className="flex items-center gap-1.5 text-[#9CA3AF] text-sm font-[Barlow] mb-2">
                  <KeyRound size={14} /> {mode === 'join' ? 'Choose a 4-digit PIN' : '4-digit PIN'}
                </label>
                <input
                  id="login-pin"
                  name="pin"
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete={mode === 'join' ? 'new-password' : 'current-password'}
                  value={pin}
                  onChange={(e) => { setPin(pinAsTyped(e.target.value)); setError(''); }}
                  placeholder="••••"
                  maxLength={4}
                  className={`${INPUT_CLASS} font-[Azeret_Mono] text-2xl tracking-[0.5em] text-center`}
                />
              </div>

              {mode === 'join' && (
                <div>
                  <label htmlFor="login-pin-again" className="block text-[#9CA3AF] text-sm font-[Barlow] mb-2">
                    Type the PIN again
                  </label>
                  <input
                    id="login-pin-again"
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
              )}

              {error && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  role="alert"
                  className="flex items-start gap-1.5 text-[#EF4444] text-sm font-[Barlow]"
                >
                  <AlertCircle size={14} className="mt-0.5 shrink-0" /> {error}
                </motion.p>
              )}

              <Button
                type="submit"
                variant="primary"
                fullWidth
                size="lg"
                loading={loading}
                disabled={!picked || !cleanPhone || !cleanPin || (mode === 'join' && pinAgain.length !== 4)}
              >
                {mode === 'signin' ? 'Sign In' : 'Ask to Join'}
              </Button>

              {mode === 'signin' ? (
                <p className="text-center text-[#A1A1AA] text-sm font-[Barlow] leading-relaxed">
                  First time here since the change?{' '}
                  <button
                    type="button"
                    onClick={() => switchMode('join')}
                    className="underline underline-offset-2 text-[#E8E2D6]"
                  >
                    Ask to be let in
                  </button>
                </p>
              ) : (
                <p className="text-center text-[#A1A1AA] text-sm font-[Barlow] leading-relaxed">
                  A league admin will see your request and your phone number, and let you in once
                  they know it is you. Your phone number is only used to sign in.
                </p>
              )}

              {/* Nobody should have to give anything up to find out what this
                  is. The list, the live scores and the league feed are all
                  readable without an account. */}
              <div className="pt-1 border-t border-white/5">
                <button
                  type="button"
                  onClick={() => navigate('/')}
                  className="w-full text-center text-sm font-[Barlow] font-medium pt-4"
                  style={{ color: 'var(--toc-theme-accent-2)' }}
                >
                  Just looking? Browse the league →
                </button>
              </div>
            </motion.form>
          )}
        </AnimatePresence>

        {/* Locked-out members need somewhere to go; the people who can fix it are in the league. */}
        <p className="mt-5 text-center text-[#71717A] text-sm font-[Barlow]">
          Trouble signing in? Ask a league admin.
        </p>
      </motion.div>
    </div>
  );
}
