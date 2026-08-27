import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { router } from 'expo-router';
import { Screen, Card, Title, Sub, Input, Btn } from '../ui/kit';
import { C, S } from '../ui/theme';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { notify } from '../lib/dialogs';

export default function Login() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const err = mode === 'login'
      ? await signIn(email.trim(), password)
      : await signUp(email.trim(), password, name.trim() || email.split('@')[0]);
    setBusy(false);
    if (err) setError(err);
    else router.replace('/');
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

  /** Fejlesztői gyors-belépés: ha a tesztfiók még nincs, létrehozza. */
  const quickLogin = async (qEmail: string, qName: string) => {
    setBusy(true);
    setError(null);
    const pw = 'teszt1234';
    let err = await signIn(qEmail, pw);
    if (err) {
      err = await signUp(qEmail, pw, qName);
      if (!err) err = await signIn(qEmail, pw);
    }
    setBusy(false);
    if (err) setError(err);
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
          <Input label="Jelszó" value={password} onChangeText={setPassword} placeholder="legalább 6 karakter" secureTextEntry autoCapitalize="none" />
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

        {__DEV__ ? (
          <Card style={{ borderColor: C.accent }}>
            <Sub>🧪 Teszt-belépés (csak fejlesztői módban látszik)</Sub>
            <View style={{ flexDirection: 'row', gap: S.md }}>
              <View style={{ flex: 1 }}>
                <Btn title="👤 Dani" kind="secondary" disabled={busy}
                  onPress={() => void quickLogin('dani@teszt.hu', 'Dani')} />
              </View>
              <View style={{ flex: 1 }}>
                <Btn title="👤 Anna" kind="secondary" disabled={busy}
                  onPress={() => void quickLogin('anna@teszt.hu', 'Anna')} />
              </View>
            </View>
          </Card>
        ) : null}
      </View>
    </Screen>
  );
}
