import React from 'react';
import { Stack } from 'expo-router';
import { AuthProvider } from '../lib/auth';
import { C } from '../ui/theme';

export default function RootLayout() {
  return (
    <AuthProvider>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: C.primary },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: C.bg },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="site/new" options={{ title: 'Új építkezés' }} />
        <Stack.Screen name="site/[id]" options={{ title: 'Építkezés' }} />
        <Stack.Screen name="expense/new" options={{ title: 'Költség rögzítése' }} />
        <Stack.Screen name="expense/[id]" options={{ title: 'Költség' }} />
        <Stack.Screen name="workers/index" options={{ title: 'Munkavállalók' }} />
        <Stack.Screen name="worker/new" options={{ title: 'Új munkavállaló' }} />
        <Stack.Screen name="worker/[id]" options={{ title: 'Munkavállaló' }} />
        <Stack.Screen name="day/[date]" options={{ title: 'Napi jelenlét' }} />
        <Stack.Screen name="invoices/index" options={{ title: 'Kimenő számlák' }} />
        <Stack.Screen name="invoice/new" options={{ title: 'Új számla' }} />
        <Stack.Screen name="invoice/[id]" options={{ title: 'Számla' }} />
        <Stack.Screen name="stats" options={{ title: 'Statisztika' }} />
        <Stack.Screen name="equipment" options={{ title: 'Eszközök' }} />
        <Stack.Screen name="settings" options={{ title: 'Beállítások' }} />
        <Stack.Screen name="audit" options={{ title: 'Audit napló' }} />
        <Stack.Screen name="export" options={{ title: 'Export könyvelőnek' }} />
      </Stack>
    </AuthProvider>
  );
}
