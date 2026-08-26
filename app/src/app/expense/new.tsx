// Gyors költségrögzítés: 1) összeg → 2) építkezés + kategória → 3) megjegyzés.
// Szerszám/eszköz kategóriánál mentéskor felajánlja az eszköz-nyilvántartásba
// vételt. A fotó/AI és a finomhangolás (nettó/ÁFA, dátum) lenyitható részletek.

import React, { useState } from 'react';
import { View, Text, Image, ActivityIndicator, Pressable } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { smartBack } from '../../lib/nav';
import * as ImagePicker from 'expo-image-picker';
import { Screen, Card, Input, Btn, Sub, H2, Body } from '../../ui/kit';
import { C, S } from '../../ui/theme';
import { useTable } from '../../lib/hooks';
import { insertRow, newId, getCurrentUserId } from '../../lib/repo';
import { notify, confirmDialog } from '../../lib/dialogs';
import { fromGross } from '../../lib/calc';
import { AmountVat, initialVatState, vatStateToAmounts, VatState } from '../../components/AmountVat';
import { PercentSlider } from '../../components/PercentSlider';
import { todayISO, ft, parseAmount } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import { Site, ExpenseCategory, AppSettings } from '../../lib/types';

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        backgroundColor: on ? C.primary : C.chipBg,
        paddingHorizontal: S.md, paddingVertical: 9, borderRadius: 999,
      }}
    >
      <Text style={{ color: on ? '#fff' : C.text, fontSize: 14, fontWeight: '600' }}>
        {on ? '✓ ' : ''}{label}
      </Text>
    </Pressable>
  );
}

