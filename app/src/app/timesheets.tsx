// Óralapok (fő felhasználóknak): a munkavállalók heti óráinak jóváhagyása.
// A munkaidőből automatikusan képződött bér csak jóváhagyott hét után
// fizethető ki. A beküldött heteken kívül a még nem jóváhagyott, de bért
// tartalmazó heteket is listázzuk, hogy beküldés nélkül is jóvá lehessen hagyni.

import React, { useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { Screen, Card, H2, Sub, Body, Btn, Badge, Input, Empty, Segmented } from '../ui/kit';
import { C, S } from '../ui/theme';
import { useTable } from '../lib/hooks';
import { callRpc, getCurrentUserId } from '../lib/repo';
import { syncNow } from '../lib/sync';
import { ft, hd, todayISO, localDateISO, addDaysISO } from '../lib/format';
import { notify, confirmDialog } from '../lib/dialogs';
import { weekStartISO, wname } from '../lib/tasks';
import { Timesheet, Worker, Attendance, WorkSession, Profile } from '../lib/types';

type Row = {
  key: string; worker: Worker; week: string; sheet: Timesheet | null;
  hours: number; amount: number; days: number; status: Timesheet['status'];
};

const STATUS_LABEL: Record<Timesheet['status'], string> = {
  open: 'nincs beküldve', submitted: 'jóváhagyásra vár', approved: 'jóváhagyva', rejected: 'visszaküldve',
};
const STATUS_COLOR: Record<Timesheet['status'], string> = {
  open: '#718096', submitted: '#B7791F', approved: '#2F855A', rejected: '#C53030',
};

export default function Timesheets() {
  const me = getCurrentUserId();
  const profiles = useTable<Profile>('profiles');
  const isWorker = !!profiles.find((p) => p.id === me)?.worker_id;
  const workers = useTable<Worker>('workers').filter((w) => !!w.approved_at);
  const sheets = useTable<Timesheet>('timesheets');
  const attendance = useTable<Attendance>('attendance');
  const sessions = useTable<WorkSession>('work_sessions');
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const rows = useMemo<Row[]>(() => {
    const accountIds = new Set(profiles.filter((p) => p.worker_id).map((p) => p.worker_id as string));
    // fiókos munkavállaló, vagy fiókos vállalkozó embere (az ő óralapja alá esik)
    const hasAccount = new Set(workers.filter((w) => accountIds.has(w.id) || (w.contractor_id && accountIds.has(w.contractor_id))).map((w) => w.id));
    const map = new Map<string, Row>();
    const ensure = (w: Worker, week: string) => {
      const key = `${w.id}|${week}`;
      let r = map.get(key);
      if (!r) {
        r = { key, worker: w, week, sheet: null, hours: 0, amount: 0, days: 0, status: 'open' };
        map.set(key, r);
      }
      return r;
    };
    // beküldött / eldöntött lapok
    for (const t of sheets) {
      const w = workers.find((x) => x.id === t.worker_id);
      if (!w) continue;
      const r = ensure(w, t.week_start);
      r.sheet = t; r.status = t.status; r.hours = Number(t.hours); r.amount = Number(t.amount); r.days = Number(t.days);
    }
    // fiókos munkavállalók automatikus bér-sorai lap nélkül → „nincs beküldve”
    for (const a of attendance) {
      if (!(a.source === 'session' || a.source === 'task') || !hasAccount.has(a.worker_id)) continue;
      const w = workers.find((x) => x.id === a.worker_id);
      if (!w) continue;
      ensure(w, weekStartISO(a.work_date));
    }
    // lap nélküli hét összege: a hét minden nem-jelenléti bér-sora (mint fn_timesheet_totals)
    for (const r of map.values()) {
      if (r.sheet) continue;
      r.amount = attendance.filter((a) => a.worker_id === r.worker.id && a.pay_basis !== 'presence' && weekStartISO(a.work_date) === r.week)
        .reduce((sum, a) => sum + Number(a.amount) - Number(a.commission_amount), 0);
    }
    // órák a munkamenetekből (lap nélküli heteknél)
    for (const r of map.values()) {
      if (r.sheet) continue;
      const own = sessions.filter((s) => s.worker_id === r.worker.id && s.ended_at && weekStartISO(localDateISO(s.started_at)) === r.week);
      // megkezdett órák naponként és építkezésenként (mint a szerveren)
      const byDay = new Map<string, number>();
      for (const s of own) {
        const k = `${localDateISO(s.started_at)}|${s.site_id ?? ''}`;
        byDay.set(k, (byDay.get(k) ?? 0) + (new Date(s.ended_at!).getTime() - new Date(s.started_at).getTime()) / 3.6e6);
      }
      r.hours = [...byDay.values()].reduce((sum, h) => sum + Math.ceil(Math.round(h * 1e4) / 1e4), 0);
      r.days = new Set(attendance.filter((a) => a.worker_id === r.worker.id && weekStartISO(a.work_date) === r.week).map((a) => a.work_date)).size;
    }
    return [...map.values()].sort((a, b) => b.week.localeCompare(a.week) || wname(a.worker).localeCompare(wname(b.worker), 'hu'));
  }, [sheets, attendance, sessions, workers, profiles]);

  if (isWorker) return <Screen><Empty text="Nincs jogosultságod ehhez az oldalhoz." /></Screen>;

  const shown = rows.filter((r) => filter === 'all' || r.status === 'submitted' || r.status === 'open');
  const thisWeek = weekStartISO(todayISO());

  const decide = async (r: Row, approve: boolean) => {
    if (approve && !await confirmDialog('Óralap jóváhagyása',
      `${wname(r.worker)} · ${hd(r.week)} hete · ${r.hours.toFixed(1)} óra · ${ft(r.amount)}\n\nJóváhagyás után a bér kifizethető. Rendben?`, 'Jóváhagyom')) return;
    setBusy(r.key);
    try {
      await callRpc('decide_timesheet', { p_worker: r.worker.id, p_week_start: r.week, p_approve: approve, p_note: note.trim() || null });
      void syncNow();
      setNoteFor(null); setNote('');
      notify(approve ? 'Jóváhagyva ✅' : 'Visszaküldve', approve ? 'A munkavállaló értesítést kapott, a bér kifizethető.' : 'A munkavállaló értesítést kapott az indokkal.');
    } catch (e: any) {
      notify('Hiba', String(e?.message ?? e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen>
      <Sub>A munkaidőből képződött bér csak jóváhagyott hét után fizethető ki. A munkavállaló a hét végén beküldi az óralapját; ha nem küldi be, itt akkor is jóváhagyhatod.</Sub>
      <Segmented options={[{ value: 'pending', label: 'Teendő' }, { value: 'all', label: 'Mind' }]} value={filter} onChange={setFilter} />
      {shown.length === 0 ? <Empty text={filter === 'pending' ? 'Nincs jóváhagyásra váró óralap.' : 'Még nincs óralap.'} /> : null}
      {shown.map((r) => (
        <Card key={r.key} style={{ borderColor: r.status === 'submitted' ? '#B7791F' : C.border }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
            <H2>{wname(r.worker)}</H2>
            <Badge text={STATUS_LABEL[r.status]} color={STATUS_COLOR[r.status]} />
            {r.week === thisWeek ? <Badge text="folyó hét" color={C.sub} /> : null}
          </View>
          <Body style={{ fontWeight: '700' }}>{hd(r.week)} – {hd(addDaysISO(r.week, 6))}</Body>
          <Sub>{r.hours.toFixed(1)} óra · {r.days} nap · <Text style={{ fontWeight: '700', color: C.text }}>{ft(r.amount)}</Text></Sub>
          {r.sheet?.submitted_note ? <Sub>„{r.sheet.submitted_note}”</Sub> : null}
          {r.sheet?.decided_at ? <Sub style={{ fontSize: 11 }}>{r.status === 'approved' ? '✅' : '✖'} {hd(r.sheet.decided_at.slice(0, 10))} · {profiles.find((p) => p.id === r.sheet!.decided_by)?.display_name ?? ''}{r.sheet.decision_note ? ` — ${r.sheet.decision_note}` : ''}</Sub> : null}
          {r.status !== 'approved' ? (
            noteFor === r.key ? (
              <View style={{ gap: S.sm }}>
                <Input label="Indok (a munkavállaló látja)" value={note} onChangeText={setNote} placeholder="pl. kedden nem voltál a helyszínen" />
                <View style={{ flexDirection: 'row', gap: S.sm }}>
                  <View style={{ flex: 1 }}><Btn title="Mégse" kind="ghost" small onPress={() => setNoteFor(null)} /></View>
                  <View style={{ flex: 1 }}><Btn title="Visszaküldés" kind="danger" small disabled={busy === r.key} onPress={() => void decide(r, false)} /></View>
                </View>
              </View>
            ) : (
              <View style={{ flexDirection: 'row', gap: S.sm }}>
                <View style={{ flex: 1 }}><Btn title="Visszaküldés" kind="ghost" small onPress={() => { setNoteFor(r.key); setNote(''); }} /></View>
                <View style={{ flex: 2 }}><Btn title={busy === r.key ? '…' : '✅ Jóváhagyás'} small disabled={busy === r.key || r.week === thisWeek && r.status === 'open'} onPress={() => void decide(r, true)} /></View>
              </View>
            )
          ) : null}
          {r.week === thisWeek && r.status === 'open' ? <Sub style={{ fontSize: 11 }}>A folyó hét a hét végén, beküldés után hagyható jóvá.</Sub> : null}
        </Card>
      ))}
    </Screen>
  );
}
