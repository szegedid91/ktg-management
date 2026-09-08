// Új feladat kiadása egy vagy több munkavállalónak (+ ajánlatkérés)

import React, { useState } from 'react';
import { View } from 'react-native';
import { S } from '../../ui/theme';
import { useLocalSearchParams } from 'expo-router';
import { smartBack } from '../../lib/nav';
import { Screen, Card, H2, Sub, Input, Btn, Picker, Check } from '../../ui/kit';
import { useTable } from '../../lib/hooks';
import { insertRow, newId } from '../../lib/repo';
import { parseAmount } from '../../lib/format';
import { notify } from '../../lib/dialogs';
import { pickPhoto, uploadTaskPhoto, PickedPhoto } from '../../lib/photo';
import { Site, Worker } from '../../lib/types';
import { wname } from '../../lib/tasks';

export default function NewTask() {
  const { workerId, siteId } = useLocalSearchParams<{ workerId?: string; siteId?: string }>();
  const sites = useTable<Site>('sites').filter((s) => s.status === 'active');
  const workers = [...useTable<Worker>('workers')].sort((a, b) => a.name.localeCompare(b.name, 'hu'));

  const [title, setTitle] = useState('');
  const [code, setCode] = useState('');
  const [details, setDetails] = useState('');
  const [site, setSite] = useState<string | null>(siteId ?? null);
  const [chosen, setChosen] = useState<Set<string>>(new Set(workerId ? [workerId] : []));
  const [quote, setQuote] = useState(false);
  const [invoice, setInvoice] = useState('');
  const [saving, setSaving] = useState(false);
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);

  const addPhoto = async (fromCamera: boolean) => {
    const p = await pickPhoto(fromCamera);
    if (p) setPhotos((ps) => [...ps, p]);
  };

  const toggle = (id: string) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id); else next.add(id);
    setChosen(next);
  };

  const save = async () => {
    if (!title.trim()) { notify('Hiba', 'Adj címet a feladatnak.'); return; }
    if (chosen.size === 0) { notify('Hiba', 'Válassz legalább egy munkavállalót.'); return; }
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
      quote_requested: quote,
      invoice_net: invoice.trim() ? parseAmount(invoice) : null,
      photo_paths: paths,
    });
    for (const wid of chosen) insertRow('task_assignees', { task_id: taskId, worker_id: wid });
    if (photoFails) notify('Fotó', `${photoFails} fotót nem sikerült feltölteni (internet?) — a feladat nélkülük ment ki.`);
    notify(quote ? 'Ajánlatkérés kiküldve 💬' : 'Feladat kiadva 🛠️',
      quote
        ? 'A munkavállaló(k) értesítést kapnak, és az appban adnak ajánlatot — azt neked kell elfogadnod.'
        : 'A munkavállaló(k) értesítést kapnak, és az appban fogadják el a feladatot.');
    smartBack();
  };

  return (
    <Screen>
      <Card>
        <H2>Feladat</H2>
        <Input label="Feladat címe *" value={title} onChangeText={setTitle} placeholder="pl. Csempézés a fürdőben" />
        <Input label="Kód (hibakód / feladatkód)" value={code} onChangeText={setCode} placeholder="pl. H-101" autoCapitalize="none" />
        <Input label="Részletek" value={details} onChangeText={setDetails} placeholder="Mit, hol, mivel…" multiline />
        <Picker label="Helyszín (építkezés)" items={sites} selectedId={site} getId={(s) => s.id}
          getLabel={(s) => s.address ? `${s.name} — ${s.address}` : s.name} onSelect={setSite}
          allowNull nullLabel="— nincs helyszín —" />
      </Card>

      <Card>
        <H2>📷 Fotók a feladathoz</H2>
        <Sub>Pl. a hiba, a helyszín vagy a rajz — a munkavállaló a feladat oldalán nyitja meg.</Sub>
        <View style={{ flexDirection: 'row', gap: S.sm }}>
          <View style={{ flex: 1 }}><Btn title="📷 Fotózás" kind="ghost" small onPress={() => void addPhoto(true)} /></View>
          <View style={{ flex: 1 }}><Btn title="🖼 Galériából" kind="ghost" small onPress={() => void addPhoto(false)} /></View>
        </View>
        {photos.length > 0 ? (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Sub>✓ {photos.length} fotó csatolva</Sub>
            <Btn title="Törlés" kind="ghost" small onPress={() => setPhotos([])} />
          </View>
        ) : null}
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
