// Állandó alsó menüsor — minden képernyőn látszik (a belépőn nem).
// A Kezdőlap/Függőben/Feladatok/Több oldalra visz, a +Költség a rögzítő
// űrlapot nyitja. (Jelenlét-rögzítés az építkezéseknél.)

import React from 'react';
import { View, Text, Pressable, Platform } from 'react-native';
import { router, usePathname } from 'expo-router';
import { useAuth } from '../lib/auth';
import { useTable } from '../lib/hooks';
import { C, S } from '../ui/theme';
import { Profile } from '../lib/types';

/** Fül-váltás: a navigációs verem kiürül, és a választott oldal lesz az egyetlen képernyő. Korábban minden
 *  koppintás ÚJ képernyőt tett a verem tetejére — a régiek a háttérben tovább éltek (és minden adatváltozásra
 *  újraszámoltak), egy hosszú munkamenet végére az app belassult, a gombok nem reagáltak. */
function goTab(path: '/' | '/finance' | '/tasks' | '/more') {
  try { if (router.canDismiss()) router.dismissAll(); } catch { /* nincs mit bezárni */ }
  router.replace(path);
}

const ITEMS: { icon: string; label: string; action: () => void; activePrefix?: string }[] = [
  { icon: '🏠', label: 'Kezdőlap', action: () => goTab('/'), activePrefix: '/' },
  { icon: '💸', label: '+ Költség', action: () => router.push('/expense/new') },
  { icon: '💰', label: 'Pénzügy', action: () => goTab('/finance'), activePrefix: '/finance' },
  { icon: '🛠️', label: 'Feladatok', action: () => goTab('/tasks'), activePrefix: '/tasks' },
  { icon: '☰', label: 'Több', action: () => goTab('/more'), activePrefix: '/more' },
];

export function BottomBar() {
  const { session } = useAuth();
  const pathname = usePathname();
  const profiles = useTable<Profile>('profiles');
  if (!session) return null;
  // munkavállalói fiók: kezdőlap + feladatok + Több (kijelentkezés)
  const isWorker = !!profiles.find((p) => p.id === session.user.id)?.worker_id;
  const items = isWorker ? ITEMS.filter((i) => ['Kezdőlap', 'Feladatok', 'Több'].includes(i.label)) : ITEMS;

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
