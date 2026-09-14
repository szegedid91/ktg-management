// Munkavállalói kezdőlap — kompakt: egysoros munkaidő-sáv, kompakt
// feladatlista szűrőkkel, összecsukható „Napjaim”.

import React, { useMemo, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Screen, Card, H2, Sub, Btn, Badge, Empty, Picker } from '../ui/kit';
import { C, S } from '../ui/theme';
import { useTable } from '../lib/hooks';
import { insertRow, updateRow } from '../lib/repo';
import { ft, hd, hdt } from '../lib/format';
import { isActiveTask, fmtHours, sessionHours, wname, myQuote, weekStartISO } from '../lib/tasks';
import { callRpc } from '../lib/repo';
import { syncNow } from '../lib/sync';
import { notify, confirmDialog } from '../lib/dialogs';
import { TaskRow } from './TaskRow';
import { router } from 'expo-router';
import {
  Profile, Worker, WorkerTask, TaskAssignee, TaskMaterial, TaskQuote, WorkSession, Site, Attendance, Timesheet,
} from '../lib/types';

export function WorkerHome({ profile }: { profile: Profile }) {
  const wid = profile.worker_id!;
  const workers = useTable<Worker>('workers');
  const sites = useTable<Site>('sites');
  const tasks = useTable<WorkerTask>('worker_tasks');
  const assignees = useTable<TaskAssignee>('task_assignees');
  const materials = useTable<TaskMaterial>('task_materials');
  const sessions = useTable<WorkSession>('work_sessions').filter((s) => s.worker_id === wid);
  const attendance = useTable<Attendance>('attendance').filter((a) => a.worker_id === wid);
  const quotes = useTable<TaskQuote>('task_quotes');
  const sheets = useTable<Timesheet>('timesheets').filter((t) => t.worker_id === wid);
  const [sheetBusy, setSheetBusy] = useState(false);
  const [daysOpen, setDaysOpen] = useState(false);
  const [daysLimit, setDaysLimit] = useState(7);
  const [closedOpen, setClosedOpen] = useState(false);
  const [closedLimit, setClosedLimit] = useState(10);
  // bejelentkezés egy építkezésen (feladat nélkül): helyszínt kell választani,
  // mert a bér a munkaidő alapján, építkezésenként számolódik
  const [startOpen, setStartOpen] = useState(false);
  const [startSite, setStartSite] = useState<string | null>(null);
  const activeSites = sites.filter((s) => s.status === 'active').sort((a, b) => a.name.localeCompare(b.name, 'hu'));

  const myTaskIds = new Set(assignees.filter((a) => a.worker_id === wid).map((a) => a.task_id));
  const myTasks = tasks.filter((t) => myTaskIds.has(t.id));
  const active = myTasks.filter(isActiveTask);
  const qOf = (t: WorkerTask) => myQuote(t.id, wid, quotes);
  // ajánlatkérések: ajánlatot adok vagy nem vállalom (nincs „elfogadás”);
  // beküldött ajánlat: visszaigazolásra vár; elfogadott → normál feladat
  const quoteRequests = active.filter((t) => qOf(t)?.status === 'requested').sort((a, b) => b.created_at.localeCompare(a.created_at));
  const quoteWaiting = active.filter((t) => qOf(t)?.status === 'submitted').sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const quoteOpenIds = new Set([...quoteRequests, ...quoteWaiting].map((t) => t.id));
  // a besorolás a SAJÁT elfogadásom szerint (több emberes feladatnál a feladat
  // állapota a többiekre is vár)
  const ackedByMe = (t: WorkerTask) => assignees.some((a) => a.task_id === t.id && a.worker_id === wid && a.acknowledged_at);
  const pending = active.filter((t) => !ackedByMe(t) && !quoteOpenIds.has(t.id)).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const inProgress = active.filter((t) => ackedByMe(t));
  const closedTasks = myTasks.filter((t) => !isActiveTask(t)).sort((a, b) => (b.done_at ?? b.updated_at).localeCompare(a.done_at ?? a.updated_at));
  const runningIds = new Set(sessions.filter((s) => !s.ended_at && s.task_id).map((s) => s.task_id as string));
  const row = (t: WorkerTask) => (
    <TaskRow key={t.id} task={t} assignees={assignees.filter((a) => a.task_id === t.id)} quotes={quotes} myWorkerId={wid}
      materials={materials.filter((m) => m.task_id === t.id)} workers={workers} sites={sites} running={runningIds.has(t.id)} />
  );
  const openSession = sessions.find((s) => !s.ended_at);
  // munkaidő csak akkor, ha van legalább egy elfogadott, futó feladata
  // (vagy épp nyitott munkamenete, amit be kell tudnia fejezni)
  const acceptedActive = active.filter((t) => assignees.some((a) => a.task_id === t.id && a.worker_id === wid && a.acknowledged_at));
  const showWorkTime = true; // bejelentkezni feladat nélkül is lehet egy építkezésen
  const nowISO = () => new Date().toISOString();
  const startAt = (siteId: string) => {
    insertRow('work_sessions', { worker_id: wid, task_id: null, site_id: siteId, started_at: nowISO(), ended_at: null, note: null });
    setStartOpen(false); setStartSite(null);
  };
  const onStart = () => {
    if (activeSites.length === 1) { startAt(activeSites[0].id); return; }
    setStartSite(activeSites[0]?.id ?? null);
    setStartOpen(true);
  };

  const todayHours = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return sessions.filter((s) => s.started_at.slice(0, 10) === today).reduce((sum, s) => sum + sessionHours(s), 0);
  }, [sessions]);

  const days = [...attendance].sort((a, b) => b.work_date.localeCompare(a.work_date));
  // heti óralap: az elmúlt 4 hét, amelyiken volt munkaidő
  const todayIso = new Date().toISOString().slice(0, 10);
  const thisWeek = weekStartISO(todayIso);
  const weeks = Array.from({ length: 4 }, (_, i) => {
    const d = new Date(`${thisWeek}T12:00:00`); d.setDate(d.getDate() - 7 * i);
    const week = d.toISOString().slice(0, 10);
    const own = sessions.filter((s) => s.ended_at && weekStartISO(s.started_at.slice(0, 10)) === week);
    const hours = own.reduce((sum, s) => sum + sessionHours(s), 0);
    const amount = attendance.filter((a) => a.pay_basis !== 'presence' && weekStartISO(a.work_date) === week)
      .reduce((sum, a) => sum + Number(a.amount) - Number(a.commission_amount), 0);
    return { week, hours, amount, sheet: sheets.find((t) => t.week_start === week) ?? null };
  }).filter((w) => w.hours > 0 || w.amount > 0 || w.sheet);
  const submitSheet = async (week: string) => {
    if (!await confirmDialog('Óralap beküldése', `${hd(week)} hete — a fő felhasználók jóváhagyják, utána fizethető ki a béred. Beküldöd?`, 'Beküldés')) return;
    setSheetBusy(true);
    try {
      await callRpc('submit_timesheet', { p_week_start: week });
      void syncNow();
      notify('Óralap beküldve 🗓️', 'Értesítést kapsz, amint jóváhagyják.');
    } catch (e: any) {
      notify('Hiba', String(e?.message ?? e));
    } finally {
      setSheetBusy(false);
    }
  };
  const unpaid = days.filter((a) => a.pay_basis !== 'presence' && !a.paid_at)
    .reduce((s, a) => s + Number(a.amount) - Number(a.commission_amount), 0);

  return (
    <Screen>
      {showWorkTime ? (
        <Card style={{ borderColor: openSession ? C.success : C.border, paddingVertical: S.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '800', color: openSession ? C.success : C.text }} numberOfLines={1}>
                {openSession ? `● Dolgozol · kezdés ${hdt(openSession.started_at).slice(-5)}` : '⏱ Munkaidő'}
              </Text>
              <Sub>
                {openSession?.task_id ? `${tasks.find((t) => t.id === openSession.task_id)?.title ?? 'feladat'} · ` : ''}
                ma {fmtHours(todayHours)}
              </Sub>
            </View>
            {openSession
              ? <Btn title="⏹ Befejezés" kind="danger" small onPress={() => updateRow('work_sessions', openSession.id, { ended_at: nowISO() })} />
              : <Btn title="▶ Kezdés" kind="secondary" small onPress={onStart} />}
          </View>
          {startOpen && !openSession ? (
            <View style={{ gap: S.sm, paddingTop: S.sm }}>
              {activeSites.length === 0
                ? <Sub style={{ color: C.warning }}>Nincs aktív építkezés, ahová be tudnál jelentkezni — kérdezd meg a fő felhasználókat.</Sub>
                : <Picker label="Melyik építkezésen dolgozol?" items={activeSites} selectedId={startSite} getId={(s) => s.id}
                    getLabel={(s) => `${s.name}${s.address ? ` · ${s.address}` : ''}`} onSelect={setStartSite} placeholder="Válassz építkezést…" />}
              <View style={{ flexDirection: 'row', gap: S.sm }}>
                <View style={{ flex: 1 }}><Btn title="Mégse" kind="ghost" small onPress={() => setStartOpen(false)} /></View>
                <View style={{ flex: 1 }}><Btn title="▶ Bejelentkezés" small disabled={!startSite} onPress={() => startSite && startAt(startSite)} /></View>
              </View>
              <Sub>A béred a munkaidőd alapján számolódik (órabér vagy napidíj), építkezésenként és naponta.</Sub>
            </View>
          ) : null}
        </Card>
      ) : null}

      {quoteRequests.length > 0 ? (
        <View style={{ gap: S.sm }}>
          <H2>💬 Ajánlatkérések ({quoteRequests.length})</H2>
          <View style={{ gap: 6 }}>{quoteRequests.map(row)}</View>
          <Sub style={{ color: C.primary }}>Nyisd meg, és add meg, mennyiért vállalod — vagy jelezd, hogy nem vállalod.</Sub>
        </View>
      ) : null}
      {quoteWaiting.length > 0 ? (
        <View style={{ gap: S.sm }}>
          <H2>🕐 Visszaigazolásra váró ajánlataim ({quoteWaiting.length})</H2>
          <View style={{ gap: 6 }}>{quoteWaiting.map(row)}</View>
          <Sub>Ha elfogadják, a feladat átkerül a folyamatban lévők közé, és értesítést kapsz.</Sub>
        </View>
      ) : null}

      <View style={{ gap: S.sm }}>
        <H2>⏳ Elfogadásra váró feladatok ({pending.length})</H2>
        {pending.length === 0 ? <Sub>Nincs elfogadásra váró feladatod.</Sub> : null}
        <View style={{ gap: 6 }}>{pending.map(row)}</View>
        {pending.length > 0 ? <Sub style={{ color: C.warning }}>Nyisd meg, és fogadd el — utána a Feladatok fülön folytatod.</Sub> : null}
        <Pressable onPress={() => router.navigate('/tasks')}
          style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, backgroundColor: C.card, borderRadius: S.radiusSm, borderWidth: 1, borderColor: C.border, padding: S.md }}>
          <Text style={{ fontWeight: '700', color: C.text, flex: 1 }}>🔧 Folyamatban lévő feladataim ({inProgress.length})</Text>
          <Text style={{ color: C.sub }}>Feladatok ›</Text>
        </Pressable>
      </View>

      {closedTasks.length > 0 ? (
        <Card style={{ paddingVertical: S.sm }}>
          <Pressable onPress={() => setClosedOpen(!closedOpen)} style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
            <Text style={{ fontWeight: '800', fontSize: 15, color: C.text }}>✔️ Lezárt feladatok</Text>
            <Text style={{ flex: 1, color: C.sub, fontSize: 13, textAlign: 'right' }}>{closedTasks.length} db</Text>
            <Text style={{ color: C.sub, fontSize: 16 }}>{closedOpen ? '▾' : '▸'}</Text>
          </Pressable>
          {closedOpen ? (
            <View style={{ gap: 6, paddingTop: 4 }}>
              {closedTasks.slice(0, closedLimit).map(row)}
              {closedTasks.length > closedLimit ? <Btn title={`Több (${closedTasks.length - closedLimit})`} kind="ghost" small onPress={() => setClosedLimit(closedLimit + 30)} /> : null}
            </View>
          ) : null}
        </Card>
      ) : null}

      {weeks.length > 0 ? (
        <Card style={{ paddingVertical: S.sm, gap: 6 }}>
          <Text style={{ fontWeight: '800', fontSize: 15, color: C.text }}>🗓️ Heti óralap</Text>
          {weeks.map((w) => (
            <View key={w.week} style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: C.border }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.text, fontWeight: '600' }}>{hd(w.week)} hete{w.week === thisWeek ? ' (folyó)' : ''}</Text>
                <Sub>{fmtHours(w.hours)} · {ft(w.amount)}</Sub>
              </View>
              {w.sheet?.status === 'approved' ? <Badge text="jóváhagyva ✓" color={C.success} />
                : w.sheet?.status === 'submitted' ? <Badge text="jóváhagyásra vár" color={C.warning} />
                : <Btn title={w.sheet?.status === 'rejected' ? 'Újra beküld' : 'Beküldés'} kind="secondary" small disabled={sheetBusy} onPress={() => void submitSheet(w.week)} />}
            </View>
          ))}
          {weeks.some((w) => w.sheet?.status === 'rejected') ? <Sub style={{ color: C.danger }}>Visszaküldött óralap: {weeks.find((w) => w.sheet?.status === 'rejected')?.sheet?.decision_note ?? 'nézd át, és küldd be újra.'}</Sub> : null}
          <Sub>A béred a jóváhagyott heteid után fizethető ki.</Sub>
        </Card>
      ) : null}

      <Card style={{ paddingVertical: S.sm }}>
        <Pressable onPress={() => setDaysOpen(!daysOpen)} style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
          <Text style={{ fontWeight: '800', fontSize: 15, color: C.text }}>📅 Napjaim</Text>
          <Text style={{ flex: 1, color: C.sub, fontSize: 13, textAlign: 'right' }} numberOfLines={1}>
            {days.length === 0 ? 'nincs rögzített nap' : `${days.length} nap · utolsó ${hd(days[0].work_date)}${unpaid > 0 ? ` · függő ${ft(unpaid)}` : ''}`}
          </Text>
          <Text style={{ color: C.sub, fontSize: 16 }}>{daysOpen ? '▾' : '▸'}</Text>
        </Pressable>
        {daysOpen ? (
          <View style={{ gap: 4, paddingTop: 4 }}>
            {days.length === 0 ? <Empty text="Még nincs rögzített napod." /> : null}
            {days.slice(0, daysLimit).map((a) => (
              <View key={a.id} style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: C.border }}>
                <Text style={{ color: C.text, fontWeight: '600', flex: 1 }} numberOfLines={1}>
                  {hd(a.work_date)} · {sites.find((s) => s.id === a.site_id)?.name ?? '—'}
                </Text>
                {a.source === 'session' || a.source === 'task' ? <Text style={{ fontSize: 11, color: C.sub }}>{a.source === 'task' ? '💬' : '⏱'}</Text> : null}
                {a.pay_basis !== 'presence' ? (
                  <>
                    <Text style={{ color: C.text, fontWeight: '700' }}>{ft(Number(a.amount) - Number(a.commission_amount))}</Text>
                    <Badge text={a.paid_at ? 'kifizetve' : 'függő'} color={a.paid_at ? C.success : C.warning} />
                  </>
                ) : <Badge text="jelenlét" color={C.sub} />}
              </View>
            ))}
            {days.length > daysLimit ? <Btn title={`Több (${days.length - daysLimit})`} kind="ghost" small onPress={() => setDaysLimit(daysLimit + 30)} /> : null}
          </View>
        ) : null}
      </Card>

      <Text style={{ fontSize: 11, color: C.sub, textAlign: 'center' }}>
        {profile.display_name} · {wname(workers.find((w) => w.id === wid))}
      </Text>
    </Screen>
  );
}
