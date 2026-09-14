// Feladat részletei — partnernek (idő, bérköltség, anyag beárazás, számlázás,
// haszon, ajánlat elfogadása) és munkavállalónak (visszaigazolás, ajánlat,
// munkaidő, kész / nem sikerült indokkal+fotóval, anyagköltség fotóval).

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Linking, Pressable } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Screen, Card, H2, Sub, Body, Btn, Input, KV, Divider, Badge, Empty, Picker } from '../../ui/kit';
import { C, S } from '../../ui/theme';
import { useTable, useRow } from '../../lib/hooks';
import { getCurrentUserId, insertRow, updateRow, queueRpc, softDeleteRow, callRpc } from '../../lib/repo';
import { syncNow } from '../../lib/sync';
import { smartBack } from '../../lib/nav';
import { ft, hdt, parseAmount } from '../../lib/format';
import { notify, confirmDialog } from '../../lib/dialogs';
import { pickPhoto, pickPhotos, uploadTaskPhoto, taskPhotoUrl, removeStoragePaths, PickedPhoto } from '../../lib/photo';
import { PhotoThumbs } from '../../components/PhotoThumbs';
import { supabase } from '../../lib/supabase';
import {
  TASK_STATUS_LABEL, taskTiming, taskWageCost, materialTotals, taskProfit, fmtHours, isActiveTask, wname,
  quotesOf, myQuote, openQuotes, QUOTE_STATUS_LABEL, QUOTE_STATUS_COLOR,
} from '../../lib/tasks';
import {
  WorkerTask, TaskAssignee, TaskMaterial, TaskMaterialPricing, TaskFinance, TaskQuote, WorkSession, Worker, Site, Profile, Attendance,
} from '../../lib/types';

/** Összecsukható kártya: a fejlécben egysoros összefoglaló, a részletek koppintásra. */
function Section({ title, summary, defaultOpen = false, accent, children }: {
  title: string; summary?: string; defaultOpen?: boolean; accent?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card style={accent ? { borderColor: C.primary } : undefined}>
      <Pressable onPress={() => setOpen(!open)} style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
        <Text style={{ fontWeight: '800', fontSize: 15, color: C.text }}>{title}</Text>
        <Text style={{ flex: 1, color: C.sub, fontSize: 13, textAlign: 'right' }} numberOfLines={1}>{summary ?? ''}</Text>
        <Text style={{ color: C.sub, fontSize: 16 }}>{open ? '▾' : '▸'}</Text>
      </Pressable>
      {open ? children : null}
    </Card>
  );
}

const STATUS_COLOR: Record<string, string> = {
  assigned: '#B7791F', acknowledged: '#2B6CB0', done: '#2F855A', failed: '#C53030', cancelled: '#718096',
};

