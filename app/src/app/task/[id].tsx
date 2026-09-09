// Feladat részletei — partnernek (idő, bérköltség, anyag beárazás, számlázás,
// haszon, ajánlat elfogadása) és munkavállalónak (visszaigazolás, ajánlat,
// munkaidő, kész / nem sikerült indokkal+fotóval, anyagköltség fotóval).

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Linking, Pressable } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Screen, Card, H2, Sub, Body, Btn, Input, KV, Divider, Badge, Empty } from '../../ui/kit';
import { C, S } from '../../ui/theme';
import { useTable, useRow } from '../../lib/hooks';
import { getCurrentUserId, insertRow, updateRow, queueRpc } from '../../lib/repo';
import { ft, hdt, parseAmount } from '../../lib/format';
import { notify, confirmDialog } from '../../lib/dialogs';
import { pickPhoto, uploadTaskPhoto, taskPhotoUrl, PickedPhoto } from '../../lib/photo';
import {
  TASK_STATUS_LABEL, taskTiming, taskWageCost, materialTotals, taskProfit, fmtHours, isActiveTask, wname,
} from '../../lib/tasks';
import {
  WorkerTask, TaskAssignee, TaskMaterial, TaskMaterialPricing, TaskFinance, WorkSession, Worker, Site, Profile,
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
  const wage = useMemo(() => (task ? taskWageCost(task, assigneeWorkers, sessions, now) : null), [task, assigneeWorkers, sessions, now]);
  const mat = useMemo(() => materialTotals(materials, pricing), [materials, pricing]);
  const profit = task && wage ? taskProfit(finance?.invoice_net, wage.total, materials, pricing) : null;

  // űrlap-állapotok
  const [invoiceStr, setInvoiceStr] = useState<string | null>(null);
  const [resaleDraft, setResaleDraft] = useState<Record<string, string>>({});
  const [quoteAmount, setQuoteAmount] = useState('');
  const [quoteNote, setQuoteNote] = useState('');
  const [failOpen, setFailOpen] = useState(false);
  const [failReason, setFailReason] = useState('');
  const [failPhotos, setFailPhotos] = useState<PickedPhoto[]>([]);
  const [matOpen, setMatOpen] = useState(false);
  const [matAmount, setMatAmount] = useState('');
  const [matNote, setMatNote] = useState('');
  const [matPhoto, setMatPhoto] = useState<PickedPhoto | null>(null);
  const [busy, setBusy] = useState(false);

  if (!task) return <Screen><Empty text="Feladat nem található (szinkronizálás folyamatban?)" /></Screen>;

  const site = sites.find((s) => s.id === task.site_id);
  const creator = profiles.find((p) => p.id === task.created_by)?.display_name ?? '?';
  const workerName = (wid: string) => wname(workers.find((w) => w.id === wid));
  const myAssignment = assignees.find((a) => a.worker_id === myWorkerId);
  const openSession = sessions.find((s) => !s.ended_at && s.worker_id === myWorkerId);
  const active = isActiveTask(task);
  // a munkavállaló csak visszaigazolás után indíthat munkát / rögzíthet anyagot
  const acked = !!myAssignment?.acknowledged_at;
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
    notify('Feladat elfogadva ✅', 'A kiadó értesítést kap, hogy elfogadtad a feladatot.');
  };

  const sendQuote = () => {
    const amount = parseAmount(quoteAmount);
    if (amount <= 0) { notify('Hiba', 'Adj meg ajánlati összeget.'); return; }
    queueRpc('worker_task_action', { p_id: task.id, p_action: 'quote', p_amount: amount, p_reason: quoteNote.trim() || null }, [
      { table: 'worker_tasks', id: task.id, patch: { quote_amount: amount, quote_note: quoteNote.trim() || null, quote_submitted_at: nowISO(), quote_accepted_at: null } },
    ]);
    setQuoteAmount(''); setQuoteNote('');
    notify('Ajánlat elküldve 💬', 'A fő felhasználó értesítést kap; elfogadás után jelez.');
  };

  const startWork = () => {
    insertRow('work_sessions', { worker_id: myWorkerId, task_id: task.id, site_id: task.site_id, started_at: nowISO(), ended_at: null, note: null });
  };
  const stopWork = () => {
    if (openSession) updateRow('work_sessions', openSession.id, { ended_at: nowISO() });
  };

  const markDone = async () => {
    if (!await confirmDialog('Feladat kész', 'Jelzed a kiadónak, hogy elkészültél a feladattal?', 'Kész ✔')) return;
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
    if (!matPhoto) { notify('Fotó kötelező', 'Anyagköltséghez a számla/blokk fotója kötelező.'); return; }
    setBusy(true);
    try {
      const path = await uploadTaskPhoto(matPhoto.base64, `${task.id}/material`);
      insertRow('task_materials', { task_id: task.id, worker_id: myWorkerId, amount, note: matNote.trim() || null, photo_path: path });
      setMatOpen(false); setMatAmount(''); setMatNote(''); setMatPhoto(null);
      notify('Anyagköltség rögzítve 📦', 'A fő felhasználók értesítést kapnak róla.');
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
  const acceptQuote = async () => {
    if (!await confirmDialog('Ajánlat elfogadása', `${ft(task.quote_amount ?? 0)} — ettől kezdve ez a feladat bérköltsége. A munkavállaló értesítést kap.`, 'Elfogadom')) return;
    queueRpc('accept_task_quote', { p_id: task.id }, [
      { table: 'worker_tasks', id: task.id, patch: { quote_accepted_at: nowISO(), quote_accepted_by: me } },
    ]);
  };
  const cancelTask = async () => {
    if (!await confirmDialog('Feladat visszavonása', 'A feladat lezárul „visszavont” állapottal.', 'Visszavonás', true)) return;
    updateRow('worker_tasks', task.id, { status: 'cancelled' });
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
    const p = await pickPhoto(fromCamera);
    if (!p) return;
    if (target === 'fail') setFailPhotos((ps) => [...ps, p]); else setMatPhoto(p);
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: task.code ? `${task.code} · ${task.title}` : task.title }} />

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
          <Badge text={TASK_STATUS_LABEL[task.status]} color={STATUS_COLOR[task.status]} />
          {task.quote_requested && !task.quote_accepted_at ? <Badge text="ajánlatkérés" color={C.primary} /> : null}
        </View>
        <H2>{task.code ? `${task.code} — ` : ''}{task.title}</H2>
        {task.details ? <Body>{task.details}</Body> : null}
        <Divider />
        <KV k="Helyszín" v={site ? `${site.name}${site.address ? ` · ${site.address}` : ''}` : '—'} />
        <KV k="Kiadta" v={creator} />
        <KV k="Kiosztva" v={assignees.map((a) => `${workerName(a.worker_id)} ${a.acknowledged_at ? '✓' : '⏳'}`).join(', ') || '—'} />
        {assignees.some((a) => !a.acknowledged_at) ? <Sub>⏳ = még nem fogadta el · ✓ = elfogadta</Sub> : null}
        {(task.photo_paths ?? []).length > 0 || !isWorker ? (
          <View style={{ gap: 4 }}>
            <Sub>📷 Fotók a feladathoz{(task.photo_paths ?? []).length ? ` (${task.photo_paths.length})` : ''}</Sub>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
              {(task.photo_paths ?? []).map((ph, i) => (
                <Btn key={ph} title={`Fotó ${i + 1}`} kind="ghost" small onPress={() => void openPhoto(ph)} />
              ))}
              {!isWorker && active ? (
                <Btn title={busy ? '…' : '+ Fotó'} kind="secondary" small disabled={busy} onPress={() => void addTaskPhoto()} />
              ) : null}
            </View>
          </View>
        ) : null}
        {task.fail_reason ? (
          <View style={{ backgroundColor: C.dangerBg, padding: S.md, borderRadius: 8, gap: 4 }}>
            <Body style={{ fontWeight: '700', color: C.danger }}>⚠️ Nem sikerült — indok:</Body>
            <Body>{task.fail_reason}</Body>
            {(task.fail_photo_paths?.length ? task.fail_photo_paths : task.fail_photo_path ? [task.fail_photo_path] : []).length > 0 ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
                {(task.fail_photo_paths?.length ? task.fail_photo_paths : [task.fail_photo_path!]).map((ph, i) => (
                  <Btn key={ph} title={`📷 Fotó ${i + 1}`} kind="ghost" small onPress={() => void openPhoto(ph)} />
                ))}
              </View>
            ) : null}
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

      {/* ---------- ajánlat ---------- */}
      {task.quote_requested || task.quote_amount != null ? (
        <Card style={{ borderColor: C.primary }}>
          <H2>💬 Ajánlat</H2>
          {task.quote_amount != null ? (
            <>
              <KV k="Ajánlati ár" v={ft(task.quote_amount)} strong />
              {task.quote_note ? <Sub>{task.quote_note}</Sub> : null}
              <Sub>{task.quote_accepted_at ? `✅ Ajánlat elfogadva ${hdt(task.quote_accepted_at)}` : 'Az ajánlat elfogadásra vár'}</Sub>
              {!isWorker && !task.quote_accepted_at ? <Btn title="Ajánlat elfogadása ✅" onPress={() => void acceptQuote()} /> : null}
            </>
          ) : isWorker && myAssignment ? (
            <>
              <Sub>Add meg, mennyiért vállalod a feladatot.</Sub>
              <Input label="Ajánlati ár (Ft)" value={quoteAmount} onChangeText={setQuoteAmount} keyboardType="numeric" placeholder="pl. 120 000" />
              <Input label="Megjegyzés" value={quoteNote} onChangeText={setQuoteNote} placeholder="opcionális" />
              <Btn title="Ajánlat küldése" onPress={sendQuote} disabled={!quoteAmount} />
            </>
          ) : <Sub>A munkavállaló ajánlatára várunk.</Sub>}
        </Card>
      ) : null}

      {/* ---------- munkavállalói műveletek ---------- */}
      {isWorker && myAssignment && active ? (
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
                  {failPhotos.length > 0 ? (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Sub>✓ {failPhotos.length} fotó csatolva</Sub>
                      <Btn title="Törlés" kind="ghost" small onPress={() => setFailPhotos([])} />
                    </View>
                  ) : null}
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
              <Btn title="📷" kind="ghost" small onPress={() => void openPhoto(m.photo_path)} />
            </View>
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
              <Sub>Számla / blokk fotója kötelező:</Sub>
              <View style={{ flexDirection: 'row', gap: S.sm }}>
                <View style={{ flex: 1 }}><Btn title="📷 Fotó" kind="ghost" small onPress={() => void pick(true, 'mat')} /></View>
                <View style={{ flex: 1 }}><Btn title="🖼 Galéria" kind="ghost" small onPress={() => void pick(false, 'mat')} /></View>
              </View>
              {matPhoto ? <Sub>✓ fotó csatolva</Sub> : <Sub style={{ color: C.warning }}>még nincs fotó</Sub>}
              <View style={{ flexDirection: 'row', gap: S.sm }}>
                <View style={{ flex: 1 }}><Btn title="Mégse" kind="ghost" onPress={() => setMatOpen(false)} /></View>
                <View style={{ flex: 1 }}><Btn title={busy ? '…' : 'Rögzítés'} onPress={() => void submitMaterial()} disabled={busy || !matAmount || !matPhoto} /></View>
              </View>
            </View>
          )
        ) : null}
      </Section>
      )}

      {/* ---------- partner: pénzügy ---------- */}
      {!isWorker && wage ? (
        <Section title="💰 Pénzügy" accent defaultOpen={finance?.invoice_net == null}
          summary={profit == null ? `bér ${ft(wage.total)} · nincs kiszámlázott érték` : `haszon ${ft(profit)}`}>
          {task.quote_amount != null && task.quote_accepted_at ? (
            <KV k="Bérköltség (elfogadott ajánlat)" v={ft(wage.total)} strong />
          ) : (
            <>
              {wage.parts.map((p) => (
                <KV key={p.worker.id}
                  k={`${wname(p.worker)} · ${p.basis === 'hourly' ? `${fmtHours(p.hours)} × ${ft(p.worker.hourly_rate ?? 0)}/ó` : p.basis === 'daily' ? `napi ${ft(p.worker.daily_rate ?? 0)}` : `projekt ${ft(p.worker.project_rate ?? 0)}`}`}
                  v={ft(p.amount)} />
              ))}
              <KV k="Bérköltség eddig (idő alapján)" v={ft(wage.total)} strong />
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
          {active ? <Btn title="Feladat visszavonása" kind="ghost" small onPress={() => void cancelTask()} /> : null}
        </Section>
      ) : null}
    </Screen>
  );
}
