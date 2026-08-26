import React, { useEffect, useState } from 'react';
import { Pressable, Text } from 'react-native';
import { Stack, router } from 'expo-router';
import { AuthProvider } from '../lib/auth';
import { DialogHost } from '../components/DialogHost';
import { C, getThemeMode, loadThemeMode, subscribeTheme } from '../ui/theme';

/** Vissza-gomb, ami akkor is működik, ha nincs navigációs előzmény
 *  (pl. közvetlen link vagy oldal-frissítés után): ilyenkor a Kezdőlapra visz. */
function HeaderBack() {
  return (
    <Pressable
      onPress={() => {
        if (router.canGoBack()) router.back();
        else router.replace('/');
      }}
      hitSlop={12}
      style={({ pressed }) => ({ paddingHorizontal: 8, paddingVertical: 4, opacity: pressed ? 0.6 : 1 })}
    >
      <Text style={{ color: '#fff', fontSize: 24, fontWeight: '600', lineHeight: 26 }}>‹</Text>
    </Pressable>
  );
}

export default function RootLayout() {
  // esti nézet: témaváltáskor a key csere újrarendereli a teljes fát
  const [theme, setTheme] = useState(getThemeMode());
  useEffect(() => {
    void loadThemeMode();
    return subscribeTheme(setTheme);
  }, []);

  return (
    <AuthProvider>
      <Stack
        key={theme}
        screenOptions={{
          headerStyle: { backgroundColor: C.primary },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: C.bg },
          headerLeft: () => <HeaderBack />,
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Kezdőlap', headerLeft: () => null }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="more" options={{ title: 'Több' }} />
        <Stack.Screen name="pending/index" options={{ title: 'Függőben' }} />
        <Stack.Screen name="sites" options={{ title: 'Építkezések' }} />
        <Stack.Screen name="calendar" options={{ title: 'Naptár' }} />
        <Stack.Screen name="settlement" options={{ title: 'Elszámolás' }} />
        <Stack.Screen name="site/new" options={{ title: 'Új építkezés' }} />
        <Stack.Screen name="site/[id]" options={{ title: 'Építkezés' }} />
        <Stack.Screen name="expense/new" options={{ title: 'Költség rögzítése' }} />
        <Stack.Screen name="expense/[id]" options={{ title: 'Költség' }} />
        <Stack.Screen name="workers/index" options={{ title: 'Munkavállalók' }} />
        <Stack.Screen name="worker/new" options={{ title: 'Új munkavállaló' }} />
        <Stack.Screen name="worker/[id]" options={{ title: 'Munkavállaló' }} />
        <Stack.Screen name="day/[date]" options={{ title: 'Napi jelenlét' }} />
        <Stack.Screen name="pending/[kind]" options={{ title: 'Függő kifizetések' }} />
        <Stack.Screen name="invoices/index" options={{ title: 'Kimenő számlák' }} />
        <Stack.Screen name="invoice/new" options={{ title: 'Új számla' }} />
        <Stack.Screen name="invoice/[id]" options={{ title: 'Számla' }} />
        <Stack.Screen name="stats" options={{ title: 'Statisztika' }} />
        <Stack.Screen name="equipment" options={{ title: 'Eszközök' }} />
        <Stack.Screen name="settings" options={{ title: 'Beállítások' }} />
        <Stack.Screen name="audit" options={{ title: 'Audit napló' }} />
        <Stack.Screen name="export" options={{ title: 'Export könyvelőnek' }} />
      </Stack>
      <DialogHost />
    </AuthProvider>
  );
}
