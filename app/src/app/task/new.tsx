// Új feladat kiadása egy vagy több munkavállalónak (+ ajánlatkérés)

import React, { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { smartBack } from '../../lib/nav';
import { Screen, Card, H2, Sub, Input, Btn, Picker, Check } from '../../ui/kit';
import { useTable } from '../../lib/hooks';
import { insertRow } from '../../lib/repo';
import { parseAmount } from '../../lib/format';
import { notify } from '../../lib/dialogs';
import { Site, Worker } from '../../lib/types';

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

  const toggle = (id: string) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id); else next.add(id);
    setChosen(next);
  };

  const save = () => {
    if (!title.trim()) { notify('Hiba', 'Adj címet a feladatnak.'); return; }
    if (chosen.size === 0) { notify('Hiba', 'Válassz legalább egy munkavállalót.'); return; }
    setSaving(true);
    const taskId = insertRow('worker_tasks', {
      title: title.trim(),
      code: code.trim() || null,
      details: details.trim() || null,
      site_id: site,
      status: 'assigned',
      quote_requested: quote,
      invoice_net: invoice.trim() ? parseAmount(invoice) : null,
    });
    for (const wid of chosen) insertRow('task_assignees', { task_id: taskId, worker_id: wid });
    notify(quote ? 'Ajánlatkérés kiküldve 💬' : 'Feladat kiadva 🛠️',
      quote
        ? 'A munkavállaló(k) értesítést kapnak, és az appban adnak ajánlatot — azt neked kell elfogadnod.'
        : 'A munkavállaló(k) értesítést kapnak, és az appban igazolják vissza, hogy megkapták.');
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
        <H2>Kinek?</H2>
        <Sub>Több munkavállaló is kijelölhető — mindegyik külön igazolja vissza.</Sub>
        {workers.map((w) => (
          <Check key={w.id} checked={chosen.has(w.id)} onToggle={() => toggle(w.id)}
            label={w.name} sub={w.trade ?? undefined} />
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
        <Btn title={quote ? 'Ajánlatkérés kiküldése' : 'Feladat kiadása'} onPress={save} disabled={saving} />
      </View>
    </Screen>
  );
}
