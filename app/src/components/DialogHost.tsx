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
          {/* Gombok: jobbra zárva egy sorban; ha a feliratok hosszúak (telefonon), a sor megtörik — ilyenkor a fő
              gomb kerül felülre, a másik alá, és egyik sem lóg ki a képernyőről. (row-reverse: a DOM-ban a fő gomb az első.) */}
          <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', justifyContent: 'flex-start', alignItems: 'center', gap: 10, marginTop: 6 }}>
            <Pressable
              onPress={() => close(true)}
              style={({ pressed }) => ({
                paddingVertical: 9, paddingHorizontal: 16, borderRadius: 8, maxWidth: '100%',
                backgroundColor: current.destructive ? C.danger : C.primary,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text style={{ fontWeight: '700', color: '#fff', fontSize: 15, textAlign: 'center' }}>
                {current.alertOnly ? 'OK' : current.okLabel}
              </Text>
            </Pressable>
            {!current.alertOnly ? (
              <Pressable
                onPress={() => close(false)}
                style={({ pressed }) => ({ paddingVertical: 9, paddingHorizontal: 16, borderRadius: 8, maxWidth: '100%', opacity: pressed ? 0.6 : 1 })}
              >
                <Text style={{ fontWeight: '700', color: C.sub, fontSize: 15, textAlign: 'center' }}>{current.cancelLabel ?? 'Mégse'}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}
