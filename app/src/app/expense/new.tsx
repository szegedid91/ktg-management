import React, { useState } from 'react';
import { View, Text, Alert, Image, ActivityIndicator } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Screen, Card, Input, Btn, Picker, Sub, H2 } from '../../ui/kit';
import { C, S } from '../../ui/theme';
import { useTable } from '../../lib/hooks';
import { insertRow, newId, getCurrentUserId } from '../../lib/repo';
import { AmountVat, initialVatState, vatStateToAmounts, VatState } from '../../components/AmountVat';
import { todayISO } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import { Site, ExpenseCategory, AppSettings } from '../../lib/types';

export default function NewExpense() {
  const { siteId } = useLocalSearchParams<{ siteId?: string }>();
  const sites = useTable<Site>('sites').filter((s) => s.status === 'active');
  const categories = useTable<ExpenseCategory>('expense_categories');
  const settings = useTable<AppSettings>('app_settings')[0];

  const [site, setSite] = useState<string | null>(siteId ?? null);
  const [date, setDate] = useState(todayISO());
  const [title, setTitle] = useState('');
  const [vat, setVat] = useState<VatState>(initialVatState(settings ? Number(settings.default_vat_rate) : 27));
  const [category, setCategory] = useState<string | null>(null);
  const [newCat, setNewCat] = useState('');
  const [showNewCat, setShowNewCat] = useState(false);
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<{ uri: string; base64?: string }[]>([]);
  const [aiBusy, setAiBusy] = useState(false);

  const pickPhoto = async (fromCamera: boolean) => {
    const opts: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      quality: 0.7,
      base64: true,
    };
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync(opts)
      : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled || !res.assets?.[0]) return;
    const asset = res.assets[0];
    setPhotos((p) => [...p, { uri: asset.uri, base64: asset.base64 ?? undefined }]);
    // AI kiolvasás felajánlása
    if (asset.base64) {
      Alert.alert('AI kiolvasás', 'Kiolvassam a blokk adatait a fotóról?', [
        { text: 'Ne', style: 'cancel' },
        { text: 'Igen', onPress: () => void runAi(asset.base64!) },
      ]);
    }
  };

  const runAi = async (base64: string) => {
    setAiBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('receipt-ocr', {
        body: { image_base64: base64 },
      });
      if (error) throw error;
      if (data?.gross_amount) {
        const rate = vat.vatRate;
        setVat({ net: '', gross: String(data.gross_amount), vatRate: rate, lastEdited: 'gross' });
        // átszámítás bruttóból
        setVat((v) => {
          const a = vatStateToAmounts({ ...v, gross: String(data.gross_amount), lastEdited: 'gross' });
          return { ...v, gross: String(data.gross_amount), net: String(a.net), lastEdited: 'gross' };
        });
      }
      if (data?.date) setDate(data.date);
      if (data?.merchant && !title) setTitle(data.merchant);
      Alert.alert('AI kiolvasás kész', 'Ellenőrizd és javítsd az előtöltött adatokat!');
    } catch (e: any) {
      Alert.alert('AI kiolvasás nem sikerült', 'Töltsd ki kézzel az adatokat.\n' + String(e?.message ?? e));
    } finally {
      setAiBusy(false);
    }
  };

  const save = async () => {
    if (!site) return;
    const amounts = vatStateToAmounts(vat);
    let categoryId = category;
    if (showNewCat && newCat.trim()) {
      categoryId = insertRow('expense_categories', { name: newCat.trim(), is_builtin: false });
    }
    const expenseId = insertRow('expenses', {
      site_id: site,
      paid_by: getCurrentUserId(),
      expense_date: date,
      title: title.trim() || null,
      net_amount: amounts.net,
      vat_rate: amounts.vatRate,
      vat_amount: amounts.vat,
      gross_amount: amounts.gross,
      category_id: categoryId,
      note: note.trim() || null,
    });
    // fotófeltöltés (online szükséges; offline esetén kimarad, később pótolható)
    for (const photo of photos) {
      try {
        const path = `${expenseId}/${newId()}.jpg`;
        const bin = photo.base64 ? Uint8Array.from(atob(photo.base64), (c) => c.charCodeAt(0)) : null;
        if (!bin) continue;
        const { error } = await supabase.storage.from('receipts').upload(path, bin.buffer as ArrayBuffer, { contentType: 'image/jpeg' });
        if (!error) {
          insertRow('expense_photos', { expense_id: expenseId, storage_path: path });
        }
      } catch {
        // offline — a költség fotó nélkül mentődött
      }
    }
    router.back();
  };

  return (
    <Screen>
      <Card>
        <Picker label="Építkezés *" items={sites} selectedId={site} getId={(s) => s.id} getLabel={(s) => s.name} onSelect={setSite} />
        <Input label="Dátum (ÉÉÉÉ-HH-NN)" value={date} onChangeText={setDate} placeholder="2026-08-26" />
        <Input label="Megnevezés" value={title} onChangeText={setTitle} placeholder="pl. festék, létra" />
        <AmountVat value={vat} onChange={setVat} />
        <Picker
          label="Kategória"
          items={categories}
          selectedId={category}
          getId={(c) => c.id}
          getLabel={(c) => c.name}
          onSelect={(id) => { setCategory(id); setShowNewCat(false); }}
          allowNull
          nullLabel="— nincs kategória —"
        />
        {showNewCat ? (
          <Input label="Új kategória neve" value={newCat} onChangeText={setNewCat} placeholder="pl. Bérleti díj" />
        ) : (
          <Btn title="+ Új kategória" kind="ghost" small onPress={() => setShowNewCat(true)} />
        )}
        <Input label="Megjegyzés" value={note} onChangeText={setNote} multiline placeholder="opcionális" />
      </Card>

      <Card>
        <H2>Számlafotó</H2>
        <View style={{ flexDirection: 'row', gap: S.md }}>
          <View style={{ flex: 1 }}><Btn title="📷 Fotó" kind="secondary" onPress={() => void pickPhoto(true)} /></View>
          <View style={{ flex: 1 }}><Btn title="🖼️ Galéria" kind="ghost" onPress={() => void pickPhoto(false)} /></View>
        </View>
        {aiBusy ? <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><ActivityIndicator /><Sub>AI kiolvasás folyamatban…</Sub></View> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
          {photos.map((p, i) => (
            <Image key={i} source={{ uri: p.uri }} style={{ width: 72, height: 72, borderRadius: 8 }} />
          ))}
        </View>
        {photos.length > 0 ? <Sub>A fotó a tételhez csatolva marad (privát tároló).</Sub> : null}
      </Card>

      <Btn title="Mentés" onPress={() => void save()} disabled={!site} />
    </Screen>
  );
}
