// Bejelentkezési állapot + a store/sync életciklusa

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Session } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { store } from './store';
import { startSyncLoop, stopSyncLoop, syncNow, waitIdle } from './sync';
import { startRealtime, stopRealtime } from './realtime';
import { setCurrentUserId, getCurrentUserId } from './repo';
import { AppState } from 'react-native';

const LAST_USER_KEY = 'auth:lastUserId'; // NEM a ktg: prefixen: clearAll ne törölje
const LEGACY_LAST_USER_KEY = 'ktg:lastUserId';

/** Jelszó-visszaállító linkről érkeztünk: a Supabase a levél linkjét a
 *  Site URL-re is dobhatja (ha a /jelszo nincs az engedélyezett címek
 *  között) — ilyenkor is a jelszócsere oldalra kell vinni, nem beléptetni. */
let recoveryPending = false;
export function consumeRecoveryRedirect(): boolean {
  const r = recoveryPending;
  recoveryPending = false;
  return r;
}
function urlLooksLikeRecovery(): boolean {
  if (typeof window === 'undefined') return false;
  const u = `${window.location.search}${window.location.hash}`;
  return /type=recovery/.test(u);
}
function goToPasswordPage() {
  recoveryPending = true;
  import('expo-router').then((m) => {
    try { m.router.replace('/jelszo'); recoveryPending = false; } catch { /* a navigátor még nem áll — az index oldal kezeli */ }
  }).catch(() => {});
}

/** Fiókváltás-őr: ha nem ugyanaz a felhasználó lép be, mint akié a helyi
 *  tükör/küldősor, mindent törlünk — a másik fiók nevében sorban álló
 *  műveleteket az RLS úgyis elutasítaná. */
async function guardUserSwitch(uid: string) {
  try {
    const last = (await AsyncStorage.getItem(LAST_USER_KEY)) ?? (await AsyncStorage.getItem(LEGACY_LAST_USER_KEY));
    // ismeretlen előző fiók + nem üres tár: biztonságból törlünk (ne lásson más adatot)
    if ((last && last !== uid) || (!last && store.hasAnyRows())) await store.clearAll();
    await AsyncStorage.setItem(LAST_USER_KEY, uid);
  } catch {
    // tárolóhiba esetén nem blokkoljuk a belépést
  }
}

interface AuthCtx {
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  /** inviteToken: munkavállalói meghívó — a zárt regisztráció kapuján átenged */
  signUp: (email: string, password: string, displayName: string, inviteToken?: string,
    extra?: { phone?: string; trade?: string; is_contractor?: boolean }) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>(null as any);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (urlLooksLikeRecovery()) recoveryPending = true;
    void store.load().then(() => {
      supabase.auth.getSession().then(async ({ data }) => {
        if (data.session) await guardUserSwitch(data.session.user.id);
        setSession(data.session);
        setCurrentUserId(data.session?.user.id ?? null);
        setLoading(false);
        if (data.session) { startSyncLoop(); startRealtime(); }
      });
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      setCurrentUserId(s?.user.id ?? null);
      if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && urlLooksLikeRecovery())) goToPasswordPage();
      if (s) {
        void guardUserSwitch(s.user.id).then(() => { startSyncLoop(); startRealtime(); });
        import('./push').then((m) => m.registerPushToken()).catch(() => {});
        // weben: a meglévő Web Push feliratkozás frissítése (engedélyt nem kér)
        import('./webpush').then((m) => m.refreshWebPush()).catch(() => {});
      } else {
        stopSyncLoop();
        stopRealtime();
        // kijelentkezés után vissza a belépőre — kivéve a bejelentkezés
        // nélkül is elérhető oldalakon (meghívó, megerősítés, jelszócsere)
        const path = typeof window !== 'undefined' ? window.location.pathname : '';
        const isPublic = ['/login', '/meghivo', '/megerosites', '/jelszo'].some((p) => path.startsWith(p));
        if (!isPublic) import('expo-router').then((m) => m.router.replace('/login')).catch(() => {});
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

  const signUp = async (email: string, password: string, displayName: string, inviteToken?: string,
    extra?: { phone?: string; trade?: string; is_contractor?: boolean }) => {
    const { error } = await supabase.auth.signUp({
      email, password,
      options: {
        data: { display_name: displayName, ...(inviteToken ? { invite_token: inviteToken } : {}), ...(extra ?? {}) },
        // a megerősítő link a saját "sikeres megerősítés" oldalunkra hozzon
        ...(typeof window !== 'undefined'
          ? { emailRedirectTo: `${window.location.origin}/megerosites` }
          : {}),
      },
    });
    return error ? hunAuthError(error.message) : null;
  };

  const signOut = async () => {
    // amíg él a token: az el nem küldött rögzítések még felmennek,
    // hogy fiókváltásnál se vesszen el semmi
    try { await syncNow(); await waitIdle(); } catch { /* offline kijelentkezés is mehet */ }
    stopSyncLoop();
    stopRealtime();
    // push-csatornák leválasztása: közös eszközön a következő fiók ne kapja
    // az előző értesítéseit (natív token a profilról, webes feliratkozás le)
    try {
      const me = getCurrentUserId();
      if (me) await supabase.from('profiles').update({ push_token: null }).eq('id', me);
      await import('./webpush').then((m) => m.unsubscribeWebPush());
    } catch { /* offline: a szerver-oldali kizárólagosság (register_push_token) úgyis rendezi */ }
    await supabase.auth.signOut();
    await store.clearAll();
    try { await import('./draft').then((m) => m.clearAllDrafts()); } catch { /* nincs tároló */ }
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
  if (/database error saving new user/i.test(msg)) return 'A regisztráció nem sikerült: a meghívó érvénytelen, lejárt vagy már felhasználták. Kérj új meghívót!';
  return msg;
}
