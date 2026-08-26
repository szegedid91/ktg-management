import React, { useState } from 'react';
import { Alert, Platform, View } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Screen, Card, H2, Sub, Btn, Input, Picker, Segmented } from '../ui/kit';
import { S } from '../ui/theme';
import { useTable } from '../lib/hooks';
import { supabase } from '../lib/supabase';
import { todayISO } from '../lib/format';
import { Site } from '../lib/types';

export default function ExportScreen() {
  const sites = useTable<Site>('sites');
  const [from, setFrom] = useState(todayISO().slice(0, 7) + '-01');
  const [to, setTo] = useState(todayISO());
  const [site, setSite] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const doExport = async (format: 'xlsx' | 'pdf') => {
    setBusy(format);
    try {
      const { data, error } = await supabase.functions.invoke('export-data', {
        body: { from, to, site_id: site, format },
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
      Alert.alert('Export hiba', 'Az exporthoz internetkapcsolat kell.\n' + String(e?.message ?? e));
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
    </Screen>
  );
}
