import React from 'react';
import { Text } from 'react-native';
import { Tabs, Redirect, router } from 'expo-router';
import { useAuth } from '../../lib/auth';
import { C } from '../../ui/theme';
import { Loading } from '../../ui/kit';
import { todayISO } from '../../lib/format';

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
      <Tabs.Screen
        name="add-expense"
        options={{ title: '+ Költség', tabBarIcon: icon('💸') }}
        listeners={{
          tabPress: (e) => {
            e.preventDefault();
            router.push('/expense/new');
          },
        }}
      />
      <Tabs.Screen
        name="add-attendance"
        options={{ title: '+ Jelenlét', tabBarIcon: icon('👷') }}
        listeners={{
          tabPress: (e) => {
            e.preventDefault();
            router.push(`/day/${todayISO()}`);
          },
        }}
      />
      <Tabs.Screen name="settlement" options={{ title: 'Elszámolás', tabBarIcon: icon('🤝') }} />
      <Tabs.Screen name="more" options={{ title: 'Több', tabBarIcon: icon('☰') }} />
    </Tabs>
  );
}
