// Új feladat kiadása egy vagy több munkavállalónak (+ ajánlatkérés)

import React, { useState, useMemo } from 'react';
import { View, Text, Pressable  } from 'react-native';
import { C, S } from '../../ui/theme';
import { useLocalSearchParams, router } from 'expo-router';
import { smartBack } from '../../lib/nav';
import { Screen, Card, H2, Sub, Input, Btn, Picker, Check, Empty } from '../../ui/kit';
import { useTable } from '../../lib/hooks';
import { insertRow, newId, getCurrentUserId as currentUser } from '../../lib/repo';
import { getCurrentUserId } from '../../lib/repo';
import { notify } from '../../lib/dialogs';
import { pickPhotos, uploadTaskPhoto, PickedPhoto } from '../../lib/photo';
import { PhotoThumbs } from '../../components/PhotoThumbs';
import { Site, Worker, TaskTemplate, Profile, WorkSession, Attendance, TaskMaterial, TaskAssignee, WorkerTask } from '../../lib/types';
import { addDaysISO, todayISO, hd, ft } from '../../lib/format';
import { wname, sessionHours, fmtHours } from '../../lib/tasks';

export default function NewTask() {
  const { workerId, siteId } = useLocalSearchParams<{ workerId?: string; siteId?: string }>();
  const sites = useTable<Site>('sites').filter((s) => s.status === 'active').sort((a, b) => a.name.localeCompare(b.name, 'hu', { sensitivity: 'base' }));
  // a vállalkozók emberei (fiók nélkül) nem kapnak külön feladatot: a vállalkozó viszi őket
  const workers = [...useTable<Worker>('workers')].filter((w) => !!w.approved_at && !w.contractor_id).sort((a, b) => a.name.localeCompare(b.name, 'hu'));
  const [workerQ, setWorkerQ] = useState('');
  const [chosen, setChosen] = useState<Set<string>>(new Set(workerId ? [workerId] : []));
  const shownWorkers = workers.filter((w) => {
    const q = workerQ.trim().toLowerCase();
    return !q || `${w.name} ${w.nickname ?? ''} ${w.trade ?? ''}`.toLowerCase().includes(q) || chosen.has(w.id);
  });
  const isWorker = !!useTable<Profile>('profiles').find((p) => p.id === currentUser())?.worker_id;

  const [title, setTitle] = useState('');
  // hasonló korábbi (kész) feladatok: mennyibe került legutóbb
  const doneTasks = useTable<WorkerTask>('worker_tasks').filter((t) => t.status === 'done');
  const allSessions = useTable<WorkSession>('work_sessions');
  const allAttendance = useTable<Attendance>('attendance');
  const allMaterials = useTable<TaskMaterial>('task_materials');
  const allAssignees = useTable<TaskAssignee>('task_assignees');
  const allWorkers = useTable<Worker>('workers');
  const similar = useMemo(() => {
    const words = title.toLowerCase().split(/[^a-záéíóöőúüű0-9]+/i).filter((w) => w.length >= 4);
    if (!words.length) return [];
    return doneTasks
      .map((t) => {
        const hay = `${t.title} ${t.details ?? ''}`.toLowerCase();
        const score = words.filter((w) => hay.includes(w)).length;
        return { t, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || (b.t.done_at ?? '').localeCompare(a.t.done_at ?? ''))
      .slice(0, 3)
      .map(({ t }) => {
        const hours = allSessions.filter((s) => s.task_id === t.id && s.ended_at).reduce((sum, s) => sum + sessionHours(s), 0);
        const wageRows = allAttendance.filter((a) => a.task_id === t.id).reduce((sum, a) => sum + Number(a.amount), 0);
        const wage = t.quote_accepted_at && t.quote_amount != null ? Number(t.quote_amount) : wageRows;
        const mats = allMaterials.filter((m) => m.task_id === t.id).reduce((sum, m) => sum + Number(m.amount), 0);
        const names = allAssignees.filter((a) => a.task_id === t.id).map((a) => wname(allWorkers.find((w) => w.id === a.worker_id))).join(', ');
        return { t, hours, wage, mats, names };
      });
  }, [title, doneTasks, allSessions, allAttendance, allMaterials, allAssignees, allWorkers]);
  const [code, setCode] = useState('');
  const [details, setDetails] = useState('');
  const [site, setSite] = useState<string | null>(siteId ?? null);
  const [quote, setQuote] = useState(false);
  const [priority, setPriority] = useState(false);
  const [saving, setSaving] = useState(false);
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  // sablon, határidő, részfeladatok
  const templates = useTable<TaskTemplate>('task_templates').sort((a, b) => a.name.localeCompare(b.name, 'hu'));
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState('');
  // részfeladatok egyelőre nincsenek a felületen (a sablon mező üres marad)
  const subtasks: { title: string; photo_required: boolean }[] = [];
  const [dueOpen, setDueOpen] = useState(false);
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [templateName, setTemplateName] = useState('');

  const applyTemplate = (id: string | null) => {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setTitle(t.title);
    setDetails(t.details ?? '');
    if (t.code_prefix && !code) setCode(t.code_prefix);
    setPriority(t.priority > 0);
    setQuote(t.quote_requested);
    if (t.due_days != null) { setDueDate(addDaysISO(todayISO(), t.due_days)); setDueOpen(true); }
  };

  const addPhoto = async (fromCamera: boolean) => {
    const list = await pickPhotos(fromCamera);
    if (list.length) setPhotos((ps) => [...ps, ...list]);
  };

  const toggle = (id: string) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id); else next.add(id);
    setChosen(next);
  };

  const save = async () => {
    if (!title.trim()) { notify('Hiba', 'Adj címet a feladatnak.'); return; }
    if (!site) { notify('Helyszín kell', 'A bér (munkaidő, ajánlat) építkezésenként képződik — válassz helyszínt a feladathoz.'); return; }
    if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) { notify('Határidő', 'A határidőt ÉÉÉÉ-HH-NN formában add meg.'); return; }
    setSaving(true);
    // a fotók előre mennek fel (internet kell); ha nem sikerül, a feladat
    // fotó nélkül is kimegy
    const taskId = newId();
    const paths: string[] = [];
    let photoFails = 0;
    for (const ph of photos) {
      try { paths.push(await uploadTaskPhoto(ph.base64, `${taskId}/brief`)); } catch { photoFails++; }
    }
    insertRow('worker_tasks', {
      id: taskId,
      title: title.trim(),
      code: code.trim() || null,
      details: details.trim() || null,
      site_id: site,
      status: 'assigned',
      priority: priority ? 1 : 0,
      quote_requested: quote,
      photo_paths: paths,
      due_date: dueDate || null,
    });
    subtasks.forEach((s, i) => insertRow('task_subtasks', {
      task_id: taskId, title: s.title, position: i, photo_required: s.photo_required, photo_paths: [], done_at: null, done_by: null,
      created_by: getCurrentUserId(),
    }));
    if (saveAsTemplate && templateName.trim()) {
      insertRow('task_templates', {
        name: templateName.trim(), title: title.trim(), details: details.trim() || null, code_prefix: code.trim() || null,
        priority: priority ? 1 : 0, quote_requested: quote,
        due_days: dueDate ? Math.max(0, Math.round((new Date(dueDate).getTime() - new Date(todayISO()).getTime()) / 864e5)) : null,
        subtasks, created_by: getCurrentUserId(),
      });
    }
    for (const wid of chosen) insertRow('task_assignees', { task_id: taskId, worker_id: wid });
    if (photoFails) notify('Fotó', `${photoFails} fotót nem sikerült feltölteni (internet?) — a feladat nélkülük ment ki.`);
    if (chosen.size === 0) {
      notify('Feladat elmentve 📋', 'Még nincs kiosztva — a Feladatok „Kiosztatlan” részében találod, és a feladat oldalán a „Kiosztva · Módosít” gombbal adod ki.');
    } else {
      notify(quote ? 'Ajánlatkérés kiküldve 💬' : 'Feladat kiadva 🛠️',
        quote
          ? 'A munkavállaló(k) értesítést kapnak, és az appban adnak ajánlatot — azt neked kell elfogadnod.'
          : 'A munkavállaló(k) értesítést kapnak, és az appban fogadják el a feladatot.');
    }
    smartBack();
  };

  if (isWorker) return <Screen><Empty text="Nincs jogosultságod ehhez az oldalhoz." /></Screen>;

  return (
    <Screen>
      {templates.length > 0 ? (
        <Card>
          <H2>📋 Sablonból</H2>
          <Picker label="Sablon" items={templates} selectedId={templateId} getId={(t) => t.id} getLabel={(t) => t.name}
            onSelect={applyTemplate} placeholder="Válassz sablont (opcionális)…" allowNull nullLabel="— nincs —" />
        </Card>
      ) : null}
      <Card>
        <H2>Feladat</H2>
        <Input label="Feladat címe *" value={title} onChangeText={setTitle} placeholder="pl. Csempézés a fürdőben" />
        {similar.length ? (
          <View style={{ gap: 4, backgroundColor: C.bg, borderRadius: 8, padding: S.sm }}>
            <Sub style={{ fontWeight: '700' }}>📚 Hasonló korábbi feladatok</Sub>
            {similar.map(({ t, hours, wage, mats, names }) => (
              <Pressable key={t.id} onPress={() => router.push(`/task/${t.id}`)} style={{ paddingVertical: 2 }}>
                <Text style={{ color: C.text, fontWeight: '600' }} numberOfLines={1}>{t.code ? `${t.code} · ` : ''}{t.title}</Text>
                <Sub>{t.done_at ? hd(t.done_at) : ''} · {fmtHours(hours)} · bér {ft(wage)} · anyag {ft(mats)}{names ? ` · 👷 ${names}` : ''}</Sub>
              </Pressable>
            ))}
          </View>
        ) : null}
        <Input label="Kód (hibakód / feladatkód)" value={code} onChangeText={setCode} placeholder="pl. H-101" autoCapitalize="none" />
        <Input label="Részletek" value={details} onChangeText={setDetails} placeholder="Mit, hol, mivel…" multiline />
        <Check checked={priority} onToggle={() => setPriority(!priority)} label="🆘 SOS feladat" sub="Sürgős: a listák elején, kiemelve jelenik meg." />
        <Picker label="Helyszín (építkezés) *" items={sites} selectedId={site} getId={(s) => s.id}
          getLabel={(s) => s.address ? `${s.name} — ${s.address}` : s.name} onSelect={setSite}
          />
        <Pressable onPress={() => setDueOpen(!dueOpen)} style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingVertical: 4 }}>
          <Text style={{ fontWeight: '700', color: C.text, flex: 1 }}>📅 Határidő{dueDate ? `: ${dueDate}` : ''}</Text>
          <Text style={{ color: C.sub }}>{dueOpen ? '▾' : '▸ beállítás'}</Text>
        </Pressable>
        {dueOpen ? (
          <>
            <Input label="Határidő (ÉÉÉÉ-HH-NN)" value={dueDate} onChangeText={setDueDate} placeholder={`pl. ${addDaysISO(todayISO(), 7)}`} />
            <View style={{ flexDirection: 'row', gap: S.sm }}>
              {[3, 7, 14].map((d) => (
                <View key={d} style={{ flex: 1 }}><Btn title={`+${d} nap`} kind="ghost" small onPress={() => setDueDate(addDaysISO(todayISO(), d))} /></View>
              ))}
              <View style={{ flex: 1 }}><Btn title="Törlés" kind="ghost" small onPress={() => setDueDate('')} /></View>
            </View>
          </>
        ) : null}
        <Check checked={saveAsTemplate} onToggle={() => setSaveAsTemplate(!saveAsTemplate)} label="Mentés sablonként" sub="Legközelebb egy kattintással kitölthető." />
        {saveAsTemplate ? <Input label="Sablon neve" value={templateName} onChangeText={setTemplateName} placeholder="pl. Fürdő burkolás" /> : null}
      </Card>


      <Card>
        <H2>📷 Fotók a feladathoz</H2>
        <Sub>Pl. a hiba, a helyszín vagy a rajz — a munkavállaló a feladat oldalán nyitja meg.</Sub>
        <View style={{ flexDirection: 'row', gap: S.sm }}>
          <View style={{ flex: 1 }}><Btn title="📷 Fotózás" kind="ghost" small onPress={() => void addPhoto(true)} /></View>
          <View style={{ flex: 1 }}><Btn title="🖼 Galériából" kind="ghost" small onPress={() => void addPhoto(false)} /></View>
        </View>
        <PhotoThumbs local={photos} onRemoveLocal={(i) => setPhotos((ps) => ps.filter((_, j) => j !== i))} />
      </Card>

      <Card>
        <H2>Kinek?</H2>
        <Sub>Több munkavállaló is kijelölhető — mindegyik külön fogadja el. Üresen is hagyhatod: a feladat „kiosztatlan” lesz, és később adod ki.</Sub>
        {workers.length > 6 ? <Input value={workerQ} onChangeText={setWorkerQ} placeholder="Keresés név / szakma szerint…" /> : null}
        {shownWorkers.map((w) => (
          <Check key={w.id} checked={chosen.has(w.id)} onToggle={() => toggle(w.id)}
            label={`${wname(w)}${w.is_contractor ? ' 👥' : ''}`} sub={w.nickname ? `${w.name}${w.trade ? ` · ${w.trade}` : ''}` : (w.trade ?? undefined)} />
        ))}
        {shownWorkers.length === 0 && workers.length > 0 ? <Sub>Nincs találat.</Sub> : null}
        {workers.length === 0 ? <Sub>Nincs munkavállaló felvéve.</Sub> : null}
      </Card>

      <Card>
        <H2>Ajánlat</H2>
        <Check checked={quote} onToggle={() => setQuote(!quote)}
          label="Ajánlatot kérek a munkavállalótól"
          sub="A munkavállaló megadja, mennyiért vállalja; a bérköltség az elfogadott ajánlat lesz." />
        <Sub>A kiszámlázott értéket később, a feladat oldalán adhatod meg.</Sub>
      </Card>

      <View style={{ paddingBottom: 8 }}>
        <Btn title={saving ? '…' : chosen.size === 0 ? 'Mentés kiosztás nélkül' : quote ? 'Ajánlatkérés kiküldése' : 'Feladat kiadása'} onPress={() => void save()} disabled={saving} />
      </View>
    </Screen>
  );
}
