import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Screen, Card, Title, Sub, Input, Btn, Check } from '../ui/kit';
import { C, S } from '../ui/theme';
import { useAuth } from '../lib/auth';
import { EyeToggle } from '../components/EyeToggle';
import { supabase } from '../lib/supabase';
import { notify } from '../lib/dialogs';

// szándékosan NEM 'ktg:' előtaggal: a kijelentkezés/fiókváltás takarítása ne törölje
const QUICK_KEY = 'quick-accounts';

export default function Login() {
  const { session, signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');

  // ha a munkamenet a betöltés után (pl. token-frissítéskor) áll helyre,
  // ne ragadjunk a belépőn — irány a kezdőlap
  React.useEffect(() => {
    if (session) router.replace('/');
  }, [session]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Gyors belépés: ezen az eszközön megjegyzett e-mail címek — jelszót
  // SOHA nem tárolunk, azt minden belépéskor be kell írni.
  const [quick, setQuick] = useState<{ email: string }[]>([]);
  const [remember, setRemember] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem(QUICK_KEY).then((raw) => {
      if (!raw) return;
      // korábbi verzió jelszót is mentett: azt itt eldobjuk, csak az e-mail marad
      const list = (JSON.parse(raw) as any[]).map((q) => ({ email: String(q.email) }));
      setQuick(list);
      AsyncStorage.setItem(QUICK_KEY, JSON.stringify(list)).catch(() => {});
    }).catch(() => {});
  }, []);
  const saveQuick = async (list: { email: string }[]) => {
    setQuick(list);
    try { await AsyncStorage.setItem(QUICK_KEY, JSON.stringify(list)); } catch { /* tárolóhiba */ }
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    const err = mode === 'login'
      ? await signIn(email.trim(), password)
      : await signUp(email.trim(), password, name.trim() || email.split('@')[0]);
    setBusy(false);
    if (err) { setError(err); return; }
    if (remember && email.trim()) {
      await saveQuick([...quick.filter((q) => q.email !== email.trim()), { email: email.trim() }]);
    }
    router.replace('/');
  };

  // a mentett fiók csak az e-mailt tölti ki; a jelszót be kell írni
  const pickSaved = (q: { email: string }) => {
    setEmail(q.email);
    setPassword('');
    setError(null);
  };

  /** Elfelejtett jelszó: visszaállító link küldése e-mailben */
  const forgotPassword = async () => {
    const em = email.trim();
    if (!em) {
      setError('Add meg fent az e-mail címed, és küldünk jelszó-visszaállító linket.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.resetPasswordForEmail(em, {
      ...(typeof window !== 'undefined' ? { redirectTo: `${window.location.origin}/jelszo` } : {}),
    });
    setBusy(false);
    if (err) setError('Nem sikerült elküldeni a levelet. Ellenőrizd az e-mail címet, és próbáld újra.');
    else notify('Levél elküldve 📧', `Jelszó-visszaállító linket küldtünk ide: ${em}\n\nKattints a levélben lévő linkre, és add meg az új jelszavad.`);
  };

  /** Fejlesztői gyors-belépés — CSAK helyi fejlesztésben (__DEV__), a
   *  seed.sql tesztfiókjaival. Élesben nem létezik. */
  const quickLogin = async (qEmail: string) => {
    setBusy(true);
    setError(null);
    const err = await signIn(qEmail, 'teszt1234');
    setBusy(false);
    if (err) setError(`${qEmail}: ${err} — fut a helyi Supabase (supabase start + db reset)?`);
    else router.replace('/');
  };

  return (
    <Screen>
      <View style={{ paddingTop: 80, gap: S.lg }}>
        <View style={{ alignItems: 'center', gap: 4 }}>
          <Text style={{ fontSize: 40 }}>🏗️</Text>
          <Title>Építkezés Költségkövető</Title>
          <Sub>Közös költségek, bérek, elszámolás</Sub>
        </View>
        <Card>
          {mode === 'register' ? (
            <Input label="Név" value={name} onChangeText={setName} placeholder="Hogyan szólítsunk?" autoCapitalize="words" />
          ) : null}
          <Input label="Email" value={email} onChangeText={setEmail} placeholder="pl. en@pelda.hu" keyboardType="email-address" autoCapitalize="none" />
          <Input label="Jelszó" value={password} onChangeText={setPassword} placeholder="legalább 6 karakter" secureTextEntry={!showPw} autoCapitalize="none"
              right={<EyeToggle shown={showPw} onToggle={() => setShowPw(!showPw)} />} />
          {mode === 'login' ? (
            <Check checked={remember} onToggle={() => setRemember(!remember)}
              label="E-mail cím megjegyzése ezen az eszközön" sub="A jelszót nem tároljuk — azt mindig be kell írni." />
          ) : null}
          {error ? <Text style={{ color: C.danger, fontSize: 13 }}>{error}</Text> : null}
          <Btn
            title={busy ? '…' : mode === 'login' ? 'Belépés' : 'Regisztráció'}
            onPress={submit}
            disabled={busy || !email || !password}
          />
          <Btn
            title={mode === 'login' ? 'Nincs még fiókod? Regisztráció' : 'Van már fiókod? Belépés'}
            kind="ghost"
            onPress={() => setMode(mode === 'login' ? 'register' : 'login')}
          />
          {mode === 'login' ? (
            <Btn title="Elfelejtett jelszó?" kind="ghost" small disabled={busy}
              onPress={() => void forgotPassword()} />
          ) : null}
        </Card>

        {quick.length > 0 ? (
          <Card style={{ borderColor: C.primary }}>
            <Sub>⚡ Megjegyzett fiókok — koppints, majd írd be a jelszót</Sub>
            {quick.map((q) => (
              <View key={q.email} style={{ flexDirection: 'row', gap: S.sm, alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <Btn title={`👤 ${q.email}`} kind="secondary" disabled={busy} onPress={() => pickSaved(q)} />
                </View>
                <Btn title="✕" kind="ghost" small disabled={busy}
                  onPress={() => void saveQuick(quick.filter((x) => x.email !== q.email))} />
              </View>
            ))}
          </Card>
        ) : null}

        {__DEV__ ? (
          <Card style={{ borderColor: C.accent }}>
            <Sub>🧪 Teszt-belépés egy kattintással (csak helyi fejlesztésben látszik; jelszó: teszt1234)</Sub>
            <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap' }}>
              <View style={{ flex: 1, minWidth: 120 }}>
                <Btn title="👑 Admin" kind="secondary" disabled={busy} onPress={() => void quickLogin('admin@teszt.hu')} />
              </View>
              <View style={{ flex: 1, minWidth: 120 }}>
                <Btn title="👤 Dani (partner)" kind="secondary" disabled={busy} onPress={() => void quickLogin('dani@teszt.hu')} />
              </View>
              <View style={{ flex: 1, minWidth: 120 }}>
                <Btn title="👤 Anna (partner)" kind="secondary" disabled={busy} onPress={() => void quickLogin('anna@teszt.hu')} />
              </View>
              <View style={{ flex: 1, minWidth: 120 }}>
                <Btn title="👷 Marci (munkavállaló)" kind="secondary" disabled={busy} onPress={() => void quickLogin('marci@teszt.hu')} />
              </View>
              <View style={{ flex: 1, minWidth: 120 }}>
                <Btn title="⏳ Pista (függő regisztráció)" kind="secondary" disabled={busy} onPress={() => void quickLogin('pista@teszt.hu')} />
              </View>
            </View>
          </Card>
        ) : null}
      </View>
    </Screen>
  );
}
