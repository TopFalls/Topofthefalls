import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Smartphone, KeyRound, AlertCircle, ArrowLeft, HelpCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { EKGLine } from '../components/EKGLine';
import { Button } from '../components/Button';
import { LEAGUE } from '../config/league';
import { toE164, formatPhone } from '../lib/phone';

type Step = 'phone' | 'code';

// Auto-focus the phone field only on desktop. On phones it pops the keyboard
// the moment the page loads, covering the title and disorienting first-time visitors.
const SHOULD_AUTO_FOCUS_PHONE =
  typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches;

export default function LoginPage() {
  const navigate              = useNavigate();
  const [step, setStep]       = useState<Step>('phone');
  const [phone, setPhone]     = useState('');
  const [code, setCode]       = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [resent, setResent]   = useState(false);
  // Supabase refuses a second code for the same number inside 60 seconds and
  // returns 429 `over_sms_send_rate_limit`. Players were tapping Send four
  // and five times because nothing on screen told them a code was already on
  // its way, so they collected refusals instead of a code. Count it down where
  // they can see it.
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === 'code') {
      setTimeout(() => codeRef.current?.focus(), 150);
    }
  }, [step]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // The raw message is "For security purposes, you can only request this after
  // 29 seconds." Nobody standing at a pool table should have to parse that.
  const friendlyAuthError = (message: string): string => {
    const wait = /after (\d+) seconds/i.exec(message);
    if (wait) return `A code is already on its way. You can ask for another in ${wait[1]} seconds.`;
    if (/rate limit/i.test(message)) return 'Too many tries just now. Give it a minute and try again.';
    if (/invalid|not found/i.test(message)) return 'That phone number does not look right. Check it and try again.';
    return message;
  };

  const secondsToWait = (message: string): number => {
    const wait = /after (\d+) seconds/i.exec(message);
    return wait ? Number(wait[1]) : 60;
  };

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const e164 = toE164(phone);
    if (!e164) { setError('Enter a 10-digit US phone number, like (406) 555-1234.'); return; }
    setLoading(true);
    setError('');
    const { error: err } = await supabase.auth.signInWithOtp({ phone: e164 });
    setLoading(false);
    if (err) {
      setError(friendlyAuthError(err.message));
      setCooldown(secondsToWait(err.message));
      // Still move to the code screen: a code from the earlier tap is on its
      // way, and leaving them on the phone form makes them send yet again.
      if (/after \d+ seconds/i.test(err.message)) setStep('code');
    } else {
      setStep('code');
      setResent(false);
      setCooldown(60);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.replace(/\s/g, '');
    if (trimmed.length !== 6) return;
    setLoading(true);
    setError('');
    const e164 = toE164(phone);
    if (!e164) { setLoading(false); setError('That phone number does not look right.'); return; }
    const { error: err } = await supabase.auth.verifyOtp({
      phone: e164,
      token: trimmed,
      type: 'sms',
    });
    setLoading(false);
    if (err) { setError('Invalid or expired code. Try again.'); }
    else     { navigate('/', { replace: true }); }
  };

  const handleResend = async () => {
    setError('');
    setCode('');
    const e164 = toE164(phone);
    if (!e164) return;
    const { error: err } = await supabase.auth.signInWithOtp({ phone: e164 });
    if (err) {
      setError(friendlyAuthError(err.message));
      setCooldown(secondsToWait(err.message));
      return;
    }
    setResent(true);
    setCooldown(60);
  };

  const handleCodeChange = (val: string) => {
    const digits = val.replace(/\D/g, '').slice(0, 6);
    setCode(digits);
    setError('');
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
          {step === 'phone' ? (
            <motion.form
              key="phone-step"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.25 }}
              onSubmit={handleSendCode}
              className="glass-card p-6 space-y-4"
            >
              <div>
                <label
                  htmlFor="login-phone"
                  className="block text-[#9CA3AF] text-sm font-[Barlow] mb-2"
                >
                  Mobile Phone Number
                </label>
                <div className="relative">
                  <Smartphone size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7280]" />
                  <input
                    id="login-phone"
                    name="phone"
                    type="tel"
                    autoComplete="tel"
                    inputMode="tel"
                    value={phone}
                    onChange={(e) => { setPhone(e.target.value); setError(''); }}
                    placeholder="(406) 555-1234"
                    autoFocus={SHOULD_AUTO_FOCUS_PHONE}
                    className="w-full pl-10 pr-4 py-3 rounded-lg bg-[#252525] border border-[#333] text-[#E8E2D6] font-[Barlow] text-base placeholder-[#6B7280] focus:outline-none focus:border-[var(--toc-theme-accent)] focus:ring-1 focus:ring-[var(--toc-theme-glow-soft)] transition-colors"
                  />
                </div>
                {error && (
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex items-center gap-1.5 text-[#EF4444] text-sm mt-2 font-[Barlow]"
                  >
                    <AlertCircle size={14} /> {error}
                  </motion.p>
                )}
              </div>

              <Button
                type="submit"
                variant="primary"
                fullWidth
                size="lg"
                loading={loading}
                disabled={!toE164(phone) || cooldown > 0}
              >
                <Smartphone size={16} />
                {cooldown > 0 ? `Wait ${cooldown}s` : 'Send Sign-In Code'}
              </Button>

              {/* Helper bumped from text-xs (12px) to text-sm (14px) for legibility.
                  Supabase auth is configured for 6-digit OTP codes (supabase/config.toml). */}
              <p className="text-center text-[#A1A1AA] text-sm font-[Barlow] leading-relaxed">
                We'll text you a 6-digit code. No password needed. Message and data rates may apply.
              </p>

              {/* Nobody should have to hand over a phone number to find out
                  what this is. The list, the live scores and the league feed
                  are all readable without an account. */}
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
          ) : (
            <motion.form
              key="code-step"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.25 }}
              onSubmit={handleVerifyCode}
              className="glass-card p-6 space-y-5"
            >
              <div className="flex items-center gap-2 mb-1">
                <button
                  type="button"
                  onClick={() => { setStep('phone'); setCode(''); setError(''); }}
                  aria-label="Back to phone number step"
                  className="text-[#9CA3AF] hover:text-[#E8E2D6] transition-colors"
                >
                  <ArrowLeft size={18} />
                </button>
                <div>
                  <div className="font-[Barlow] font-semibold text-[#E8E2D6] text-sm">
                    Check your texts
                  </div>
                  <div className="text-[#A1A1AA] text-sm font-[Barlow]">
                    Code sent to {formatPhone(toE164(phone))}
                  </div>
                </div>
              </div>

              <div>
                <label
                  htmlFor="login-code"
                  className="flex items-center gap-1.5 text-[#9CA3AF] text-sm font-[Barlow] mb-3"
                >
                  <KeyRound size={14} /> 6-Digit Code
                </label>
                <input
                  id="login-code"
                  name="otp"
                  ref={codeRef}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => handleCodeChange(e.target.value)}
                  placeholder="000000"
                  maxLength={6}
                  className="w-full px-4 py-4 rounded-lg bg-[#252525] border border-[#333] text-[#E8E2D6] font-[Azeret_Mono] text-3xl text-center tracking-[0.5em] placeholder-[#3A3A3A] focus:outline-none focus:border-[var(--toc-theme-accent)] focus:ring-1 focus:ring-[var(--toc-theme-glow-soft)] transition-colors"
                />
                {error && (
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex items-center gap-1.5 text-[#EF4444] text-sm mt-2 font-[Barlow]"
                  >
                    <AlertCircle size={14} /> {error}
                  </motion.p>
                )}
              </div>

              <Button
                type="submit"
                variant="primary"
                fullWidth
                size="lg"
                loading={loading}
                disabled={code.replace(/\s/g, '').length !== 6}
              >
                Sign In
              </Button>

              <div className="text-center">
                {cooldown > 0 ? (
                  <p className="text-[#9CA3AF] text-sm font-[Barlow]">
                    {resent ? 'Code resent. ' : 'Code sent. '}
                    Check your texts — you can ask for another in {cooldown}s.
                  </p>
                ) : resent ? (
                  <p className="text-[#22C55E] text-sm font-[Barlow]">Code resent!</p>
                ) : (
                  <button
                    type="button"
                    onClick={handleResend}
                    className="text-[#9CA3AF] text-sm font-[Barlow] underline underline-offset-2 hover:text-[#E8E2D6] transition-colors"
                  >
                    Resend code
                  </button>
                )}
              </div>
            </motion.form>
          )}
        </AnimatePresence>

        {/* Quiet help link below the card. First-time visitors and locked-out members
            need an escape hatch — there was no contact path before. */}
        <div className="mt-5 text-center">
          <a
            href={`mailto:help@topofthefalls.com?subject=${encodeURIComponent(LEAGUE.shortName)}%20sign-in%20help`}
            className="inline-flex items-center gap-1.5 text-[#71717A] hover:text-[#A1A1AA] text-sm font-[Barlow] transition-colors"
          >
            <HelpCircle size={14} /> Trouble signing in?
          </a>
        </div>
      </motion.div>
    </div>
  );
}
