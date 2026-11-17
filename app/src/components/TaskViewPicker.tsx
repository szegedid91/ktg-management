// Sablon nézet választó (vezetőknek): a feladat oldalán és a feladatlistán is ugyanez a sor — a kiválasztott
// nézet szerint nyílnak / csukódnak a szakaszok a feladat megnyitásakor. A ⚙️ a sablonok szerkesztőjébe visz.

import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { router } from 'expo-router';
import { Sub, st } from '../ui/kit';
import { C, S } from '../ui/theme';
import { useTaskViews, setActiveTaskViewId } from '../lib/taskViewState';

export function TaskViewPicker() {
  const { views, active } = useTaskViews();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: S.sm }}>
      <Sub>👁 Nézet:</Sub>
      {views.map((v) => (
        <Pressable key={v.id} onPress={() => setActiveTaskViewId(v.id)} accessibilityRole="button" accessibilityLabel={`Nézet: ${v.name}`}
          style={[st.chip, active.id === v.id && { backgroundColor: C.primary }]}>
          <Text style={{ color: active.id === v.id ? '#fff' : C.text, fontSize: 13, fontWeight: '600' }}>{v.name}</Text>
        </Pressable>
      ))}
      <Pressable onPress={() => router.push('/task-views')} accessibilityRole="button" accessibilityLabel="Sablon nézetek szerkesztése" style={st.chip}>
        <Text style={{ color: C.text, fontSize: 13, fontWeight: '600' }}>⚙️ Sablonok</Text>
      </Pressable>
    </View>
  );
}
