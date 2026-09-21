import React, { useState } from 'react';
import { Platform, View } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Screen, Card, H2, Sub, Btn, Input, Picker, Segmented, Empty } from '../ui/kit';
import { S } from '../ui/theme';
import { useTable, useIsWorker } from '../lib/hooks';
import { supabase } from '../lib/supabase';
import { todayISO } from '../lib/format';
import { Site, Worker } from '../lib/types';
import { notify, confirmDialog } from '../lib/dialogs';

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

  const doExport = async (format: 'xlsx' | 'pdf', wages = false) => {
    setBusy((wages ? 'w-' : '') + format);
    try {
      const { data, error } = await supabase.functions.invoke('export-data', {
        body: wages ? { mode: 'wages', month, worker_id: workerId, format } : { from, to, site_id: site, format },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);

      if (Platform.OS === 'web') {
        const a = document.createElement('a');
        a.href = `data:${data.mime};base64,${data.base64}`;
        a.download = data.filename;
        a.click();
      } else {
        const path = FileSystem.cacheDirectory + data.filename;
        await FileSystem.writeAsStringAsync(path, data.base64, { encoding: FileSystem.EncodingType.Base64 });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(path, { mimeType: data.mime, dialogTitle: data.filename });
        }
      }
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
            <Btn title={busy === 'xlsx' ? 'Készül…' : '📊 Excel (xlsx)'} onPress={() => void doExport('xlsx')} disabled={!!busy} />
          </View>
          <View style={{ flex: 1 }}>
            <Btn title={busy === 'pdf' ? 'Készül…' : '📄 PDF'} kind="secondary" onPress={() => void doExport('pdf')} disabled={!!busy} />
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
            <Btn title={busy === 'w-xlsx' ? 'Készül…' : '📊 Excel (xlsx)'} onPress={() => void doExport('xlsx', true)} disabled={!!busy} />
          </View>
          <View style={{ flex: 1 }}>
            <Btn title={busy === 'w-pdf' ? 'Készül…' : '📄 PDF'} kind="secondary" onPress={() => void doExport('pdf', true)} disabled={!!busy} />
          </View>
        </View>
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