export default function TaskDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const task = useRow<WorkerTask>('worker_tasks', id);
  const assignees = useTable<TaskAssignee>('task_assignees').filter((a) => a.task_id === id);
  const workers = useTable<Worker>('workers');
  const sites = useTable<Site>('sites');
  const profiles = useTable<Profile>('profiles');
  const sessions = useTable<WorkSession>('work_sessions').filter((s) => s.task_id === id);
  const materials = useTable<TaskMaterial>('task_materials').filter((m) => m.task_id === id);
  // csak-partner táblák: munkavállalónál üresek
  const pricing = useTable<TaskMaterialPricing>('task_material_pricing');
  const finance = useTable<TaskFinance>('task_finance').find((f) => f.task_id === id);
  const allQuotes = useTable<TaskQuote>('task_quotes');
  const me = getCurrentUserId();
  const myProfile = profiles.find((p) => p.id === me);
  const myWorkerId = myProfile?.worker_id ?? null;
  const isWorker = !!myWorkerId;

  // percenként frissülő „most” a futó munkaidőhöz
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const assigneeWorkers = useMemo(
    () => assignees.map((a) => workers.find((w) => w.id === a.worker_id)).filter(Boolean) as Worker[],
    [assignees, workers],
  );
  const timing = useMemo(() => (task ? taskTiming(task, sessions, now) : null), [task, sessions, now]);
  // bérköltség: a ténylegesen könyvelt bér-sorok (munkaidőből / elfogadott
  // ajánlatból, a szerver számolja) + a még futó munkamenetek előnézete
  const wageRows = useTable<Attendance>('attendance').filter((a) => a.task_id === id);
  const wageBooked = useMemo(() => wageRows.reduce((s, a) => s + Number(a.amount), 0), [wageRows]);
  const wage = useMemo(() => (task ? taskWageCost(task, assigneeWorkers, sessions.filter((s) => !s.ended_at), now) : null), [task, assigneeWorkers, sessions, now]);
  const wageTotal = task?.quote_accepted_at && task.quote_amount != null ? Number(task.quote_amount) : wageBooked + (wage?.total ?? 0);
  const mat = useMemo(() => materialTotals(materials, pricing), [materials, pricing]);
  const profit = task && wage ? taskProfit(finance?.invoice_net, wageTotal, materials, pricing) : null;

  // űrlap-állapotok
  const [invoiceStr, setInvoiceStr] = useState<string | null>(null);
  const [resaleDraft, setResaleDraft] = useState<Record<string, string>>({});
  const [quoteAmount, setQuoteAmount] = useState('');
  const [quoteNote, setQuoteNote] = useState('');
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [rejectFor, setRejectFor] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [requestWorker, setRequestWorker] = useState<string | null>(null);
  const [failOpen, setFailOpen] = useState(false);
  const [failReason, setFailReason] = useState('');
  const [failPhotos, setFailPhotos] = useState<PickedPhoto[]>([]);
  const [matOpen, setMatOpen] = useState(false);
  const [matAmount, setMatAmount] = useState('');
  const [matNote, setMatNote] = useState('');
  const [matPhotos, setMatPhotos] = useState<PickedPhoto[]>([]);
  const [busy, setBusy] = useState(false);

  if (!task) return <Screen><Empty text="Feladat nem található (szinkronizálás folyamatban?)" /></Screen>;

  const site = sites.find((s) => s.id === task.site_id);
  const creator = profiles.find((p) => p.id === task.created_by)?.display_name ?? '?';
  const workerName = (wid: string) => wname(workers.find((w) => w.id === wid));
  const myAssignment = assignees.find((a) => a.worker_id === myWorkerId);
  const openSession = sessions.find((s) => !s.ended_at && s.worker_id === myWorkerId);
  const active = isActiveTask(task);
  // ajánlatok: a napló sorai; munkavállalónál a saját legutóbbi sora számít
  const quoteLog = quotesOf(task.id, allQuotes);
  const mine = myQuote(task.id, myWorkerId, allQuotes);
  const isQuoteTask = task.quote_requested || quoteLog.length > 0;
  // ajánlatkérésnél a munkavállaló nem „fogadja el” a feladatot: ajánlatot ad vagy nem vállalja
  const quoteOpenForMe = !!mine && (mine.status === 'requested' || mine.status === 'submitted');
  // a munkavállaló csak visszaigazolás után indíthat munkát / rögzíthet anyagot
  const acked = !!myAssignment?.acknowledged_at && !quoteOpenForMe;
  // késznek csak akkor jelölhető, ha a munkavállaló el is kezdte (van munkaideje rajta)
  const startedByMe = sessions.some((s) => s.worker_id === myWorkerId);
  const nowISO = () => new Date().toISOString();

  const openPhoto = async (path: string) => {
    const url = await taskPhotoUrl(path);
    if (url) void Linking.openURL(url);
    else notify('Hiba', 'A fotó megnyitásához internet kell.');
  };

  // ---------- munkavállalói műveletek ----------
  const acknowledge = () => {
    if (!myAssignment) return;
    const othersPending = assignees.some((a) => a.id !== myAssignment.id && !a.acknowledged_at);
    queueRpc('worker_task_action', { p_id: task.id, p_action: 'acknowledge' }, [
      { table: 'task_assignees', id: myAssignment.id, patch: { acknowledged_at: nowISO() } },
      ...(othersPending || task.status !== 'assigned' ? [] : [{ table: 'worker_tasks' as const, id: task.id, patch: { status: 'acknowledged', acknowledged_at: nowISO() } }]),
    ]);
    notify('Feladat elfogadva ✅', 'Mostantól indíthatod rajta a munkaidőt.');
  };

  const sendQuote = () => {
    const amount = parseAmount(quoteAmount);
    if (amount <= 0) { notify('Hiba', 'Adj meg ajánlati összeget.'); return; }
    queueRpc('worker_task_action', { p_id: task.id, p_action: 'quote', p_amount: amount, p_reason: quoteNote.trim() || null },
      mine ? [{ table: 'task_quotes', id: mine.id, patch: { amount, note: quoteNote.trim() || null, submitted_at: nowISO(), status: 'submitted' } }] : []);
    setQuoteAmount(''); setQuoteNote('');
    notify('Ajánlat elküldve 💬', 'Visszaigazolásra vár — ha elfogadják, értesítést kapsz, és a feladat a folyamatban lévők közé kerül.');
  };
  const declineQuote = async () => {
    if (!mine) return;
    if (!await confirmDialog('Nem vállalom', 'Jelezzük a fő felhasználóknak, hogy nem vállalod ezt a munkát. A feladat lekerül a listádról.', 'Nem vállalom', true)) return;
    queueRpc('worker_task_action', { p_id: task.id, p_action: 'decline_quote', p_reason: declineReason.trim() || null }, [
      { table: 'task_quotes', id: mine.id, patch: { status: 'declined', decided_at: nowISO(), decision_note: declineReason.trim() || null } },
      ...(myAssignment ? [{ table: 'task_assignees' as const, id: myAssignment.id, patch: { deleted_at: nowISO() } }] : []),
    ]);
    setDeclineOpen(false);
    smartBack();
  };

  const startWork = () => {
    insertRow('work_sessions', { worker_id: myWorkerId, task_id: task.id, site_id: task.site_id, started_at: nowISO(), ended_at: null, note: null });
  };
  const stopWork = () => {
    if (openSession) updateRow('work_sessions', openSession.id, { ended_at: nowISO() });
  };

  const markDone = async () => {
    if (!await confirmDialog('Feladat kész', 'Késznek jelölöd a feladatot?', 'Kész ✔')) return;
    if (openSession) stopWork();
    queueRpc('worker_task_action', { p_id: task.id, p_action: 'done' }, [
      { table: 'worker_tasks', id: task.id, patch: { status: 'done', done_at: nowISO() } },
    ]);
  };

  const submitFail = async () => {
    if (failReason.trim().length < 3) { notify('Kötelező indoklás', 'Írd le, miért nem tudtad megcsinálni a feladatot.'); return; }
    setBusy(true);
    const paths: string[] = [];
    let fails = 0;
    for (const ph of failPhotos) {
      try { paths.push(await uploadTaskPhoto(ph.base64, `${task.id}/fail`)); } catch { fails++; }
    }
    if (fails) notify('Fotó', `${fails} fotót nem sikerült feltölteni (internet?) — az indoklás nélkülük megy.`);
    setBusy(false);
    if (openSession) stopWork();
    queueRpc('worker_task_action', { p_id: task.id, p_action: 'fail', p_reason: failReason.trim(), p_photo_paths: paths }, [
      { table: 'worker_tasks', id: task.id, patch: { status: 'failed', done_at: nowISO(), fail_reason: failReason.trim(), fail_photo_path: paths[0] ?? null, fail_photo_paths: paths } },
    ]);
    setFailOpen(false);
  };

  const submitMaterial = async () => {
    const amount = parseAmount(matAmount);
    if (amount <= 0) { notify('Hiba', 'Adj meg összeget.'); return; }
    if (matPhotos.length === 0) { notify('Fotó kötelező', 'Anyagköltséghez a számla/blokk fotója kötelező.'); return; }
    setBusy(true);
    try {
      const paths: string[] = [];
      for (const ph of matPhotos) paths.push(await uploadTaskPhoto(ph.base64, `${task.id}/material`));
      insertRow('task_materials', { task_id: task.id, worker_id: myWorkerId, amount, note: matNote.trim() || null, photo_path: paths[0], photo_paths: paths });
      setMatOpen(false); setMatAmount(''); setMatNote(''); setMatPhotos([]);
      notify('Anyagköltség rögzítve 📦', `${ft(amount)} · ${paths.length} fotóval.`);
    } catch {
      notify('Hiba', 'A fotó feltöltéséhez internet kell — próbáld újra kapcsolattal.');
    } finally {
      setBusy(false);
    }
  };

  // ---------- partneri műveletek ----------
  const saveInvoice = () => {
    const v = (invoiceStr ?? '').trim();
    const val = v ? parseAmount(v) : null;
    if (finance) updateRow('task_finance', finance.id, { invoice_net: val });
    else insertRow('task_finance', { task_id: task.id, invoice_net: val });
    setInvoiceStr(null);
  };
  const saveResale = (m: TaskMaterial) => {
    const v = parseAmount(resaleDraft[m.id] ?? '');
    const existing = mat.priceOf(m);
    if (existing) updateRow('task_material_pricing', existing.id, { resale_net: v, resale_by: me, resale_at: nowISO() });
    else insertRow('task_material_pricing', { material_id: m.id, resale_net: v, resale_by: me, resale_at: nowISO() });
    setResaleDraft((d) => { const n = { ...d }; delete n[m.id]; return n; });
  };
  const acceptQuote = async (q: TaskQuote) => {
    const who = workerName(q.worker_id);
    const others = openQuotes(task.id, allQuotes).filter((o) => o.id !== q.id);
    if (!await confirmDialog('Ajánlat elfogadása',
      `${who}: ${ft(q.amount ?? 0)} — ettől kezdve ez a feladat bérköltsége. ${who} feladata ezzel elfogadottnak számít, és kezdheti a munkát.${others.length ? `\n\nA többi nyitott ajánlatkérés (${others.map((o) => workerName(o.worker_id)).join(', ')}) elutasításra kerül.` : ''}`,
      'Elfogadom')) return;
    queueRpc('accept_task_quote', { p_id: q.id }, [
      { table: 'task_quotes', id: q.id, patch: { status: 'accepted', decided_at: nowISO(), decided_by: me } },
      { table: 'worker_tasks', id: task.id, patch: { quote_amount: q.amount, quote_note: q.note, quote_accepted_at: nowISO(), quote_accepted_by: me } },
      ...others.map((o) => ({ table: 'task_quotes' as const, id: o.id, patch: { status: 'rejected', decided_at: nowISO(), decision_note: 'másik ajánlatot fogadtak el' } })),
    ]);
  };
  const rejectQuote = (q: TaskQuote) => {
    queueRpc('reject_task_quote', { p_id: q.id, p_reason: rejectReason.trim() || null }, [
      { table: 'task_quotes', id: q.id, patch: { status: 'rejected', decided_at: nowISO(), decided_by: me, decision_note: rejectReason.trim() || null } },
    ]);
    setRejectFor(null); setRejectReason('');
    notify('Ajánlat elutasítva', 'A munkavállaló értesítést kap. Kérhetsz új ajánlatot tőle vagy mástól.');
  };
  const requestQuote = async (wid: string) => {
    if (openQuotes(task.id, allQuotes).some((q) => q.worker_id === wid)) { notify('Már van nyitott ajánlatkérés', `${workerName(wid)} még nem válaszolt az előző kérésre.`); return; }
    try {
      await callRpc('request_task_quote', { p_task: task.id, p_worker: wid });
      void syncNow();
      setRequestWorker(null);
      notify('Ajánlatkérés kiküldve 💬', `${workerName(wid)} értesítést kapott.`);
    } catch (e: any) {
      notify('Hiba', String(e?.message ?? e));
    }
  };
  const cancelTask = async () => {
    if (!await confirmDialog('Feladat visszavonása', 'A feladat lezárul „visszavont” állapottal.', 'Visszavonás', true)) return;
    updateRow('worker_tasks', task.id, { status: 'cancelled' });
  };

  const materialPhotos = (m: TaskMaterial) => (m.photo_paths?.length ? m.photo_paths : m.photo_path ? [m.photo_path] : []);

  const deleteMaterial = async (m: TaskMaterial) => {
    if (!await confirmDialog('Anyagköltség törlése', `${ft(m.amount)}${m.note ? ` — ${m.note}` : ''}\n\nA hozzá tartozó fotók is törlődnek a tárolóból.`, 'Törlés', true)) return;
    void removeStoragePaths('tasks', materialPhotos(m));
    softDeleteRow('task_materials', m.id);
  };

  const deleteTask = async () => {
    if (!await confirmDialog('Feladat törlése', 'A feladat és minden hozzá tartozó fotó (kiadott, nem sikerült, anyagköltség) törlődik. Ez nem vonható vissza.', 'Törlés', true)) return;
    const paths = [
      ...(task.photo_paths ?? []),
      ...(task.fail_photo_paths?.length ? task.fail_photo_paths : task.fail_photo_path ? [task.fail_photo_path] : []),
      ...materials.flatMap(materialPhotos),
    ];
    void removeStoragePaths('tasks', paths);
    materials.forEach((m) => softDeleteRow('task_materials', m.id));
    softDeleteRow('worker_tasks', task.id);
    smartBack();
  };

  const removeTaskPhoto = async (path: string) => {
    if (!await confirmDialog('Fotó törlése', 'Törlöd ezt a fotót a feladatról?', 'Törlés', true)) return;
    updateRow('worker_tasks', task.id, { photo_paths: (task.photo_paths ?? []).filter((p) => p !== path) });
    supabase.storage.from('tasks').remove([path]).catch(() => {});
  };

  const addTaskPhoto = async () => {
    const fromCamera = await confirmDialog('Fotó csatolása', 'Honnan?', 'Kamera');
    const p = await pickPhoto(fromCamera);
    if (!p) return;
    setBusy(true);
    try {
      const path = await uploadTaskPhoto(p.base64, `${task.id}/brief`);
      updateRow('worker_tasks', task.id, { photo_paths: [...(task.photo_paths ?? []), path] });
    } catch {
      notify('Hiba', 'A fotó feltöltéséhez internet kell.');
    } finally {
      setBusy(false);
    }
  };

  const pick = async (fromCamera: boolean, target: 'fail' | 'mat') => {
    const list = await pickPhotos(fromCamera);
    if (list.length === 0) return;
    if (target === 'fail') setFailPhotos((ps) => [...ps, ...list]); else setMatPhotos((ps) => [...ps, ...list]);
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: task.code ? `${task.code} · ${task.title}` : task.title }} />

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
          <Badge text={TASK_STATUS_LABEL[task.status]} color={STATUS_COLOR[task.status]} />
          {task.priority ? <Badge text="⚡ prioritás" color={C.danger} /> : null}
          {isQuoteTask && !task.quote_accepted_at ? <Badge text="ajánlatkérés" color={C.primary} /> : null}
          {task.quote_accepted_at ? <Badge text={`ajánlat ${ft(task.quote_amount ?? 0)}`} color={C.success} /> : null}
        </View>
        <H2>{task.code ? `${task.code} — ` : ''}{task.title}</H2>
        {task.details ? <Body>{task.details}</Body> : null}
        <Divider />
        <KV k="Helyszín" v={site ? `${site.name}${site.address ? ` · ${site.address}` : ''}` : '—'} />
        <KV k="Kiadta" v={creator} />
        <KV k="Kiosztva" v={assignees.map((a) => `${workerName(a.worker_id)} ${a.acknowledged_at ? '✓' : '⏳'}`).join(', ') || '—'} />
        {assignees.some((a) => !a.acknowledged_at) ? <Sub>{isQuoteTask ? '⏳ = ajánlatra várunk · ✓ = elfogadott ajánlat' : '⏳ = még nem fogadta el · ✓ = elfogadta'}</Sub> : null}
        {(task.photo_paths ?? []).length > 0 || !isWorker ? (
          <View style={{ gap: 4 }}>
            <Sub>📷 Fotók a feladathoz{(task.photo_paths ?? []).length ? ` (${task.photo_paths.length})` : ''}</Sub>
            <PhotoThumbs paths={task.photo_paths ?? []}
              onRemoveRemote={!isWorker && active ? (ph) => void removeTaskPhoto(ph) : undefined} />
            {!isWorker && active ? (
              <View style={{ flexDirection: 'row', gap: S.sm }}>
                <Btn title={busy ? '…' : '+ Fotó'} kind="secondary" small disabled={busy} onPress={() => void addTaskPhoto()} />
                <Btn title={task.priority ? '⚡ Prioritás levétele' : '⚡ Prioritásos'} kind="ghost" small
                  onPress={() => updateRow('worker_tasks', task.id, { priority: task.priority ? 0 : 1 })} />
              </View>
            ) : null}
          </View>
        ) : null}
        {task.fail_reason ? (
          <View style={{ backgroundColor: C.dangerBg, padding: S.md, borderRadius: 8, gap: 4 }}>
            <Body style={{ fontWeight: '700', color: C.danger }}>⚠️ Nem sikerült — indok:</Body>
            <Body>{task.fail_reason}</Body>
            <PhotoThumbs paths={task.fail_photo_paths?.length ? task.fail_photo_paths : task.fail_photo_path ? [task.fail_photo_path] : []} />
          </View>
        ) : null}
      </Card>

      {isWorker && !acked ? null : (
      <Section title="⏱ Munkaidő" defaultOpen={isWorker}
        summary={timing?.startedAt ? `${fmtHours(timing.hours)}${timing.running ? ' · ● fut' : timing.finishedAt ? ' · kész' : ''}` : 'még nem kezdték el'}>
        {timing?.startedAt ? (
          <>
            <KV k="Kezdés" v={hdt(timing.startedAt)} />
            <KV k={timing.running ? 'Eddig (fut)' : 'Ledolgozott idő'} v={`${fmtHours(timing.hours)} · ${timing.days} nap`} />
            {timing.finishedAt ? <KV k="Befejezés" v={hdt(timing.finishedAt)} strong /> : null}
          </>
        ) : <Sub>Még nem kezdték el.</Sub>}
        {sessions.length > 0 ? (
          <View style={{ gap: 2 }}>
            {[...sessions].sort((a, b) => b.started_at.localeCompare(a.started_at)).slice(0, 10).map((s) => (
              <Sub key={s.id}>
                {workerName(s.worker_id)}: {hdt(s.started_at)} → {s.ended_at ? hdt(s.ended_at) : 'folyamatban'}
                {' '}({fmtHours(Math.max(0, (new Date(s.ended_at ?? now).getTime() - new Date(s.started_at).getTime()) / 3.6e6))})
              </Sub>
            ))}
          </View>
        ) : null}
        {isWorker && myAssignment && active ? (
          openSession
            ? <Btn title="⏹ Munka befejezése most" kind="danger" onPress={stopWork} />
            : <Btn title="▶ Munka megkezdése most" kind="secondary" onPress={startWork} />
        ) : null}
      </Section>
      )}

      {/* ---------- ajánlat: munkavállaló ---------- */}
      {isWorker && mine ? (
        <Card style={{ borderColor: C.primary }}>
          <H2>💬 Ajánlat</H2>
          {mine.status === 'requested' ? (
            <>
              <Sub>Ajánlatot kértek tőled erre a munkára. Add meg, mennyiért vállalod — vagy jelezd, ha nem vállalod.</Sub>
              <Input label="Ajánlati ár (Ft)" value={quoteAmount} onChangeText={setQuoteAmount} keyboardType="numeric" placeholder="pl. 120 000" />
              <Input label="Megjegyzés" value={quoteNote} onChangeText={setQuoteNote} placeholder="opcionális (pl. anyag nélkül, 3 nap)" />
              <Btn title="Ajánlat küldése 💬" onPress={sendQuote} disabled={!quoteAmount} />
            </>
          ) : mine.status === 'submitted' ? (
            <>
              <KV k="Ajánlatod" v={ft(mine.amount ?? 0)} strong />
              {mine.note ? <Sub>{mine.note}</Sub> : null}
              <Sub>🕐 Beküldve {hdt(mine.submitted_at ?? mine.updated_at)} — visszaigazolásra vár. Ha elfogadják, a feladat a folyamatban lévők közé kerül.</Sub>
            </>
          ) : mine.status === 'accepted' ? (
            <>
              <KV k="Elfogadott ajánlatod" v={ft(mine.amount ?? 0)} strong />
              <Sub>✅ Elfogadva {hdt(mine.decided_at ?? mine.updated_at)} — a feladat a tiéd, kezdheted.</Sub>
            </>
          ) : (
            <Sub>{mine.status === 'declined' ? '✋ Nem vállaltad ezt a munkát.' : `Az ajánlatkérés lezárult${mine.decision_note ? ` — ${mine.decision_note}` : ''}.`}</Sub>
          )}
          {quoteOpenForMe ? (
            !declineOpen ? (
              <Btn title="Nem vállalom ✋" kind="ghost" onPress={() => setDeclineOpen(true)} />
            ) : (
              <View style={{ gap: S.sm }}>
                <Input label="Miért nem? (opcionális)" value={declineReason} onChangeText={setDeclineReason} placeholder="pl. nincs rá kapacitásom" />
                <View style={{ flexDirection: 'row', gap: S.sm }}>
                  <View style={{ flex: 1 }}><Btn title="Mégse" kind="ghost" onPress={() => setDeclineOpen(false)} /></View>
                  <View style={{ flex: 1 }}><Btn title="Nem vállalom" kind="danger" onPress={() => void declineQuote()} /></View>
                </View>
              </View>
            )
          ) : null}
        </Card>
      ) : null}

      {/* ---------- ajánlat: partner (napló + újrakérés) ---------- */}
      {!isWorker && (isQuoteTask || active) ? (
        <Section title="💬 Ajánlatok" accent={openQuotes(task.id, allQuotes).length > 0}
          defaultOpen={isQuoteTask && !task.quote_accepted_at}
          summary={task.quote_accepted_at ? `elfogadva ${ft(task.quote_amount ?? 0)}`
            : openQuotes(task.id, allQuotes).length ? `${openQuotes(task.id, allQuotes).filter((q) => q.status === 'submitted').length} ajánlat · ${openQuotes(task.id, allQuotes).filter((q) => q.status === 'requested').length} kérés nyitva`
            : quoteLog.length ? 'nincs nyitott kérés' : 'nem ajánlatkérős'}>
          {quoteLog.length === 0 ? <Sub>Még nem kértél ajánlatot ehhez a feladathoz.</Sub> : null}
          {quoteLog.map((q) => (
            <View key={q.id} style={{ gap: 3, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.border }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
                <Body style={{ fontWeight: '700', flex: 1 }}>{workerName(q.worker_id)}</Body>
                <Badge text={QUOTE_STATUS_LABEL[q.status]} color={QUOTE_STATUS_COLOR[q.status]} />
              </View>
              <Sub>Kérés: {hdt(q.requested_at)}{q.requested_by ? ` · ${profiles.find((p) => p.id === q.requested_by)?.display_name ?? ''}` : ''}</Sub>
              {q.submitted_at ? <Body>Ajánlat: <Text style={{ fontWeight: '800' }}>{ft(q.amount ?? 0)}</Text>{q.note ? ` — ${q.note}` : ''} <Text style={{ color: C.sub, fontSize: 12 }}>({hdt(q.submitted_at)})</Text></Body> : null}
              {q.decided_at ? <Sub>{q.status === 'accepted' ? '✅ Elfogadva' : q.status === 'declined' ? '✋ Nem vállalja' : '✖ Elutasítva'} {hdt(q.decided_at)}{q.decision_note ? ` — ${q.decision_note}` : ''}{q.decided_by && q.status !== 'declined' ? ` · ${profiles.find((p) => p.id === q.decided_by)?.display_name ?? ''}` : ''}</Sub> : null}
              {q.status === 'submitted' && active ? (
                rejectFor === q.id ? (
                  <View style={{ gap: S.sm }}>
                    <Input label="Indok (opcionális, a munkavállaló látja)" value={rejectReason} onChangeText={setRejectReason} placeholder="pl. túl drága" />
                    <View style={{ flexDirection: 'row', gap: S.sm }}>
                      <View style={{ flex: 1 }}><Btn title="Mégse" kind="ghost" small onPress={() => setRejectFor(null)} /></View>
                      <View style={{ flex: 1 }}><Btn title="Elutasítás" kind="danger" small onPress={() => rejectQuote(q)} /></View>
                    </View>
                  </View>
                ) : (
                  <View style={{ flexDirection: 'row', gap: S.sm }}>
                    <View style={{ flex: 1 }}><Btn title="Elutasítás" kind="ghost" small onPress={() => { setRejectFor(q.id); setRejectReason(''); }} /></View>
                    <View style={{ flex: 2 }}><Btn title="Ajánlat elfogadása ✅" small onPress={() => void acceptQuote(q)} /></View>
                  </View>
                )
              ) : null}
              {q.status === 'requested' && active ? (
                <Btn title="Kérés visszavonása" kind="ghost" small onPress={() => { setRejectReason(''); rejectQuote(q); }} />
              ) : null}
              {(q.status === 'declined' || q.status === 'rejected') && active && !task.quote_accepted_at && !openQuotes(task.id, allQuotes).some((o) => o.worker_id === q.worker_id) ? (
                <Btn title={`↻ Új ajánlatkérés: ${workerName(q.worker_id)}`} kind="secondary" small onPress={() => void requestQuote(q.worker_id)} />
              ) : null}
            </View>
          ))}
          {active && !task.quote_accepted_at ? (
            <View style={{ gap: S.sm, paddingTop: 4 }}>
              <Sub>Új ajánlatkérés — bárkitől, akár ugyanattól az embertől is:</Sub>
              <View style={{ flexDirection: 'row', gap: S.sm, alignItems: 'flex-end' }}>
                <View style={{ flex: 1 }}>
                  <Picker items={workers.filter((w) => !!w.approved_at).sort((a, b) => wname(a).localeCompare(wname(b), 'hu'))}
                    selectedId={requestWorker} getId={(w) => w.id} getLabel={(w) => wname(w)} onSelect={setRequestWorker} placeholder="Válassz munkavállalót…" />
                </View>
                <Btn title="Ajánlatot kérek 💬" small disabled={!requestWorker} onPress={() => requestWorker && void requestQuote(requestWorker)} />
              </View>
            </View>
          ) : null}
        </Section>
      ) : null}

      {/* ---------- munkavállalói műveletek ---------- */}
      {isWorker && myAssignment && active && !quoteOpenForMe && !(isQuoteTask && mine && mine.status !== 'accepted') ? (
        <Card style={{ borderColor: C.accent }}>
          <H2>Teendőid</H2>
          {!myAssignment.acknowledged_at ? (
            <Btn title="Feladat elfogadása ✅" onPress={acknowledge} />
          ) : (
            <>
              {startedByMe
                ? <Btn title="Kész ✔" onPress={() => void markDone()} />
                : <Sub style={{ color: C.warning }}>A feladat akkor jelölhető késznek, ha előtte elindítottad rajta a munkát (⏱ Munkaidő).</Sub>}
              {!failOpen ? (
                <Btn title="Nem tudom megcsinálni ⚠️" kind="ghost" onPress={() => setFailOpen(true)} />
              ) : (
                <View style={{ gap: S.sm }}>
                  <Sub>Kötelező leírni, miért nem sikerült. Több fotót is csatolhatsz.</Sub>
                  <Input label="Indoklás *" value={failReason} onChangeText={setFailReason} multiline placeholder="pl. hiányzik az anyag / nem lehetett bejutni…" />
                  <View style={{ flexDirection: 'row', gap: S.sm }}>
                    <View style={{ flex: 1 }}><Btn title="📷 Fotó" kind="ghost" small onPress={() => void pick(true, 'fail')} /></View>
                    <View style={{ flex: 1 }}><Btn title="🖼 Galéria" kind="ghost" small onPress={() => void pick(false, 'fail')} /></View>
                  </View>
                  <PhotoThumbs local={failPhotos} onRemoveLocal={(i) => setFailPhotos((ps) => ps.filter((_, j) => j !== i))} />
                  <View style={{ flexDirection: 'row', gap: S.sm }}>
                    <View style={{ flex: 1 }}><Btn title="Mégse" kind="ghost" onPress={() => setFailOpen(false)} /></View>
                    <View style={{ flex: 1 }}><Btn title={busy ? '…' : 'Küldés'} kind="danger" onPress={() => void submitFail()} disabled={busy || failReason.trim().length < 3} /></View>
                  </View>
                </View>
              )}
            </>
          )}
        </Card>
      ) : null}

      {/* ---------- anyagköltségek ---------- */}
      {isWorker && !acked ? null : (
      <Section title="📦 Anyagköltség" defaultOpen={isWorker || mat.unpriced.length > 0}
        summary={materials.length ? `${materials.length} tétel · ${ft(mat.cost)}${!isWorker && mat.unpriced.length ? ` · ${mat.unpriced.length} beárazandó` : ''}` : 'nincs'}>
        {materials.length === 0 ? <Sub>Nincs rögzített anyagköltség.</Sub> : null}
        {materials.map((m) => (
          <View key={m.id} style={{ gap: 4, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: C.border }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Body style={{ fontWeight: '700' }}>{ft(m.amount)}{m.note ? ` — ${m.note}` : ''}</Body>
              {!isWorker ? <Btn title="🗑️" kind="ghost" small onPress={() => void deleteMaterial(m)} /> : null}
            </View>
            <PhotoThumbs paths={materialPhotos(m)} />
            <Sub>{m.worker_id ? workerName(m.worker_id) : creator} · {hdt(m.created_at)}</Sub>
            {!isWorker ? (
              mat.priceOf(m) && resaleDraft[m.id] === undefined ? (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Sub>Továbbszámlázva: <Text style={{ fontWeight: '700', color: C.text }}>{ft(mat.priceOf(m)!.resale_net)}</Text> · haszon {ft(Number(mat.priceOf(m)!.resale_net) - Number(m.amount))}</Sub>
                  <Btn title="Módosít" kind="ghost" small onPress={() => setResaleDraft((d) => ({ ...d, [m.id]: String(mat.priceOf(m)!.resale_net) }))} />
                </View>
              ) : (
                <View style={{ flexDirection: 'row', gap: S.sm, alignItems: 'flex-end' }}>
                  <View style={{ flex: 1 }}>
                    <Input label="Mennyiért számlázod tovább? (Ft) *" value={resaleDraft[m.id] ?? ''} onChangeText={(v) => setResaleDraft((d) => ({ ...d, [m.id]: v }))} keyboardType="numeric" placeholder="beárazandó" />
                  </View>
                  <Btn title="Mentés" small onPress={() => saveResale(m)} disabled={!resaleDraft[m.id]} />
                </View>
              )
            ) : null}
          </View>
        ))}
        {materials.length > 0 ? (
          <KV k="Anyag összesen (beszerzés)" v={ft(mat.cost)} strong />
        ) : null}
        {isWorker && myAssignment && active ? (
          !matOpen ? (
            <Btn title="+ Anyagköltség hozzáadása (fotóval)" kind="secondary" onPress={() => setMatOpen(true)} />
          ) : (
            <View style={{ gap: S.sm }}>
              <Input label="Összeg (Ft) *" value={matAmount} onChangeText={setMatAmount} keyboardType="numeric" placeholder="pl. 12 500" />
              <Input label="Mi ez?" value={matNote} onChangeText={setMatNote} placeholder="pl. csemperagasztó 2 zsák" />
              <Sub>Számla / blokk fotója kötelező — több kép is csatolható egy tételhez (a galériában egyszerre több is kijelölhető):</Sub>
              <View style={{ flexDirection: 'row', gap: S.sm }}>
                <View style={{ flex: 1 }}><Btn title="📷 Fotó" kind="ghost" small onPress={() => void pick(true, 'mat')} /></View>
                <View style={{ flex: 1 }}><Btn title="🖼 Galéria" kind="ghost" small onPress={() => void pick(false, 'mat')} /></View>
              </View>
              {matPhotos.length ? <PhotoThumbs local={matPhotos} onRemoveLocal={(i) => setMatPhotos((ps) => ps.filter((_, j) => j !== i))} /> : <Sub style={{ color: C.warning }}>még nincs fotó (több is csatolható)</Sub>}
              <View style={{ flexDirection: 'row', gap: S.sm }}>
                <View style={{ flex: 1 }}><Btn title="Mégse" kind="ghost" onPress={() => setMatOpen(false)} /></View>
                <View style={{ flex: 1 }}><Btn title={busy ? '…' : 'Rögzítés'} onPress={() => void submitMaterial()} disabled={busy || !matAmount || matPhotos.length === 0} /></View>
              </View>
            </View>
          )
        ) : null}
      </Section>
      )}

      {/* ---------- partner: pénzügy ---------- */}
      {!isWorker && wage ? (
        <Section title="💰 Pénzügy" accent defaultOpen={finance?.invoice_net == null}
          summary={profit == null ? `bér ${ft(wageTotal)} · nincs kiszámlázott érték` : `haszon ${ft(profit)}`}>
          {task.quote_amount != null && task.quote_accepted_at ? (
            <KV k="Bérköltség (elfogadott ajánlat)" v={ft(wageTotal)} strong />
          ) : (
            <>
              {wageRows.map((a) => (
                <KV key={a.id}
                  k={`${workerName(a.worker_id)} · ${hd(a.work_date)} · ${a.pay_basis === 'hourly' ? `${a.hours} ó × ${ft(Number(a.applied_rate))}` : a.pay_basis === 'daily' ? 'napi díj' : a.pay_basis === 'project' ? 'projektdíj' : 'jelenlét'}${a.paid_at ? ' ✓' : ''}`}
                  v={ft(Number(a.amount))} />
              ))}
              {wage.parts.filter((p) => p.amount > 0).map((p) => (
                <KV key={`run-${p.worker.id}`} k={`${wname(p.worker)} · épp fut (${fmtHours(p.hours)}, előnézet)`} v={`~${ft(p.amount)}`} />
              ))}
              {wageRows.length === 0 && wage.total === 0 ? <Sub>Még nincs könyvelt bér — a munkaidő lezárásakor képződik.</Sub> : null}
              <KV k="Bérköltség eddig" v={ft(wageTotal)} strong />
            </>
          )}
          <KV k="Anyag beszerzés" v={ft(mat.cost)} />
          <KV k="Anyag továbbszámlázva" v={mat.unpriced.length ? `${ft(mat.resale)} (+${mat.unpriced.length} beárazandó)` : ft(mat.resale)} />
          <Divider />
          {invoiceStr === null ? (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Body>Kiszámlázott érték: <Text style={{ fontWeight: '800' }}>{finance?.invoice_net != null ? ft(finance.invoice_net) : '— nincs megadva'}</Text></Body>
              <Btn title={finance?.invoice_net != null ? 'Módosít' : 'Megad'} kind="ghost" small onPress={() => setInvoiceStr(finance?.invoice_net != null ? String(finance.invoice_net) : '')} />
            </View>
          ) : (
            <View style={{ flexDirection: 'row', gap: S.sm, alignItems: 'flex-end' }}>
              <View style={{ flex: 1 }}><Input label="Kiszámlázott érték (nettó Ft)" value={invoiceStr} onChangeText={setInvoiceStr} keyboardType="numeric" /></View>
              <Btn title="Mentés" small onPress={saveInvoice} />
            </View>
          )}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
            <Body style={{ fontWeight: '800' }}>Haszon</Body>
            <Text style={{ fontSize: 18, fontWeight: '800', color: profit == null ? C.sub : profit >= 0 ? C.success : C.danger }}>
              {profit == null ? 'add meg a kiszámlázott értéket' : ft(profit)}
            </Text>
          </View>
          <Sub>Haszon = kiszámlázott + továbbszámlázott anyag − bérköltség − anyag beszerzési ára.</Sub>
          <View style={{ flexDirection: 'row', gap: S.sm }}>
            {active ? <View style={{ flex: 1 }}><Btn title="Visszavonás" kind="ghost" small onPress={() => void cancelTask()} /></View> : null}
            <View style={{ flex: 1 }}><Btn title="🗑️ Feladat törlése" kind="ghost" small onPress={() => void deleteTask()} /></View>
          </View>
        </Section>
      ) : null}
    </Screen>
  );
}
