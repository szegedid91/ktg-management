// Kezdőlapi teendő-csempe: ikon, cím, darabszám, részlet — koppintásra a
// szűrt listára visz.
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { router } from 'expo-router';
import { C, S } from '../ui/theme';

export function Todo({ icon, title, count, detail, color, href }: {
  icon: string; title: string; count: number; detail: string; color: string; href: string;
}) {
  return (
    <Pressable onPress={() => router.push(href as any)} style={({ pressed }) => ({
      flexDirection: 'row', alignItems: 'center', gap: S.md,
      backgroundColor: C.card, borderRadius: S.radiusSm, borderWidth: 1, borderColor: C.border,
      borderLeftWidth: 5, borderLeftColor: color, padding: S.md, opacity: pressed ? 0.8 : 1,
    })}>
      <Text style={{ fontSize: 22, width: 30, textAlign: 'center', color }}>{icon}</Text>
      <View style={{ flex: 1 }}>
        <Text style={{ fontWeight: '800', color: C.text }}>{title}</Text>
        <Text style={{ fontSize: 12, color: C.sub }}>{detail}</Text>
      </View>
      <Text style={{ fontSize: 22, fontWeight: '900', color }}>{count}</Text>
      <Text style={{ color: C.sub }}>›</Text>
    </Pressable>
  );
}
