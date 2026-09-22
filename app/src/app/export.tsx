import React, { useState } from 'react';
import { View } from 'react-native';
import { Screen, Card, H2, Sub, Btn, Input, Picker, Segmented, Empty } from '../ui/kit';
import { S } from '../ui/theme';
import { useTable, useIsWorker } from '../lib/hooks';
import { downloadExport } from '../lib/exportfile';
import { todayISO } from '../lib/format';
import { Site, Worker } from '../lib/types';
import { notify } from '../lib/dialogs';

function ExportScreenInner() {
  const sites = useTable<Site>('sites');
  const [from, setFrom] = useState(todayISO().slice(0, 7) + '-01');
  const [to, setTo] = useState(todayISO());
  const [site, setSite] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // havi bérkimutatás
  const workers = useTable<Worker>('workers');
  const [month, setMonth] = useState(todayISO().slice(0, 7));
  const [workerId, setWorkerId] = useState<string | null>(null);
  const shiftMonth = (d: number) => {
    const [y, m] = month.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1 + d, 1));
    setMonth(`${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`);
  };
  const monthLabel = `${month.slice(0, 4)}. ${['január', 'február', 'március', 'április', 'május', 'június', 'július', 'augusztus', 'szeptember', 'október', 'november', 'december'][Number(month.slice(5)) - 1]}`;

  // feladat-összesítő: állapot-szűrő + időszak (hét léptethető, a dátumok kézzel is írhatók; üres kezdet = kezdettől)
  type TaskStatusFilter = 'all' | 'open' | 'done' | 'failed';
  const mondayOf = (iso: string) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
  const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const [tStatus, setTStatus] = useState<TaskStatusFilter>('done');
  const [wFrom, setWFrom] = useState(mondayOf(todayISO()));
  const [wTo, setWTo] = useState(addDays(mondayOf(todayISO()), 6));
  const [wSite, setWSite] = useState<string | null>(null);
  const shiftWeek = (n: number) => { const m = addDays(mondayOf(wFrom.trim() || todayISO()), 7 * n); setWFrom(m); setWTo(addDays(m, 6)); };
  const dateLabel = tStatus === 'done' ? 'Készre jelentve' : tStatus === 'failed' ? 'Nem sikerültre jelentve' : 'Kiadva';

  const doExport = async (format: 'xlsx' | 'pdf', mode: 'books' | 'wages' | 'tasks' = 'books') => {
    setBusy(`${mode}-${format}`);
    try {
      await downloadExport(
        mode === 'wages' ? { mode, month, worker_id: workerId, format }
          : mode === 'tasks' ? { mode, status: tStatus, from: wFrom.trim() || undefined, to: wTo.trim() || undefined, site_id: wSite }
          : { from, to, site_id: site, format },
      );
    } catch (e: any) {
      notify('Export hiba', 'Az exporthoz internetkapcsolat kell.\n' + String(e?.message ?? e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen>
      <Card>
        <H2>Könyvelési export</H2>
        <Sub>
          Excel: költséglista számlafotó-hivatkozásokkal, bérek, bevételek,
          ÁFA-bontás külön munkalapokon. PDF: nyomtatható összesítő.
        </Sub>
        <Input label="Időszak kezdete (ÉÉÉÉ-HH-NN)" value={from} onChangeText={setFrom} />
        <Input label="Időszak vége (ÉÉÉÉ-HH-NN)" value={to} onChangeText={setTo} />
        <Picker
          label="Építkezés"
          items={sites}
          selectedId={site}
          getId={(s) => s.id}
          getLabel={(s) => s.name}
          onSelect={setSite}
          allowNull
          nullLabel="— minden építkezés —"
        />
        <View style={{ flexDirection: 'row', gap: S.md }}>
          <View style={{ flex: 1 }}>
            <Btn title={busy === 'books-xlsx' ? 'Készül…' : '📊 Excel (xlsx)'} onPress={() => void doExport('xlsx')} disabled={!!busy} />
          </View>
          <View style={{ flex: 1 }}>
            <Btn title={busy === 'books-pdf' ? 'Készül…' : '📄 PDF'} kind="secondary" onPress={() => void doExport('pdf')} disabled={!!busy} />
          </View>
        </View>
      </Card>

      <Card>
        <H2>Havi bérkimutatás</H2>
        <Sub>Munkavállalónként a hónap napjai, órái, bére és kiszállási díja, kifizetve / függő bontásban. Excel: összesítő + napok munkalap; PDF: nyomtatható kimutatás.</Sub>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md }}>
          <Btn title="‹" kind="ghost" small onPress={() => shiftMonth(-1)} />
          <H2 style={{ flex: 1, textAlign: 'center' }}>{monthLabel}</H2>
          <Btn title="›" kind="ghost" small onPress={() => shiftMonth(1)} />
        </View>
        <Picker
          label="Munkavállaló"
          items={[...workers].sort((a, b) => a.name.localeCompare(b.name, 'hu'))}
          selectedId={workerId}
          getId={(w) => w.id}
          getLabel={(w) => w.name}
          onSelect={setWorkerId}
          allowNull
          nullLabel="— mindenki —"
        />
        <View style={{ flexDirection: 'row', gap: S.md }}>
          <View style={{ flex: 1 }}>
            <Btn title={busy === 'wages-xlsx' ? 'Készül…' : '📊 Excel (xlsx)'} onPress={() => void doExport('xlsx', 'wages')} disabled={!!busy} />
          </View>
          <View style={{ flex: 1 }}>
            <Btn title={busy === 'wages-pdf' ? 'Készül…' : '📄 PDF'} kind="secondary" onPress={() => void doExport('pdf', 'wages')} disabled={!!busy} />
          </View>
        </View>
      </Card>

      <Card>
        <H2>Feladat-összesítő</H2>
        <Sub>Helyszínenként a hozzá tartozó feladatok kódjai; feladatonként a munkaóra, a munkabér, a kiszállás és az anyagköltség. Excel: Feladatok, Helyszínek, Munkaidő, Anyagok munkalap. Egy feladat összefoglalója a feladat Pénzügy részéből is kérhető.</Sub>
        <Segmented label="Melyik feladatok" value={tStatus} onChange={setTStatus}
          options={[{ value: 'done', label: 'Kész' }, { value: 'open', label: 'Folyamatban' }, { value: 'failed', label: 'Nem sikerült' }, { value: 'all', label: 'Minden' }]} />
        <Sub>{tStatus === 'done' ? 'A készre jelentés dátuma szerint.' : tStatus === 'failed' ? 'A nem sikerült jelentés dátuma szerint.' : 'A kiadás dátuma szerint.'} A hét léptethető, a dátumok kézzel is átírhatók (üres kezdet = kezdettől).</Sub>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md }}>
          <Btn title="‹" kind="ghost" small onPress={() => shiftWeek(-1)} />
          <H2 style={{ flex: 1, textAlign: 'center' }}>{wFrom.trim() ? `${wFrom.replace(/-/g, '.')}.` : 'kezdettől'} – {wTo.replace(/-/g, '.')}.</H2>
          <Btn title="›" kind="ghost" small onPress={() => shiftWeek(1)} />
        </View>
        <Input label={`${dateLabel} ettől (ÉÉÉÉ-HH-NN)`} value={wFrom} onChangeText={setWFrom} />
        <Input label={`${dateLabel} eddig (ÉÉÉÉ-HH-NN)`} value={wTo} onChangeText={setWTo} />
        <Picker
          label="Építkezés"
          items={sites}
          selectedId={wSite}
          getId={(s) => s.id}
          getLabel={(s) => s.name}
          onSelect={setWSite}
          allowNull
          nullLabel="— minden építkezés —"
        />
        <Btn title={busy === 'tasks-xlsx' ? 'Készül…' : '📊 Excel (xlsx)'} onPress={() => void doExport('xlsx', 'tasks')} disabled={!!busy} />
      </Card>
    </Screen>
  );
}

/** Vezetői oldal: munkavállalói fiók nem nyithatja meg (a hookok
 *  sorrendje miatt külön burkolóban, nem a komponensen belüli korai visszatéréssel). */
export default function ExportScreen() {
  if (useIsWorker()) return <Screen><Empty text="Nincs jogosultságod ehhez az oldalhoz." /></Screen>;
  return <ExportScreenInner />;
}
