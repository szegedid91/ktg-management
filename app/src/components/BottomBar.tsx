// Állandó alsó menüsor — minden képernyőn látszik (a belépőn nem).
// A Kezdőlap/Függőben/Több oldalra visz, a +Költség és +Jelenlét
// gombok a rögzítő űrlapokat nyitják.

import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { router, usePathname } from 'expo-router';
import { useAuth } from '../lib/auth';
import { C, S } from '../ui/theme';
import { todayISO } from '../lib/format';

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
  if (!session) return null;

  return (
    <View
      style={{
        flexDirection: 'row', backgroundColor: C.card,
        borderTopWidth: 1, borderTopColor: C.border,
        paddingBottom: 6, paddingTop: 6,
      }}
    >
      {ITEMS.map((item) => {
        const active = item.activePrefix === '/'
          ? pathname === '/'
          : item.activePrefix ? pathname.startsWith(item.activePrefix) : false;
        return (
          <Pressable
            key={item.label}
            onPress={item.action}
            style={({ pressed }) => ({
              flex: 1, alignItems: 'center', gap: 2, opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text style={{ fontSize: 20, opacity: active ? 1 : 0.45 }}>{item.icon}</Text>
            <Text style={{ fontSize: 10, fontWeight: active ? '700' : '500', color: active ? C.primary : C.sub }}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
