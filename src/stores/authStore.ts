import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';
import type { Profile, Player } from '../types/database';

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  player: Player | null;
  /** null until known. false = still signed in the old way and must switch to phone + PIN. */
  hasPhoneLogin: boolean | null;
  isLoading: boolean;
  setSession: (session: Session | null) => void;
  setProfile: (profile: Profile | null) => void;
  setPlayer: (player: Player | null) => void;
  setHasPhoneLogin: (value: boolean | null) => void;
  setIsLoading: (loading: boolean) => void;
  reset: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  profile: null,
  player: null,
  hasPhoneLogin: null,
  isLoading: true,
  setSession: (session) => set({ session }),
  setProfile: (profile) => set({ profile }),
  setPlayer: (player) => set({ player }),
  setHasPhoneLogin: (hasPhoneLogin) => set({ hasPhoneLogin }),
  setIsLoading: (isLoading) => set({ isLoading }),
  reset: () => set({ session: null, profile: null, player: null, hasPhoneLogin: null, isLoading: false }),
}));
