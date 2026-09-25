// Munkamenet (kezdés → befejezés) sora a vezetőnek, utólagos
// javítással: ha a munkavállaló elfelejtette leállítani, itt lezárható vagy
// az idők átírhatók. A bér a mentés után automatikusan újraszámolódik.

import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { Sub, Input, Btn } from '../ui/kit';
import { C, S } from '../ui/theme';
import { updateRow, softDeleteRow } from '../lib/repo';
import { hdt, localDateISO } from '../lib/format';
import { useTable } from '../lib/hooks';
import { fmtHours, sessionHours } from '../lib/tasks';
import { notify, confirmDialog } from '../lib/dialogs';
import { WorkSession, Attendance } from '../lib/types';

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
  // a nap már ki van fizetve? — akkor a bér befagyott: a módosítás csak a kifizetés visszavonása után számolódik újra
  const attendance = useTable<Attendance>('attendance');
  const paidDay = attendance.find((a) => a.worker_id === session.worker_id && a.site_id === session.site_id
    && a.work_date === localDateISO(session.started_at) && a.source === 'session' && !!a.paid_at);
  const PAID_HINT = 'Ez a nap már ki van fizetve, ezért a bér NEM számolódik újra. Ha a bérnek is változnia kell, a Kifizetetlen bérek / munkavállaló adatlapján vond vissza a nap kifizetését — akkor újraszámolódik —, majd jelöld újra kifizetettnek.';

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
    notify('Mentve ✅', paidDay ? `A munkaidő módosult. ${PAID_HINT}` : 'A munkaidő módosult, a bér újraszámolódik.');
  };
  const closeNow = async () => {
    if (!await confirmDialog('Munkamenet lezárása', `${label ? `${label}: ` : ''}kezdés ${hdt(session.started_at)}. Lezárod most?`, 'Lezárás')) return;
    updateRow('work_sessions', session.id, { ended_at: new Date().toISOString() });
  };

  // ha a menet a szerverre jóval a (kezdés/)befejezés után érkezett meg (a
  // telefon offline volt, később szinkronizált), ezt jelezzük: a bérhez a
  // gombnyomás ideje számít, de látszik, mikor lett ténylegesen rögzítve
  const eventAt = session.ended_at ?? session.started_at;
  // téves / duplán rögzített menet törlése — a bér a nap többi menetéből újraszámolódik
  const remove = async () => {
    const ok = await confirmDialog('Munkaidő törlése',
      `${label ? `${label}: ` : ''}${hdt(session.started_at)} → ${session.ended_at ? hdt(session.ended_at) : 'fut'} · ${fmtHours(sessionHours(session))}\n\n${paidDay ? PAID_HINT : 'A menet törlődik, a nap bére a megmaradt munkaidőből számolódik újra.'}`,
      'Törlés', true);
    if (!ok) return;
    softDeleteRow('work_sessions', session.id);
    notify('Törölve 🗑️', 'A munkaidő-menet törölve, a bér újraszámolódott.');
  };
  const syncLagMin = session.updated_at ? Math.round((new Date(session.updated_at).getTime() - new Date(eventAt).getTime()) / 60000) : 0;
  const lateSync = syncLagMin >= 5;

  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
        <Sub style={{ flex: 1 }}>
          {label ? `${label}: ` : ''}{hdt(session.started_at)} → {session.ended_at ? hdt(session.ended_at) : <Text style={{ color: C.success, fontWeight: '700' }}>folyamatban</Text>} · {fmtHours(sessionHours(session))}
          {lateSync ? <Text style={{ color: C.warning }}>{` · ☁️ rögzítve ${hdt(session.updated_at!)} (${syncLagMin} perccel később szinkronizált)`}</Text> : null}
        </Sub>
        {editable && !open ? <Btn title={running ? 'Lezárás' : '✏️'} kind="ghost" small onPress={running ? () => void closeNow() : begin} /> : null}
        {editable && !open && running ? <Btn title="✏️" kind="ghost" small onPress={begin} /> : null}
        {editable && !open ? <Btn title="🗑️" kind="ghost" small onPress={() => void remove()} /> : null}
      </View>
      {open ? (
        <View style={{ gap: S.sm, backgroundColor: C.bg, borderRadius: 8, padding: S.sm }}>
          <Input label="Kezdés (ÉÉÉÉ-HH-NN ÓÓ:PP)" value={start} onChangeText={setStart} placeholder="2026-09-17 07:30" />
          <Input label="Befejezés (üres = még fut)" value={end} onChangeText={setEnd} placeholder="2026-09-17 16:00" />
          <View style={{ flexDirection: 'row', gap: S.sm }}>
            <View style={{ flex: 1 }}><Btn title="Mégse" kind="ghost" small onPress={() => setOpen(false)} /></View>
            <View style={{ flex: 2 }}><Btn title="Mentés" small onPress={save} /></View>
          </View>
          {paidDay ? <Sub style={{ fontSize: 11, color: C.warning }}>⚠️ {PAID_HINT}</Sub> : null}
          <Sub style={{ fontSize: 11 }}>A munkavállaló a saját menetét csak lezárni tudja; az utólagos javítás a vezetők joga. Órabérnél minden megkezdett óra teljes óra.</Sub>
        </View>
      ) : null}
    </View>
  );
}
