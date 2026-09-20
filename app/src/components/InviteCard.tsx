// Munkavállaló meghívása az appba: link (megosztható) vagy QR-kód.

import React, { useState } from 'react';
import { View, Text, Modal, Pressable, Platform, Share, Linking } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { Card, H2, Sub, Body, Btn } from '../ui/kit';
import { C, S } from '../ui/theme';
import { callRpc } from '../lib/repo';
import { useTable } from '../lib/hooks';
import { notify } from '../lib/dialogs';
import { Profile } from '../lib/types';

const APP_ORIGIN = 'https://ktg.szakify.hu';

export function InviteCard({ workerId, workerName, contractor, email, crewMember }: {
  workerId?: string; workerName?: string; contractor?: boolean; email?: string | null;
  /** vállalkozó a MÁR FELVETT emberének készít személyre szóló meghívót (a profilhoz kapcsolódik) */
  crewMember?: boolean;
}) {
  const profiles = useTable<Profile>('profiles');
  const account = workerId ? profiles.find((p) => p.worker_id === workerId) : undefined;
  const generic = !workerId;
  const [link, setLink] = useState<string | null>(null);
  const [qr, setQr] = useState(false);
  const [busy, setBusy] = useState(false);

  const makeLink = async (): Promise<string | null> => {
    if (link) return link;
    setBusy(true);
    try {
      const token = await callRpc<string>('create_worker_invite', { p_worker: workerId ?? null });
      const l = `${APP_ORIGIN}/meghivo?token=${token}${contractor ? '&c=1' : ''}`;
      setLink(l);
      return l;
    } catch (e: any) {
      notify('Hiba', String(e?.message ?? e));
      return null;
    } finally {
      setBusy(false);
    }
  };

  // személyre szóló meghívó e-mailben: a partner levelezője nyílik meg kitöltve
  const sendEmail = async () => {
    const l = await makeLink();
    if (!l || !email) return;
    const subject = 'Meghívó az Építkezés Költségkövető appba';
    const body = `Szia${workerName ? ` ${workerName}` : ''}!\n\nRegisztrálj az Építkezés Költségkövető appba ezzel a linkkel — a fiókod a meglévő munkavállalói profilodhoz kapcsolódik, így a korábbi napjaidat, feladataidat és béredet is látod majd:\n${l}\n\nA link 7 napig érvényes.`;
    try {
      await Linking.openURL(`mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
    } catch {
      notify('Nem sikerült', 'Nem nyílt meg a levelező — másold ki a linket, és küldd el kézzel.');
    }
  };

  const share = async () => {
    if (!link) return;
    const message = contractor
      ? `Szia! Regisztrálj az Építkezés Költségkövető appba ezzel a linkkel, így az én csapatomhoz kerülsz (7 napig érvényes):\n${link}`
      : `Szia${workerName ? ` ${workerName}` : ''}! Regisztrálj az Építkezés Költségkövető appba ezzel a linkkel — az adataid már ki vannak töltve, csak jelszót kell megadnod (7 napig érvényes):\n${link}`;
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
      <H2>{crewMember ? `📲 ${workerName ?? 'Emberem'} meghívása` : contractor ? '📲 Új ember meghívása' : generic ? '📲 Munkavállaló meghívása' : '📲 Meghívás az appba'}</H2>
      {account ? (
        <>
          <Body style={{ fontWeight: '700', color: C.success }}>✅ Regisztrált fiók: {account.email ?? account.display_name}</Body>
          <Sub>A munkavállaló látja a saját feladatait, munkaidejét és napjait — pénzügyet nem.</Sub>
        </>
      ) : (
        <>
          <Sub>{crewMember
            ? 'A linkkel vagy a QR-kód beolvasásával regisztrál: az adatai már ki lesznek töltve, csak jelszót kell megadnia. A fiókja ehhez a meglévő emberedhez kapcsolódik, így a korábbi napjait, munkaidejét és bérét is látni fogja, és továbbra is hozzád tartozik. A meghívó 7 napig érvényes, egyszer használható.'
            : contractor
            ? 'Az embered a linkkel vagy a QR-kód beolvasásával regisztrál, és automatikusan hozzád kerül: a bére emberenként számolódik, de a kifizetés hozzád megy. A meghívó 7 napig érvényes, több ember is használhatja.'
            : generic
            ? 'Nem kell előre felvenned: a munkavállaló a linkkel vagy a QR-kód beolvasásával regisztrál, és maga adja meg a nevét, telefonszámát, szakmáját — a munkavállalói profilja ebből jön létre (becenevet csak te adhatsz neki). A meghívó 7 napig érvényes, több munkavállaló is használhatja (pl. kivetített QR).'
            : 'Ha a munkavállaló ezzel a meghívóval regisztrál, a fiókja ehhez a profilhoz kapcsolódik: a korábban rögzített napjait, feladatait és bérét is látja. A meghívó 7 napig érvényes, egyszer használható.'}</Sub>
          {!generic && !contractor && !crewMember ? (
            email
              ? <Btn title={busy ? '…' : `📧 Meghívó küldése e-mailben (${email})`} onPress={() => void sendEmail()} disabled={busy} />
              : <Sub style={{ color: C.warning }}>Nincs e-mail címe — add meg a Szerkesztésnél, és innen egy gombbal kiküldheted a meghívót.</Sub>
          ) : null}
          {!link ? (
            <Btn title={busy ? '…' : !generic && !contractor ? 'Link / QR-kód készítése' : 'Meghívó készítése'} kind="secondary" onPress={() => void makeLink()} disabled={busy} />
          ) : (
            <>
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
            <Text style={{ fontWeight: '700', color: '#111' }}>{contractor ? 'Csatlakozás a csapatomhoz' : workerName ? `${workerName} — regisztráció` : 'Munkavállalói regisztráció'}</Text>
            <Text style={{ fontSize: 12, color: '#555', textAlign: 'center' }}>Olvasd be a telefon kamerájával, majd regisztrálj.</Text>
          </View>
        </Pressable>
      </Modal>
    </Card>
  );
}
