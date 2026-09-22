import React, { useState } from 'react';
import { View } from 'react-native';
import { Screen, Card, H2, Sub, Btn, Input, Picker, Empty } from '../ui/kit';
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

  // feladat-összesítő
  const [tFrom, setTFrom] = useState('');
  const [tTo, setTTo] = useState(todayISO());
  const [tSite, setTSite] = useState<string | null>(null);

  const doExport = async (format: 'xlsx' | 'pdf', mode: 'books' | 'wages' | 'tasks' = 'books') => {
    setBusy(`${mode}-${format}`);
    try {
      await downloadExport(
        mode === 'wages' ? { mode, month, worker_id: workerId, format }
          : mode === 'tasks' ? { mode, from: tFrom.trim() || undefined, to: tTo.trim() || undefined, site_id: tSite }
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
        <H2>Export könyvelőnek</H2>
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
        <Input label="Kiadva ettől (ÉÉÉÉ-HH-NN, üres = kezdettől)" value={tFrom} onChangeText={setTFrom} />
        <Input label="Kiadva eddig (ÉÉÉÉ-HH-NN)" value={tTo} onChangeText={setTTo} />
        <Picker
          label="Építkezés"
          items={sites}
          selectedId={tSite}
          getId={(s) => s.id}
          getLabel={(s) => s.name}
          onSelect={setTSite}
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
