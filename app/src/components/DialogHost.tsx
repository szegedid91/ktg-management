// Appon belüli megerősítő/értesítő ablak — a lib/dialogs.ts ide
// irányítja a notify/confirmDialog hívásokat. Egyszerre egy ablak
// látszik, a többi sorban áll.

import React, { useEffect, useState } from 'react';
import { Modal, View, Text, Pressable } from 'react-native';
import { registerDialogHost, DialogRequest } from '../lib/dialogs';
import { C } from '../ui/theme';

export function DialogHost() {
  const [queue, setQueue] = useState<DialogRequest[]>([]);
  useEffect(() => registerDialogHost((r) => setQueue((q) => [...q, r])), []);

  const current = queue[0];
  const close = (ok: boolean) => {
    current?.resolve(ok);
    setQueue((q) => q.slice(1));
  };

  if (!current) return null;
  return (
    <Modal transparent animationType="fade" visible onRequestClose={() => close(false)}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <View style={{ backgroundColor: C.card, borderRadius: 14, padding: 20, width: '100%', maxWidth: 420, gap: 10, borderWidth: 1, borderColor: C.border }}>
          <Text style={{ fontSize: 17, fontWeight: '800', color: C.text }}>{current.title}</Text>
          {current.message ? (
            <Text style={{ fontSize: 15, color: C.text, lineHeight: 21 }}>{current.message}</Text>
          ) : null}
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 6 }}>
            {!current.alertOnly ? (
              <Pressable
                onPress={() => close(false)}
                style={({ pressed }) => ({ paddingVertical: 9, paddingHorizontal: 16, borderRadius: 8, opacity: pressed ? 0.6 : 1 })}
              >
                <Text style={{ fontWeight: '700', color: C.sub, fontSize: 15 }}>Mégse</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => close(true)}
              style={({ pressed }) => ({
                paddingVertical: 9, paddingHorizontal: 16, borderRadius: 8,
                backgroundColor: current.destructive ? C.danger : C.primary,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text style={{ fontWeight: '700', color: '#fff', fontSize: 15 }}>
                {current.alertOnly ? 'OK' : current.okLabel}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
