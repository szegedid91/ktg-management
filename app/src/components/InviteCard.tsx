// Munkavállaló meghívása az appba: link (megosztható) vagy QR-kód.

import React, { useState } from 'react';
import { View, Text, Modal, Pressable, Platform, Share } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { Card, H2, Sub, Body, Btn } from '../ui/kit';
import { C, S } from '../ui/theme';
import { callRpc } from '../lib/repo';
import { useTable } from '../lib/hooks';
import { notify } from '../lib/dialogs';
import { Profile } from '../lib/types';

const APP_ORIGIN = 'https://ktg.szakify.hu';

export function InviteCard({ workerId, workerName }: { workerId?: string; workerName?: string }) {
  const profiles = useTable<Profile>('profiles');
  const account = workerId ? profiles.find((p) => p.worker_id === workerId) : undefined;
  const generic = !workerId;
  const [link, setLink] = useState<string | null>(null);
  const [qr, setQr] = useState(false);
  const [busy, setBusy] = useState(false);

  const makeLink = async () => {
    setBusy(true);
    try {
      const token = await callRpc<string>('create_worker_invite', { p_worker: workerId ?? null });
      setLink(`${APP_ORIGIN}/meghivo?token=${token}`);
    } catch (e: any) {
      notify('Hiba', String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    if (!link) return;
    const message = `Szia${workerName ? ` ${workerName}` : ''}! Regisztrálj az Építkezés Költségkövető appba ezzel a linkkel (7 napig érvényes):\n${link}`;
    try {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && (navigator as any).share) {
        await (navigator as any).share({ title: 'Meghívó', text: message });
      } else if (Platform.OS === 'web') {
        await (navigator as any).clipboard?.writeText(link);
        notify('Link kimásolva', 'A meghívó linket a vágólapra másoltuk — küldd el a munkavállalónak.');
      } else {
        await Share.share({ message });
      }
    } catch {
      // megosztás megszakítva
    }
  };

  return (
    <Card>
      <H2>{generic ? '📲 Munkavállaló meghívása' : '📲 Meghívás az appba'}</H2>
      {account ? (
        <>
          <Body style={{ fontWeight: '700', color: C.success }}>✅ Regisztrált fiók: {account.email ?? account.display_name}</Body>
          <Sub>A munkavállaló látja a saját feladatait, munkaidejét és napjait — pénzügyet nem.</Sub>
        </>
      ) : (
        <>
          <Sub>{generic
            ? 'Nem kell előre felvenned: a munkavállaló a linkkel vagy a QR-kód beolvasásával regisztrál, és maga adja meg a nevét, becenevét, telefonszámát — a munkavállalói profilja ebből jön létre. A meghívó 7 napig érvényes, több munkavállaló is használhatja (pl. kivetített QR).'
            : 'A munkavállaló a linkkel vagy a QR-kód beolvasásával tud saját fiókot készíteni. A meghívó 7 napig érvényes, egyszer használható.'}</Sub>
          {!link ? (
            <Btn title={busy ? '…' : 'Meghívó készítése'} kind="secondary" onPress={() => void makeLink()} disabled={busy} />
          ) : (
            <>
              <Text selectable style={{ fontSize: 12, color: C.sub }}>{link}</Text>
              <View style={{ flexDirection: 'row', gap: S.sm }}>
                <View style={{ flex: 1 }}><Btn title="Küldés / másolás" small onPress={() => void share()} /></View>
                <View style={{ flex: 1 }}><Btn title="QR-kód mutatása" kind="secondary" small onPress={() => setQr(true)} /></View>
              </View>
            </>
          )}
        </>
      )}

      <Modal visible={qr} transparent animationType="fade" onRequestClose={() => setQr(false)}>
        <Pressable style={{ flex: 1, backgroundColor: '#000a', alignItems: 'center', justifyContent: 'center' }} onPress={() => setQr(false)}>
          <View style={{ backgroundColor: '#fff', padding: 24, borderRadius: 16, alignItems: 'center', gap: 12 }}>
            {link ? <QRCode value={link} size={240} /> : null}
            <Text style={{ fontWeight: '700', color: '#111' }}>{workerName ? `${workerName} — regisztráció` : 'Munkavállalói regisztráció'}</Text>
            <Text style={{ fontSize: 12, color: '#555', textAlign: 'center' }}>Olvasd be a telefon kamerájával, majd regisztrálj.</Text>
          </View>
        </Pressable>
      </Modal>
    </Card>
  );
}
