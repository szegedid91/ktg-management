// E-mail-megerősítés utáni fogadóoldal. A Supabase megerősítő linkje ide
// irányít; a supabase-js a linkben érkező tokenekből be is lépteti a
// felhasználót (detectSessionInUrl), így egyből használhatja az appot.

import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { router, Stack } from 'expo-router';
import { Screen, Card, Title, Sub, Btn } from '../ui/kit';
import { C, S } from '../ui/theme';
import { useAuth } from '../lib/auth';

export default function EmailConfirmed() {
  const { session } = useAuth();
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    // lejárt/érvénytelen link esetén a Supabase hibát tesz az URL-be
    if (typeof window !== 'undefined') {
      const hash = window.location.hash;
      const m = hash.match(/error_description=([^&]+)/);
      if (m) setLinkError(decodeURIComponent(m[1].replace(/\+/g, ' ')));
    }
  }, []);

  return (
    <Screen>
      <Stack.Screen options={{ title: 'E-mail megerősítés', headerLeft: () => null }} />
      <View style={{ paddingTop: 60, gap: S.lg, alignItems: 'center' }}>
        <Text style={{ fontSize: 56 }}>{linkError ? '⚠️' : '✅'}</Text>
        <Card style={{ alignSelf: 'stretch', alignItems: 'center', gap: S.md }}>
          {linkError ? (
            <>
              <Title>A link nem érvényes</Title>
              <Sub style={{ textAlign: 'center' }}>
                A megerősítő link lejárt vagy már fel lett használva.{'\n'}
                Próbálj meg belépni — ha nem megy, regisztrálj újra, és kattints a friss linkre.
              </Sub>
            </>
          ) : (
            <>
              <Title>Sikeres megerősítés! 🎉</Title>
              <Sub style={{ textAlign: 'center' }}>
                Az e-mail címed megerősítve — mostantól használhatod az{'\n'}
                Építkezés Költségkövetőt.
                {session ? ' Be is léptettünk.' : ''}
              </Sub>
            </>
          )}
          <View style={{ alignSelf: 'stretch' }}>
            <Btn
              title={session ? '🏗️ Irány az alkalmazás' : '🏗️ Belépés az alkalmazásba'}
              onPress={() => router.replace(session ? '/' : '/login')}
            />
          </View>
          <Sub style={{ color: C.sub }}>ktg.szakify.hu</Sub>
        </Card>
      </View>
    </Screen>
  );
}
