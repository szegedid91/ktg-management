// Jelszócsere-oldal. Az "Elfelejtett jelszó" e-mail linkje ide hoz; a
// supabase-js a linkből beléptet (recovery munkamenet), itt pedig új
// jelszót lehet megadni.

import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { router, Stack } from 'expo-router';
import { Screen, Card, Title, Sub, Input, Btn } from '../ui/kit';
import { C, S } from '../ui/theme';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { notify } from '../lib/dialogs';

export default function PasswordReset() {
  const { session } = useAuth();
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const m = window.location.hash.match(/error_description=([^&]+)/);
      if (m) setLinkError(decodeURIComponent(m[1].replace(/\+/g, ' ')));
    }
  }, []);

  const save = async () => {
    if (pw1.length < 6) { setError('A jelszó legalább 6 karakter legyen.'); return; }
    if (pw1 !== pw2) { setError('A két jelszó nem egyezik.'); return; }
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.updateUser({ password: pw1 });
    setBusy(false);
    if (err) {
      setError('Nem sikerült a jelszócsere. Lehet, hogy a link lejárt — kérj újat a belépőoldalon.');
      return;
    }
    notify('Jelszó megváltoztatva ✅', 'Mostantól az új jelszóval tudsz belépni.');
    router.replace('/');
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Új jelszó', headerLeft: () => null }} />
      <View style={{ paddingTop: 60, gap: S.lg, alignItems: 'center' }}>
        <Text style={{ fontSize: 56 }}>🔑</Text>
        <Card style={{ alignSelf: 'stretch', gap: S.md }}>
          {linkError || !session ? (
            <>
              <Title>{linkError ? 'A link nem érvényes' : 'Nyisd meg a levélben kapott linket'}</Title>
              <Sub>
                {linkError
                  ? 'A jelszó-visszaállító link lejárt vagy már fel lett használva. Kérj újat a belépőoldal „Elfelejtett jelszó?" gombjával.'
                  : 'Ez az oldal a jelszó-visszaállító e-mailből nyílik meg. Ha még nem kaptál levelet, kérj egyet a belépőoldalon.'}
              </Sub>
              <Btn title="Vissza a belépéshez" onPress={() => router.replace('/login')} />
            </>
          ) : (
            <>
              <Title>Adj meg új jelszót</Title>
              <Input label="Új jelszó" value={pw1} onChangeText={setPw1}
                placeholder="legalább 6 karakter" secureTextEntry autoCapitalize="none" />
              <Input label="Új jelszó még egyszer" value={pw2} onChangeText={setPw2}
                placeholder="ugyanaz még egyszer" secureTextEntry autoCapitalize="none" />
              {error ? <Text style={{ color: C.danger, fontSize: 13 }}>{error}</Text> : null}
              <Btn title={busy ? 'Mentés…' : '💾 Jelszó mentése'} onPress={() => void save()}
                disabled={busy || !pw1 || !pw2} />
            </>
          )}
        </Card>
      </View>
    </Screen>
  );
}
