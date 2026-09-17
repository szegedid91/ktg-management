import React, { useEffect, useState } from 'react';
import { Pressable, Text } from 'react-native';
import { Stack, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AuthProvider } from '../lib/auth';
import { DialogHost } from '../components/DialogHost';
import { HeaderBell } from '../components/HeaderBell';
import { WorkerApprovalGate } from '../components/WorkerApprovalGate';
import { ErrorBoundary } from '../components/ErrorBoundary';
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
  // Kompakt fejléc: az alapértelmezett webes 64px helyett 46px tartalom-
  // magasság; a kivágás (notch) fölötti sávot nekünk kell hozzáadni.
  const insets = useSafeAreaInsets();

  return (
    <AuthProvider>
      <ErrorBoundary>
      <Stack
        key={theme}
        screenOptions={{
          headerStyle: { backgroundColor: C.primary, height: 46 + insets.top } as any,
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: C.bg },
          headerLeft: () => <HeaderBack />,
          headerRight: () => <HeaderBell />,
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Kezdőlap', headerLeft: () => null }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="meghivo" options={{ headerShown: false }} />
        <Stack.Screen name="task/new" options={{ title: 'Új feladat' }} />
        <Stack.Screen name="tasks" options={{ title: 'Feladatok' }} />
        <Stack.Screen name="timesheets" options={{ title: 'Óralapok' }} />
        <Stack.Screen name="notifications" options={{ title: 'Értesítések' }} />
        <Stack.Screen name="task/[id]" options={{ title: 'Feladat' }} />
        <Stack.Screen name="megerosites" options={{ title: 'E-mail megerősítés' }} />
        <Stack.Screen name="jelszo" options={{ title: 'Új jelszó' }} />
        <Stack.Screen name="more" options={{ title: 'Több' }} />
        <Stack.Screen name="pending/index" options={{ title: 'Függőben' }} />
        <Stack.Screen name="sites" options={{ title: 'Építkezések' }} />
        <Stack.Screen name="calendar" options={{ title: 'Naptár' }} />
        <Stack.Screen name="settlement" options={{ title: 'Elszámolás' }} />
        <Stack.Screen name="site/new" options={{ title: 'Új építkezés' }} />
        <Stack.Screen name="site/[id]" options={{ title: 'Építkezés' }} />
        <Stack.Screen name="expense/new" options={{ title: 'Költség rögzítése' }} />
        <Stack.Screen name="expenses/common" options={{ title: 'Közös költségek' }} />
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
        <Stack.Screen name="cashflow" options={{ title: 'Pénzforgalom' }} />
        <Stack.Screen name="equipment" options={{ title: 'Eszközök' }} />
        <Stack.Screen name="settings" options={{ title: 'Beállítások' }} />
        <Stack.Screen name="audit" options={{ title: 'Audit napló' }} />
        <Stack.Screen name="export" options={{ title: 'Export könyvelőnek' }} />
      </Stack>
      </ErrorBoundary>
      <WorkerApprovalGate />
      <DialogHost />
    </AuthProvider>
  );
}
