import React from 'react';
import { Text } from 'react-native';
import { Tabs, Redirect } from 'expo-router';
import { useAuth } from '../../lib/auth';
import { C } from '../../ui/theme';
import { Loading } from '../../ui/kit';

function icon(emoji: string) {
  return ({ focused }: { focused: boolean }) => (
    <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.45 }}>{emoji}</Text>
  );
}

export default function TabsLayout() {
  const { session, loading } = useAuth();
  if (loading) return <Loading />;
  if (!session) return <Redirect href="/login" />;

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: C.primary },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '700' },
        tabBarActiveTintColor: C.primary,
        tabBarInactiveTintColor: C.sub,
        tabBarStyle: { backgroundColor: C.card },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Kezdőlap', tabBarIcon: icon('🏠') }} />
      <Tabs.Screen name="sites" options={{ title: 'Építkezések', tabBarIcon: icon('🏗️') }} />
      <Tabs.Screen name="calendar" options={{ title: 'Naptár', tabBarIcon: icon('📅') }} />
      <Tabs.Screen name="settlement" options={{ title: 'Elszámolás', tabBarIcon: icon('🤝') }} />
      <Tabs.Screen name="more" options={{ title: 'Több', tabBarIcon: icon('☰') }} />
    </Tabs>
  );
}
