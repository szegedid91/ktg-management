// Munkamenet (kezdés → befejezés) sora a vezetőnek, utólagos
// javítással: ha a munkavállaló elfelejtette leállítani, itt lezárható vagy
// az idők átírhatók. A bér a mentés után automatikusan újraszámolódik.

import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { Sub, Input, Btn } from '../ui/kit';
import { C, S } from '../ui/theme';
import { updateRow } from '../lib/repo';
import { hdt } from '../lib/format';
import { fmtHours, sessionHours } from '../lib/tasks';
import { notify, confirmDialog } from '../lib/dialogs';
import { WorkSession } from '../lib/types';

const pad = (n: number) => String(n).padStart(2, '0');
/** ISO → helyi „ÉÉÉÉ-HH-NN ÓÓ:PP” */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** helyi „ÉÉÉÉ-HH-NN ÓÓ:PP” → ISO (vagy null, ha hibás) */
export function fromLocalInput(text: string): string | null {
  const m = text.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export function SessionEditor({ session, label, editable }: { session: WorkSession; label?: string; editable: boolean }) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const running = !session.ended_at;

  const begin = () => { setStart(toLocalInput(session.started_at)); setEnd(toLocalInput(session.ended_at) || toLocalInput(new Date().toISOString())); setOpen(true); };
  const save = () => {
    const s = fromLocalInput(start);
    const e = end.trim() ? fromLocalInput(end) : null;
    if (!s) { notify('Hiba', 'A kezdést ÉÉÉÉ-HH-NN ÓÓ:PP formában add meg.'); return; }
    if (end.trim() && !e) { notify('Hiba', 'A befejezést ÉÉÉÉ-HH-NN ÓÓ:PP formában add meg (vagy hagyd üresen, ha még fut).'); return; }
    if (e && e <= s) { notify('Hiba', 'A befejezés a kezdés után kell legyen.'); return; }
    const nowIso = new Date().toISOString();
    if (s > nowIso || (e && e > nowIso)) { notify('Hiba', 'Jövőbeli időpont nem adható meg.'); return; }
    if (e && (new Date(e).getTime() - new Date(s).getTime()) > 16 * 3.6e6) { notify('Hiba', 'Egy munkamenet legfeljebb 16 óra lehet — bontsd kettőbe.'); return; }
    updateRow('work_sessions', session.id, { started_at: s, ended_at: e });
    setOpen(false);
    notify('Mentve ✅', 'A munkaidő módosult, a bér újraszámolódik.');
  };
  const closeNow = async () => {
    if (!await confirmDialog('Munkamenet lezárása', `${label ? `${label}: ` : ''}kezdés ${hdt(session.started_at)}. Lezárod most?`, 'Lezárás')) return;
    updateRow('work_sessions', session.id, { ended_at: new Date().toISOString() });
  };

  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
        <Sub style={{ flex: 1 }}>
          {label ? `${label}: ` : ''}{hdt(session.started_at)} → {session.ended_at ? hdt(session.ended_at) : <Text style={{ color: C.success, fontWeight: '700' }}>folyamatban</Text>} · {fmtHours(sessionHours(session))}
        </Sub>
        {editable && !open ? <Btn title={running ? 'Lezárás' : '✏️'} kind="ghost" small onPress={running ? () => void closeNow() : begin} /> : null}
        {editable && !open && running ? <Btn title="✏️" kind="ghost" small onPress={begin} /> : null}
      </View>
      {open ? (
        <View style={{ gap: S.sm, backgroundColor: C.bg, borderRadius: 8, padding: S.sm }}>
          <Input label="Kezdés (ÉÉÉÉ-HH-NN ÓÓ:PP)" value={start} onChangeText={setStart} placeholder="2026-09-17 07:30" />
          <Input label="Befejezés (üres = még fut)" value={end} onChangeText={setEnd} placeholder="2026-09-17 16:00" />
          <View style={{ flexDirection: 'row', gap: S.sm }}>
            <View style={{ flex: 1 }}><Btn title="Mégse" kind="ghost" small onPress={() => setOpen(false)} /></View>
            <View style={{ flex: 2 }}><Btn title="Mentés" small onPress={save} /></View>
          </View>
          <Sub style={{ fontSize: 11 }}>A munkavállaló a saját menetét csak lezárni tudja; az utólagos javítás a vezetők joga. Órabérnél minden megkezdett óra teljes óra.</Sub>
        </View>
      ) : null}
    </View>
  );
}
