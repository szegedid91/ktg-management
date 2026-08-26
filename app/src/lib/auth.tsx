// Bejelentkezési állapot + a store/sync életciklusa

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { store } from './store';
import { startSyncLoop, stopSyncLoop, syncNow } from './sync';
import { setCurrentUserId } from './repo';
import { AppState } from 'react-native';

interface AuthCtx {
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (email: string, password: string, displayName: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>(null as any);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void store.load().then(() => {
      supabase.auth.getSession().then(({ data }) => {
        setSession(data.session);
        setCurrentUserId(data.session?.user.id ?? null);
        setLoading(false);
        if (data.session) startSyncLoop();
      });
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setCurrentUserId(s?.user.id ?? null);
      if (s) {
        startSyncLoop();
        import('./push').then((m) => m.registerPushToken()).catch(() => {});
      } else {
        stopSyncLoop();
        // kijelentkezés után vissza a belépőre, bárhol is járt
        import('expo-router').then((m) => m.router.replace('/login')).catch(() => {});
      }
    });

    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void syncNow();
    });

    return () => {
      sub.subscription.unsubscribe();
      appStateSub.remove();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? hunAuthError(error.message) : null;
  };

  const signUp = async (email: string, password: string, displayName: string) => {
    const { error } = await supabase.auth.signUp({
      email, password,
      options: { data: { display_name: displayName } },
    });
    return error ? hunAuthError(error.message) : null;
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    stopSyncLoop();
    await store.clearAll();
  };

  return <Ctx.Provider value={{ session, loading, signIn, signUp, signOut }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  return useContext(Ctx);
}

function hunAuthError(msg: string): string {
  if (/invalid login credentials/i.test(msg)) return 'Hibás email-cím vagy jelszó.';
  if (/already registered/i.test(msg)) return 'Ezzel az email-címmel már regisztráltak.';
  if (/password should be at least/i.test(msg)) return 'A jelszó legalább 6 karakter legyen.';
  if (/valid email/i.test(msg)) return 'Érvénytelen email-cím.';
  return msg;
}