export default function NewExpense() {
  const { siteId } = useLocalSearchParams<{ siteId?: string }>();
  const sites = useTable<Site>('sites').filter((s) => s.status === 'active');
  const categories = useTable<ExpenseCategory>('expense_categories');
  const settings = useTable<AppSettings>('app_settings')[0];
  const defaultVat = settings ? Number(settings.default_vat_rate) : 27;

  const [amountStr, setAmountStr] = useState('');
  // több terület is választható; üresen hagyva közös (területhez nem kötött) költség
  const [siteIds, setSiteIds] = useState<string[]>(siteId ? [siteId] : []);
  const [splits, setSplits] = useState<Record<string, number>>(siteId ? { [siteId]: 100 } : {});
  const [category, setCategory] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [showDetails, setShowDetails] = useState(false);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(todayISO());
  const [vat, setVat] = useState<VatState>(initialVatState(defaultVat));
  const [photos, setPhotos] = useState<{ uri: string; base64?: string }[]>([]);
  const [aiBusy, setAiBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  const amount = parseAmount(amountStr);
  const hasAmount = amount > 0;

  const toggleSite = (id: string) => {
    const next = siteIds.includes(id) ? siteIds.filter((x) => x !== id) : [...siteIds, id];
    setSiteIds(next);
    // ki-/bejelöléskor egyenlő megosztásról indulunk
    const eq = next.length ? 100 / next.length : 0;
    setSplits(Object.fromEntries(next.map((s) => [s, eq])));
  };

  /** Egy csúszka mozgatásakor a többi terület aránya arányosan igazodik, hogy 100% maradjon. */
  const setSplit = (id: string, pct: number) => {
    setSplits((prev) => {
      const others = siteIds.filter((s) => s !== id);
      const next: Record<string, number> = { ...prev, [id]: pct };
      if (others.length) {
        const oldRest = others.reduce((s, o) => s + (prev[o] ?? 0), 0);
        const rest = 100 - pct;
        if (oldRest <= 0.0001) others.forEach((o) => { next[o] = rest / others.length; });
        else others.forEach((o) => { next[o] = ((prev[o] ?? 0) * rest) / oldRest; });
      }
      return next;
    });
  };

  // a gyors összeg = bruttó; a részletekben finomhangolható
  const setQuickAmount = (t: string) => {
    setAmountStr(t);
    const a = fromGross(parseAmount(t), vat.vatRate);
    setVat({ ...vat, gross: t, net: a.net ? String(a.net) : '', lastEdited: 'gross' });
  };
  const setVatDetailed = (v: VatState) => {
    setVat(v);
    const a = vatStateToAmounts(v);
    setAmountStr(a.gross ? String(a.gross) : '');
  };

  const pickPhoto = async (fromCamera: boolean) => {
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.7, base64: true };
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync(opts)
      : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled || !res.assets?.[0]) return;
    const asset = res.assets[0];
    setPhotos((p) => [...p, { uri: asset.uri, base64: asset.base64 ?? undefined }]);
    if (asset.base64 && await confirmDialog('AI kiolvasás', 'Kiolvassam a blokk adatait a fotóról?', 'Igen')) {
      void runAi(asset.base64);
    }
  };

  const runAi = async (base64: string) => {
    setAiBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('receipt-ocr', { body: { image_base64: base64 } });
      if (error) throw error;
      if (data?.gross_amount) setQuickAmount(String(data.gross_amount));
      if (data?.date) setDate(data.date);
      if (data?.merchant && !title) setTitle(data.merchant);
      notify('AI kiolvasás kész', 'Ellenőrizd és javítsd az előtöltött adatokat!');
    } catch (e: any) {
      notify('AI kiolvasás nem sikerült', 'Töltsd ki kézzel az adatokat.');
    } finally {
      setAiBusy(false);
    }
  };

  const save = async () => {
    if (!hasAmount || saving) return;
    setSaving(true);

    const catName = categories.find((c) => c.id === category)?.name ?? '';
    // Szerszám/eszköz vásárlásnál felajánljuk az eszköz-nyilvántartásba vételt
    if (/szerszám|eszköz/i.test(catName)) {
      const eqName = (title.trim() || note.trim().split('\n')[0] || '').trim();
      if (await confirmDialog(
        'Eszköz-nyilvántartás',
        `Felvegyük az eszközök közé is?${eqName ? `\n(${eqName})` : ''}`,
        'Igen, vegyük fel',
      )) {
        insertRow('equipment', {
          name: eqName || `Új eszköz (${todayISO()})`,
          note: `Vásárolva: ${date} — ${ft(amount)}`,
        });
      }
    }

    const amounts = vatStateToAmounts(vat);
    // 0 terület → közös költség; 1 → sima; több → soronként megosztva a %-ok szerint
    const targets: (string | null)[] = siteIds.length ? siteIds : [null];
    let remNet = amounts.net; let remVat = amounts.vat; let remGross = amounts.gross;
    let expenseId: string | null = null;
    targets.forEach((sid, i) => {
      const last = i === targets.length - 1;
      const p = sid && targets.length > 1 ? (splits[sid] ?? 0) / 100 : 1;
      const net = last ? remNet : Math.round(amounts.net * p);
      const vatA = last ? remVat : Math.round(amounts.vat * p);
      const gross = last ? remGross : net + vatA;
      remNet -= net; remVat -= vatA; remGross -= gross;
      if (targets.length > 1 && gross === 0) return; // 0%-os terület: nem kap sort
      const id = insertRow('expenses', {
        site_id: sid,
        paid_by: getCurrentUserId(),
        expense_date: date,
        title: title.trim() || null,
        net_amount: net,
        vat_rate: amounts.vatRate,
        vat_amount: vatA,
        gross_amount: gross,
        category_id: category,
        note: note.trim() || null,
      });
      if (!expenseId) expenseId = id;
    });

    for (const photo of photos) {
      if (!expenseId) break;
      try {
        const path = `${expenseId}/${newId()}.jpg`;
        const bin = photo.base64 ? Uint8Array.from(atob(photo.base64), (c) => c.charCodeAt(0)) : null;
        if (!bin) continue;
        const { error } = await supabase.storage.from('receipts').upload(path, bin.buffer as ArrayBuffer, { contentType: 'image/jpeg' });
        if (!error) insertRow('expense_photos', { expense_id: expenseId, storage_path: path });
      } catch {
        // offline — a költség fotó nélkül mentődött
      }
    }
    smartBack();
  };

  return (
    <Screen>
      <Card>
        <Input
          label="Összeg (bruttó, Ft) *"
          value={amountStr}
          onChangeText={setQuickAmount}
          keyboardType="numeric"
          placeholder="pl. 45 000"
        />
        {hasAmount ? <Sub>Nettó {ft(vatStateToAmounts(vat).net)} + {vat.vatRate}% ÁFA</Sub> : null}
      </Card>

      {hasAmount ? (
        <>
          <Card>
            <H2>Építkezés</H2>
            <Sub>Nem kötelező — üresen hagyva közös költség lesz. Több terület is kijelölhető.</Sub>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
              {sites.map((s) => (
                <Chip key={s.id} label={s.name} on={siteIds.includes(s.id)} onPress={() => toggleSite(s.id)} />
              ))}
            </View>
            {sites.length === 0 ? <Sub>Nincs aktív építkezés.</Sub> : null}
            {siteIds.length >= 2 ? (
              <View style={{ gap: S.sm, marginTop: 4 }}>
                <Sub>Megosztás a területek között — húzd a csúszkát:</Sub>
                {siteIds.map((id) => {
                  const pct = splits[id] ?? 0;
                  return (
                    <View key={id}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Body style={{ fontWeight: '600' }}>{sites.find((s) => s.id === id)?.name}</Body>
                        <Body style={{ fontWeight: '700' }}>
                          {Math.round(pct)}% · {ft(Math.round((amount * pct) / 100))}
                        </Body>
                      </View>
                      <PercentSlider value={pct} onChange={(v) => setSplit(id, v)} />
                    </View>
                  );
                })}
              </View>
            ) : null}
          </Card>

          <Card>
            <H2>Kategória</H2>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
              {categories.map((c) => (
                <Chip key={c.id} label={c.name} on={category === c.id}
                  onPress={() => setCategory(category === c.id ? null : c.id)} />
              ))}
            </View>
          </Card>

          <Card>
            <Input label="Megjegyzés" value={note} onChangeText={setNote} multiline
              placeholder="pl. festék és létra az OBI-ból" />
          </Card>

          <Card>
            <Btn
              title={showDetails ? 'Részletek elrejtése ▴' : '📷 Fotó és részletek ▾'}
              kind="ghost"
              onPress={() => setShowDetails(!showDetails)}
            />
            {showDetails ? (
              <>
                <Input label="Megnevezés" value={title} onChangeText={setTitle} placeholder="pl. festék, létra" />
                <Input label="Dátum (ÉÉÉÉ-HH-NN)" value={date} onChangeText={setDate} />
                <AmountVat value={vat} onChange={setVatDetailed} />
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
              </>
            ) : null}
          </Card>

          <Btn title={saving ? 'Mentés…' : `Mentés (${ft(amount)})`} onPress={() => void save()} disabled={saving} />
        </>
      ) : (
        <Sub style={{ textAlign: 'center' }}>Írd be az összeget a folytatáshoz.</Sub>
      )}
    </Screen>
  );
}
