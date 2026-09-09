// Értesítés-harang a fejléc sarkában: olvasatlan darabszám jelvénnyel.
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '../lib/auth';
import { useTable } from '../lib/hooks';
import { AppNotification } from '../lib/types';

export function HeaderBell() {
  const { session } = useAuth();
  const notes = useTable<AppNotification>('notification_queue');
  if (!session) return null;
  const unread = notes.filter((n) => !n.read_at).length;
  return (
    <Pressable onPress={() => router.push('/notifications')} hitSlop={10}
      accessibilityLabel={`Értesítések${unread ? `, ${unread} olvasatlan` : ''}`}
      style={({ pressed }) => ({ paddingHorizontal: 10, paddingVertical: 4, opacity: pressed ? 0.6 : 1 })}>
      <View>
        <Text style={{ fontSize: 22 }}>🔔</Text>
        {unread > 0 ? (
          <View style={{ position: 'absolute', top: -4, right: -8, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: '#C0392B',
            alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, borderWidth: 1.5, borderColor: '#fff' }}>
            <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>{unread > 99 ? '99+' : unread}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}
