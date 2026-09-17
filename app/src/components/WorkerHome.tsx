// Munkavállalói kezdőlap — kompakt: egysoros munkaidő-sáv, kompakt
// feladatlista szűrőkkel, összecsukható „Napjaim”.

import React, { useMemo, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Screen, Card, H2, Sub, Btn, Badge, Empty, Picker, Input, Check } from '../ui/kit';
import { C, S } from '../ui/theme';
import { useTable } from '../lib/hooks';
import { insertRow, updateRow } from '../lib/repo';
import { ft, hd, hdt, todayISO, localDateISO, addDaysISO } from '../lib/format';
import { isActiveTask, fmtHours, sessionHours, wname, myQuote, weekStartISO } from '../lib/tasks';
import { callRpc } from '../lib/repo';
import { syncNow } from '../lib/sync';
import { notify, confirmDialog } from '../lib/dialogs';
import { TaskRow } from './TaskRow';
import { InviteCard } from './InviteCard';
import { SyncBanner } from './SyncBanner';
import { Onboarding } from './Onboarding';
import { openDirections } from '../lib/maps';
import { router } from 'expo-router';
import {
  Profile, Worker, WorkerTask, TaskAssignee, TaskMaterial, TaskQuote, WorkSession, Site, Attendance, Timesheet, ScheduleEntry,
} from '../lib/types';

