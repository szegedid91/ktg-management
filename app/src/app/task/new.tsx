// Új feladat kiadása egy vagy több munkavállalónak (+ ajánlatkérés)

import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { C, S } from '../../ui/theme';
import { useLocalSearchParams } from 'expo-router';
import { smartBack } from '../../lib/nav';
import { Screen, Card, H2, Sub, Input, Btn, Picker, Check, Empty } from '../../ui/kit';
import { useTable } from '../../lib/hooks';
import { insertRow, newId, getCurrentUserId as currentUser } from '../../lib/repo';
import { parseAmount } from '../../lib/format';
import { getCurrentUserId } from '../../lib/repo';
import { notify } from '../../lib/dialogs';
import { pickPhotos, uploadTaskPhoto, PickedPhoto } from '../../lib/photo';
import { PhotoThumbs } from '../../components/PhotoThumbs';
import { Site, Worker, TaskTemplate, Profile } from '../../lib/types';
import { addDaysISO, todayISO } from '../../lib/format';
import { wname } from '../../lib/tasks';

export default function NewTask() {
  const { workerId, siteId } = useLocalSearchParams<{ workerId?: string; siteId?: string }>();
  const sites = useTable<Site>('sites').filter((s) => s.status === 'active');
  const workers = [...useTable<Worker>('workers')].filter((w) => !!w.approved_at).sort((a, b) => a.name.localeCompare(b.name, 'hu'));
  const isWorker = !!useTable<Profile>('profiles').find((p) => p.id === currentUser())?.worker_id;

  const [title, setTitle] = useState('');
  const [code, setCode] = useState('');
  const [details, setDetails] = useState('');
  const [site, setSite] = useState<string | null>(siteId ?? null);
  const [chosen, setChosen] = useState<Set<string>>(new Set(workerId ? [workerId] : []));
  const [quote, setQuote] = useState(false);
  const [priority, setPriority] = useState(false);
  const [invoice, setInvoice] = useState('');
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
    if (chosen.size === 0) { notify('Hiba', 'Válassz legalább egy munkavállalót.'); return; }
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
    if (invoice.trim()) insertRow('task_finance', { task_id: taskId, invoice_net: parseAmount(invoice) });
    for (const wid of chosen) insertRow('task_assignees', { task_id: taskId, worker_id: wid });
    if (photoFails) notify('Fotó', `${photoFails} fotót nem sikerült feltölteni (internet?) — a feladat nélkülük ment ki.`);
    notify(quote ? 'Ajánlatkérés kiküldve 💬' : 'Feladat kiadva 🛠️',
      quote
        ? 'A munkavállaló(k) értesítést kapnak, és az appban adnak ajánlatot — azt neked kell elfogadnod.'
        : 'A munkavállaló(k) értesítést kapnak, és az appban fogadják el a feladatot.');
    smartBack();
  };

  if (isWorker) return <Screen><Empty text="Feladatot csak a fő felhasználók adhatnak ki." /></Screen>;

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
        <Sub>Több munkavállaló is kijelölhető — mindegyik külön fogadja el.</Sub>
        {workers.map((w) => (
          <Check key={w.id} checked={chosen.has(w.id)} onToggle={() => toggle(w.id)}
            label={wname(w)} sub={w.nickname ? `${w.name}${w.trade ? ` · ${w.trade}` : ''}` : (w.trade ?? undefined)} />
        ))}
        {workers.length === 0 ? <Sub>Nincs munkavállaló felvéve.</Sub> : null}
      </Card>

      <Card>
        <H2>Ár és számlázás</H2>
        <Check checked={quote} onToggle={() => setQuote(!quote)}
          label="Ajánlatot kérek a munkavállalótól"
          sub="A munkavállaló megadja, mennyiért vállalja; a bérköltség az elfogadott ajánlat lesz." />
        <Input label="Kiszámlázott érték (nettó Ft) — később is megadható" value={invoice} onChangeText={setInvoice} keyboardType="numeric" placeholder="pl. 250 000" />
      </Card>

      <View style={{ paddingBottom: 8 }}>
        <Btn title={saving ? '…' : quote ? 'Ajánlatkérés kiküldése' : 'Feladat kiadása'} onPress={() => void save()} disabled={saving} />
      </View>
    </Screen>
  );
}
