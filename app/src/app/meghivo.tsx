// Munkavállalói regisztráció meghívó-linkkel / QR-kóddal (?token=…)

import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Screen, Card, Title, Sub, Input, Btn, Body } from '../ui/kit';
import { C, S } from '../ui/theme';
import { useAuth } from '../lib/auth';

export default function Invite() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const { session, signUp, signOut } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    const err = await signUp(email.trim(), password, name.trim(), token);
    setBusy(false);
    if (err) { setError(err); return; }
    setDone(true);
  };

  return (
    <Screen>
      <View style={{ paddingTop: 40, gap: S.lg }}>
        <View style={{ alignItems: 'center', gap: 4 }}>
          <Text style={{ fontSize: 40 }}>👷</Text>
          <Title>Munkavállalói regisztráció</Title>
          <Sub>Építkezés Költségkövető</Sub>
        </View>

        {!token ? (
          <Card>
            <Body>Ez a link nem tartalmaz meghívót. Kérj új meghívó linket vagy QR-kódot a fő felhasználóktól.</Body>
          </Card>
        ) : session && !done ? (
          <Card>
            <Body>Már be vagy jelentkezve ({session.user.email}).</Body>
            <Sub>Ha a meghívóval új fiókot szeretnél, előbb jelentkezz ki.</Sub>
            <Btn title="Tovább az appba" onPress={() => router.replace('/')} />
            <Btn title="Kijelentkezés" kind="ghost" onPress={() => void signOut()} />
          </Card>
        ) : done ? (
          <Card>
            <Body style={{ fontWeight: '700' }}>✅ A fiókod létrejött.</Body>
            {session ? (
              <Btn title="Belépés az appba" onPress={() => router.replace('/')} />
            ) : (
              <>
                <Sub>Küldtünk egy megerősítő e-mailt a(z) {email.trim()} címre — kattints a benne lévő linkre, utána be tudsz lépni.</Sub>
                <Btn title="Belépés" kind="ghost" onPress={() => router.replace('/login')} />
              </>
            )}
          </Card>
        ) : (
          <Card>
            <Sub>A fő felhasználók meghívtak az appba. Add meg az adataid, és a fiókod a munkavállalói profilodhoz kapcsolódik.</Sub>
            <Input label="Név" value={name} onChangeText={setName} placeholder="Teljes név" autoCapitalize="words" />
            <Input label="E-mail" value={email} onChangeText={setEmail} placeholder="pl. en@pelda.hu" keyboardType="email-address" autoCapitalize="none" />
            <Input label="Jelszó" value={password} onChangeText={setPassword} placeholder="legalább 6 karakter" secureTextEntry autoCapitalize="none" />
            {error ? <Text style={{ color: C.danger, fontSize: 13 }}>{error}</Text> : null}
            <Btn title={busy ? '…' : 'Regisztráció'} onPress={() => void submit()} disabled={busy || !email || password.length < 6} />
          </Card>
        )}
      </View>
    </Screen>
  );
}