export function WorkerHome({ profile }: { profile: Profile }) {
  const wid = profile.worker_id!;
  const workers = useTable<Worker>('workers');
  const sites = useTable<Site>('sites');
  const tasks = useTable<WorkerTask>('worker_tasks');
  const assignees = useTable<TaskAssignee>('task_assignees');
  const materials = useTable<TaskMaterial>('task_materials');
  // vállalkozó: a saját embereim (fiók nélkül) — az ő munkaidejük/bérük is idejön
  const me = workers.find((w) => w.id === wid);
  const crew = workers.filter((w) => w.contractor_id === wid).sort((a, b) => a.name.localeCompare(b.name, 'hu'));
  const isContractor = !!me?.is_contractor;
  // ha én valakinek az embere vagyok: a bérem a vállalkozómhoz kerül, az óralapot ő küldi be
  const boss = me?.contractor_id ? workers.find((w) => w.id === me.contractor_id) : undefined;
  const myIds = new Set([wid, ...crew.map((c) => c.id)]);
  const allSessions = useTable<WorkSession>('work_sessions').filter((s) => myIds.has(s.worker_id));
  const sessions = allSessions.filter((s) => s.worker_id === wid);
  const allAttendance = useTable<Attendance>('attendance').filter((a) => myIds.has(a.worker_id));
  const attendance = allAttendance.filter((a) => a.worker_id === wid);
  const [crewOpen, setCrewOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newTrade, setNewTrade] = useState('');
  const [crewBusy, setCrewBusy] = useState(false);
  const [who, setWho] = useState<Set<string>>(new Set([wid]));
  const quotes = useTable<TaskQuote>('task_quotes');
  // beosztás: a következő 7 nap (saját + embereim)
  const schedule = useTable<ScheduleEntry>('schedule_entries')
    .filter((e) => myIds.has(e.worker_id) && e.work_date >= todayISO() && e.work_date <= addDaysISO(todayISO(), 7))
    .sort((a, b) => a.work_date.localeCompare(b.work_date));
  const allSheets = useTable<Timesheet>('timesheets');
  const sheets = allSheets.filter((t) => t.worker_id === wid);
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
  // vállalkozónál kiválasztható, kik dolgoznak (ő + emberei); mindegyik saját menetet kap
  const startAt = (siteId: string) => {
    const ids = isContractor && crew.length ? [...who] : [wid];
    for (const id of ids) {
      if (allSessions.some((s) => s.worker_id === id && !s.ended_at)) continue;
      insertRow('work_sessions', { worker_id: id, task_id: null, site_id: siteId, started_at: nowISO(), ended_at: null, note: null });
    }
    setStartOpen(false); setStartSite(null);
  };
  const onStart = () => {
    if (activeSites.length === 1 && !(isContractor && crew.length)) { startAt(activeSites[0].id); return; }
    setStartSite(activeSites[0]?.id ?? null);
    setStartOpen(true);
  };
  const stopAll = () => {
    for (const s of allSessions) if (!s.ended_at) updateRow('work_sessions', s.id, { ended_at: nowISO() });
  };
  const crewRunning = allSessions.filter((s) => !s.ended_at && s.worker_id !== wid);
  const addMember = async () => {
    if (!newName.trim()) return;
    setCrewBusy(true);
    try {
      await callRpc('contractor_add_member', { p_name: newName.trim(), p_phone: newPhone.trim() || null, p_trade: newTrade.trim() || null });
      void syncNow();
      setNewName(''); setNewPhone(''); setNewTrade('');
      notify('Felvéve 👥', 'Az embered mostantól bejelentkeztethető; a bére hozzád kerül.');
    } catch (e: any) { notify('Hiba', String(e?.message ?? e)); } finally { setCrewBusy(false); }
  };
  const removeMember = async (c: Worker) => {
    if (!await confirmDialog('Ember törlése', `${c.name} lekerül az embereid közül (a korábbi munkaideje megmarad).`, 'Törlés', true)) return;
    try { await callRpc('contractor_remove_member', { p_worker: c.id }); void syncNow(); }
    catch (e: any) { notify('Hiba', String(e?.message ?? e)); }
  };

  const todayHours = useMemo(() => {
    const today = todayISO();
    return sessions.filter((s) => localDateISO(s.started_at) === today).reduce((sum, s) => sum + sessionHours(s), 0);
  }, [sessions]);

  const days = [...attendance].sort((a, b) => b.work_date.localeCompare(a.work_date));
  // heti óralap: az elmúlt 4 hét, amelyiken volt munkaidő
  const todayIso = todayISO();
  const thisWeek = weekStartISO(todayIso);
  const people = [{ id: wid, name: 'Én' }, ...crew.map((c) => ({ id: c.id, name: c.name }))];
  const weeks = Array.from({ length: 4 }, (_, i) => {
    const d = new Date(`${thisWeek}T12:00:00`); d.setDate(d.getDate() - 7 * i);
    const week = localDateISO(d);
    return people.map((p) => {
      const own = allSessions.filter((s) => s.worker_id === p.id && s.ended_at && weekStartISO(localDateISO(s.started_at)) === week);
      const hours = own.reduce((sum, s) => sum + sessionHours(s), 0);
      const amount = allAttendance.filter((a) => a.worker_id === p.id && a.pay_basis !== 'presence' && weekStartISO(a.work_date) === week)
        .reduce((sum, a) => sum + Number(a.amount) - Number(a.commission_amount), 0);
      return { week, person: p, hours, amount, sheet: allSheets.find((t) => t.worker_id === p.id && t.week_start === week) ?? null };
    });
  }).flat().filter((w) => w.hours > 0 || w.amount > 0 || w.sheet);
  const submitSheet = async (week: string, workerId?: string) => {
    if (!await confirmDialog('Óralap beküldése', `${hd(week)} hete — a fő felhasználók jóváhagyják, utána fizethető ki a bér. Beküldöd?`, 'Beküldés')) return;
    setSheetBusy(true);
    try {
      await callRpc('submit_timesheet', { p_week_start: week, p_worker: workerId ?? null });
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
      <SyncBanner />
      <Onboarding worker />
      {schedule.length ? (
        <Card style={{ paddingVertical: S.sm, gap: 4 }}>
          <Text style={{ fontWeight: '800', fontSize: 15, color: C.text }}>📆 Beosztásom</Text>
          {schedule.map((e) => {
            const site = sites.find((x) => x.id === e.site_id);
            return (
              <View key={e.id} style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: C.border }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: C.text, fontWeight: e.work_date === todayISO() ? '800' : '600' }}>{e.work_date === todayISO() ? 'Ma' : hd(e.work_date)} · {site?.name ?? '?'}{isContractor && crew.length && e.worker_id !== wid ? ` · ${workers.find((w) => w.id === e.worker_id)?.name ?? ''}` : ''}</Text>
                  <Sub>{site?.address ?? ''}{e.note ? ` · ${e.note}` : ''}</Sub>
                </View>
                {site?.address ? <Btn title="🧭" kind="ghost" small onPress={() => void openDirections(site.address)} /> : null}
              </View>
            );
          })}
        </Card>
      ) : null}
      {boss ? (
        <Card style={{ paddingVertical: S.sm, borderColor: C.primary }}>
          <Text style={{ fontWeight: '800', color: C.text }}>👥 {wname(boss)} csapatában dolgozol</Text>
          <Sub>A béred emberenként számolódik, de a kifizetés a vállalkozódhoz kerül; az óralapot ő küldi be. A fő felhasználók látják, mennyit dolgoztál.</Sub>
        </Card>
      ) : null}
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
            {!openSession && (isContractor && crew.length ? crewRunning.length < crew.length + 1 : !crewRunning.length)
              ? <Btn title="▶ Kezdés" kind="secondary" small onPress={onStart} /> : null}
            {openSession || crewRunning.length
              ? <Btn title={crewRunning.length ? `⏹ Befejezés (${crewRunning.length + (openSession ? 1 : 0)} fő)` : '⏹ Befejezés'} kind="danger" small onPress={stopAll} /> : null}
          </View>
          {crewRunning.length ? <Sub>👥 Dolgoznak: {crewRunning.map((s) => workers.find((w) => w.id === s.worker_id)?.name ?? '?').join(', ')}</Sub> : null}
          {startOpen && !openSession ? (
            <View style={{ gap: S.sm, paddingTop: S.sm }}>
              {activeSites.length === 0
                ? <Sub style={{ color: C.warning }}>Nincs aktív építkezés, ahová be tudnál jelentkezni — kérdezd meg a fő felhasználókat.</Sub>
                : <Picker label="Melyik építkezésen dolgozol?" items={activeSites} selectedId={startSite} getId={(s) => s.id}
                    getLabel={(s) => `${s.name}${s.address ? ` · ${s.address}` : ''}`} onSelect={setStartSite} placeholder="Válassz építkezést…" />}
              {isContractor && crew.length ? (
                <View style={{ gap: 2 }}>
                  <Sub style={{ fontWeight: '700' }}>Ki dolgozik?</Sub>
                  {people.map((p) => (
                    <Check key={p.id} checked={who.has(p.id)} onToggle={() => setWho((s) => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })} label={p.name} />
                  ))}
                </View>
              ) : null}
              <View style={{ flexDirection: 'row', gap: S.sm }}>
                <View style={{ flex: 1 }}><Btn title="Mégse" kind="ghost" small onPress={() => setStartOpen(false)} /></View>
                <View style={{ flex: 1 }}><Btn title="▶ Bejelentkezés" small disabled={!startSite || (isContractor && crew.length > 0 && who.size === 0)} onPress={() => startSite && startAt(startSite)} /></View>
              </View>
              <Sub>A béred a munkaidőd alapján számolódik (órabér vagy napidíj), építkezésenként és naponta.</Sub>
            </View>
          ) : null}
        </Card>
      ) : null}

      {isContractor ? (
        <Card style={{ paddingVertical: S.sm }}>
          <Pressable onPress={() => setCrewOpen(!crewOpen)} style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
            <Text style={{ fontWeight: '800', fontSize: 15, color: C.text }}>👥 Embereim</Text>
            <Text style={{ flex: 1, color: C.sub, fontSize: 13, textAlign: 'right' }}>{crew.length ? `${crew.length} fő` : 'még senki'}</Text>
            <Text style={{ color: C.sub, fontSize: 16 }}>{crewOpen ? '▾' : '▸'}</Text>
          </Pressable>
          {crewOpen ? (
            <View style={{ gap: 6, paddingTop: 4 }}>
              {crew.map((c) => {
                const today = todayISO();
                const h = allSessions.filter((s) => s.worker_id === c.id && localDateISO(s.started_at) === today).reduce((sum, s) => sum + sessionHours(s), 0);
                return (
                  <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, borderBottomWidth: 1, borderBottomColor: C.border, paddingVertical: 3 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: C.text, fontWeight: '600' }}>{c.name}</Text>
                      <Sub>{c.trade ? `${c.trade} · ` : ''}{c.phones[0] ? `${c.phones[0]} · ` : ''}ma {fmtHours(h)}</Sub>
                    </View>
                    {c.email ? <Badge text="📱 saját fiók" color={C.sub} /> : null}
                    {allSessions.some((s) => s.worker_id === c.id && !s.ended_at) ? <Badge text="● dolgozik" color={C.success} /> : null}
                    <Btn title="🗑️" kind="ghost" small onPress={() => void removeMember(c)} />
                  </View>
                );
              })}
              <Input label="Új ember neve" value={newName} onChangeText={setNewName} placeholder="pl. Kiss Béla" autoCapitalize="words" />
              <View style={{ flexDirection: 'row', gap: S.sm }}>
                <View style={{ flex: 1 }}><Input label="Telefon" value={newPhone} onChangeText={setNewPhone} placeholder="+36 …" keyboardType="phone-pad" /></View>
                <View style={{ flex: 1 }}><Input label="Szakma" value={newTrade} onChangeText={setNewTrade} placeholder="pl. segédmunkás" /></View>
              </View>
              <Btn title={crewBusy ? '…' : '+ Felveszem'} kind="secondary" small disabled={crewBusy || !newName.trim()} onPress={() => void addMember()} />
              <Sub>Az embereid bére emberenként számolódik, de a kifizetés hozzád kerül. A fő felhasználók látják, ki mennyit dolgozott.</Sub>
              <InviteCard contractor />
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
            <View key={`${w.week}-${w.person.id}`} style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: C.border }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.text, fontWeight: '600' }}>{hd(w.week)} hete{w.week === thisWeek ? ' (folyó)' : ''}{isContractor && crew.length ? ` · ${w.person.name}` : ''}</Text>
                <Sub>{fmtHours(w.hours)} · {ft(w.amount)}</Sub>
              </View>
              {w.sheet?.status === 'approved' ? <Badge text="jóváhagyva ✓" color={C.success} />
                : w.sheet?.status === 'submitted' ? <Badge text="jóváhagyásra vár" color={C.warning} />
                : boss ? <Badge text="a vállalkozód küldi be" color={C.sub} />
                : <Btn title={w.sheet?.status === 'rejected' ? 'Újra beküld' : 'Beküldés'} kind="secondary" small disabled={sheetBusy} onPress={() => void submitSheet(w.week, w.person.id === wid ? undefined : w.person.id)} />}
            </View>
          ))}
          {weeks.some((w) => w.sheet?.status === 'rejected') ? <Sub style={{ color: C.danger }}>Visszaküldött óralap: {weeks.find((w) => w.sheet?.status === 'rejected')?.sheet?.decision_note ?? 'nézd át, és küldd be újra.'}</Sub> : null}
          <Sub>{boss ? 'A jóváhagyott hetek bére a vállalkozódnak fizethető ki.' : 'A béred a jóváhagyott heteid után fizethető ki.'}</Sub>
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
