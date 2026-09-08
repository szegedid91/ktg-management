// Állandó alsó menüsor — minden képernyőn látszik (a belépőn nem).
// A Kezdőlap/Függőben/Több oldalra visz, a +Költség és +Jelenlét
// gombok a rögzítő űrlapokat nyitják.

import React from 'react';
import { View, Text, Pressable, Platform } from 'react-native';
import { router, usePathname } from 'expo-router';
import { useAuth } from '../lib/auth';
import { useTable } from '../lib/hooks';
import { C, S } from '../ui/theme';
import { todayISO } from '../lib/format';
import { Profile } from '../lib/types';

const ITEMS: { icon: string; label: string; action: () => void; activePrefix?: string }[] = [
  { icon: '🏠', label: 'Kezdőlap', action: () => router.navigate('/'), activePrefix: '/' },
  { icon: '💸', label: '+ Költség', action: () => router.push('/expense/new') },
  { icon: '⏳', label: 'Függőben', action: () => router.navigate('/pending'), activePrefix: '/pending' },
  { icon: '👷', label: '+ Jelenlét', action: () => router.push(`/day/${todayISO()}`) },
  { icon: '☰', label: 'Több', action: () => router.navigate('/more'), activePrefix: '/more' },
];

export function BottomBar() {
  const { session } = useAuth();
  const pathname = usePathname();
  const profiles = useTable<Profile>('profiles');
  if (!session) return null;
  // munkavállalói fiók: csak a saját kezdőlap + a Több (kijelentkezés)
  const isWorker = !!profiles.find((p) => p.id === session.user.id)?.worker_id;
  const items = isWorker ? ITEMS.filter((i) => i.label === 'Kezdőlap' || i.label === 'Több') : ITEMS;

  return (
    <View
      style={{
        flexDirection: 'row', backgroundColor: C.card,
        borderTopWidth: 1, borderTopColor: C.border,
        paddingTop: 4,
        // iPhone home-indicator sáv: kezdőképernyőre telepített (PWA)
        // módban a sáv ne lógjon a kijelző aljára — de a teljes 34px-es
        // inset túl sok üres helyet hagyna, a gombok mehetnek kicsit lejjebb
        paddingBottom: Platform.OS === 'web'
          ? ('max(4px, calc(env(safe-area-inset-bottom) - 12px))' as any)
          : 6,
      }}
    >
      {items.map((item) => {
        const active = item.activePrefix === '/'
          ? pathname === '/'
          : item.activePrefix ? pathname.startsWith(item.activePrefix) : false;
        return (
          <Pressable
            key={item.label}
            onPress={item.action}
            style={({ pressed }) => ({
              flex: 1, alignItems: 'center', gap: 1, opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text style={{ fontSize: 19, opacity: active ? 1 : 0.45 }}>{item.icon}</Text>
            <Text style={{ fontSize: 10, fontWeight: active ? '700' : '500', color: active ? C.primary : C.sub }}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
