// Mennyiségi egység választó az anyagköltséghez: listából választható; ami nincs benne, hozzáadható, és
// utána megmarad a felhasználó listájában (csak neki — és ha vállalkozó, az embereinek).

import React, { useState } from 'react';
import { View, Text, Pressable, Modal, ScrollView } from 'react-native';
import { Btn, Input, st } from '../ui/kit';
import { C, S, F } from '../ui/theme';
import { useTable } from '../lib/hooks';
import { getCurrentUserId, insertRow, softDeleteRow } from '../lib/repo';
import { confirmDialog } from '../lib/dialogs';
import { MaterialUnit } from '../lib/types';
import { unitOptions, findUnit, cleanUnit, UNIT_MAX } from '../lib/units';

export function UnitPicker({ label = 'Egység', value, onChange, placeholder = 'Válassz…' }: {
  label?: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  const rows = useTable<MaterialUnit>('material_units');
  const me = getCurrentUserId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const options = unitOptions(rows, me, value);
  const pick = (name: string) => { onChange(name); setOpen(false); setDraft(''); };

  const add = () => {
    const name = cleanUnit(draft);
    if (!name) return;
    // ha már van ilyen (kis- / nagybetűtől függetlenül), azt választjuk — nem lesz belőle ismétlés
    const existing = findUnit(options, name);
    if (!existing) insertRow<MaterialUnit>('material_units', { name });
    pick(existing ?? name);
  };

  const remove = async (id: string, name: string) => {
    if (!await confirmDialog('Egység törlése', `Kiveszed a(z) „${name}” egységet a listádból? A már rögzített tételeken megmarad.`, 'Törlés', true)) return;
    softDeleteRow('material_units', id);
  };

  return (
    <View style={{ gap: 4 }}>
      {label ? <Text style={st.label}>{label}</Text> : null}
      <Pressable style={st.input} onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={`${label}: ${value || 'nincs kiválasztva'}`}>
        <Text style={{ color: value ? C.text : C.sub, fontSize: 15 }}>{value || placeholder}</Text>
      </Pressable>
      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <Pressable style={st.modalBg} onPress={() => setOpen(false)}>
          <Pressable style={st.modalSheet} onPress={() => {}}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Pressable style={st.modalRow} onPress={() => pick('')}>
                <Text style={[F.body, { color: C.sub }]}>— nincs egység —</Text>
              </Pressable>
              {options.map((o) => (
                <View key={o.name} style={[st.modalRow, { flexDirection: 'row', alignItems: 'center', gap: S.sm }]}>
                  <Pressable style={{ flex: 1 }} onPress={() => pick(o.name)} accessibilityRole="button" accessibilityLabel={`Egység: ${o.name}`}>
                    <Text style={[F.body, o.name === value ? { fontWeight: '800', color: C.primary } : null]}>{o.name}{o.name === value ? '  ✓' : ''}</Text>
                  </Pressable>
                  {o.own && o.rowId ? (
                    <Pressable onPress={() => void remove(o.rowId!, o.name)} hitSlop={8} accessibilityLabel={`${o.name} törlése a listámból`}>
                      <Text style={{ fontSize: 16 }}>🗑️</Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}
              <View style={{ padding: S.md, gap: S.sm }}>
                <Text style={F.sub}>Nincs a listában? Add hozzá — utána mindig ott lesz a listádban.</Text>
                <View style={{ flexDirection: 'row', gap: S.sm, alignItems: 'flex-end' }}>
                  <View style={{ flex: 1 }}>
                    <Input value={draft} onChangeText={(t) => setDraft(t.slice(0, UNIT_MAX))} placeholder="új egység, pl. vödör" autoCapitalize="none" />
                  </View>
                  <Btn title="+ Hozzáad" kind="secondary" small disabled={!cleanUnit(draft)} onPress={add} />
                </View>
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
