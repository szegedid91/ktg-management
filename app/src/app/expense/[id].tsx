import React, { useEffect, useState } from 'react';
import { View, Image } from 'react-native';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { smartBack } from '../../lib/nav';
import { Screen, Card, H2, Sub, Body, Btn, KV, Empty, Input, Picker } from '../../ui/kit';
import { S } from '../../ui/theme';
import { useRow, useTable } from '../../lib/hooks';
import { getCurrentUserId, softDeleteRow, updateRow } from '../../lib/repo';
import { ft, hd } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import { Expense, ExpensePhoto, Site, ExpenseCategory, Profile } from '../../lib/types';
import { Comments } from '../../components/Comments';
import { AmountVat, initialVatState, vatStateToAmounts, VatState } from '../../components/AmountVat';
import { notify, confirmDialog } from '../../lib/dialogs';

export default function ExpenseDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const expense = useRow<Expense>('expenses', id);
  const photos = useTable<ExpensePhoto>('expense_photos').filter((p) => p.expense_id === id);
  const sites = useTable<Site>('sites');
  const categories = useTable<ExpenseCategory>('expense_categories');
  const profiles = useTable<Profile>('profiles');
  const me = getCurrentUserId();
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [vat, setVat] = useState<VatState>(initialVatState());

  useEffect(() => {
    (async () => {
      const next: Record<string, string> = {};
      for (const p of photos) {
        if (urls[p.id]) continue;
        const { data } = await supabase.storage.from('receipts').createSignedUrl(p.storage_path, 3600);
        if (data?.signedUrl) next[p.id] = data.signedUrl;
      }
      if (Object.keys(next).length) setUrls((u) => ({ ...u, ...next }));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos.length]);

  if (!expense) return <Screen><Empty text="Költség nem található." /></Screen>;
  const mine = expense.created_by === me;
  const site = sites.find((s) => s.id === expense.site_id);

  const startEdit = () => {
    setTitle(expense.title ?? '');
    setDate(expense.expense_date);
    setCategory(expense.category_id);
    setNote(expense.note ?? '');
    setVat({ net: String(expense.net_amount), gross: String(expense.gross_amount), vatRate: Number(expense.vat_rate), lastEdited: 'net' });
    setEditing(true);
  };

  const saveEdit = () => {
    const amounts = vatStateToAmounts(vat);
    updateRow('expenses', expense.id, {
      title: title.trim() || null,
      expense_date: date,
      category_id: category,
      note: note.trim() || null,
      net_amount: amounts.net,
      vat_rate: amounts.vatRate,
      vat_amount: amounts.vat,
      gross_amount: amounts.gross,
    });
    setEditing(false);
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: expense.title || 'Költség' }} />
      {editing ? (
        <Card>
          <Input label="Megnevezés" value={title} onChangeText={setTitle} />
          <Input label="Dátum (ÉÉÉÉ-HH-NN)" value={date} onChangeText={setDate} />
          <AmountVat value={vat} onChange={setVat} />
          <Picker label="Kategória" items={categories} selectedId={category} getId={(c) => c.id} getLabel={(c) => c.name} onSelect={setCategory} allowNull />
          <Input label="Megjegyzés" value={note} onChangeText={setNote} multiline />
          <View style={{ flexDirection: 'row', gap: S.md }}>
            <View style={{ flex: 1 }}><Btn title="Mégse" kind="ghost" onPress={() => setEditing(false)} /></View>
            <View style={{ flex: 1 }}><Btn title="Mentés" onPress={saveEdit} /></View>
          </View>
        </Card>
      ) : (
        <Card>
          <KV k="Építkezés" v={site?.name ?? (expense.site_id ? '?' : 'Közös költség')} />
          <KV k="Dátum" v={hd(expense.expense_date)} />
          <KV k="Nettó" v={ft(expense.net_amount)} strong />
          <KV k={`ÁFA (${expense.vat_rate}%)`} v={ft(expense.vat_amount)} />
          <KV k="Bruttó" v={ft(expense.gross_amount)} />
          <KV k="Kategória" v={categories.find((c) => c.id === expense.category_id)?.name ?? '—'} />
          <KV k="Rögzítette" v={profiles.find((p) => p.id === expense.created_by)?.display_name ?? '?'} />
          {expense.note ? <><Sub>Megjegyzés</Sub><Body>{expense.note}</Body></> : null}
          {mine ? (
            <View style={{ flexDirection: 'row', gap: S.md }}>
              <View style={{ flex: 1 }}><Btn title="Szerkesztés" kind="ghost" small onPress={startEdit} /></View>
              <View style={{ flex: 1 }}>
                <Btn title="Törlés" kind="danger" small onPress={() => {
                  void confirmDialog('Törlés', 'Biztosan törlöd ezt a költséget?', 'Törlés', true).then((ok) => {
                    if (ok) { softDeleteRow('expenses', expense.id); smartBack(); }
                  });
                }} />
              </View>
            </View>
          ) : <Sub>Csak a rögzítője szerkesztheti. Kommentet bárki írhat.</Sub>}
        </Card>
      )}

      {photos.length > 0 ? (
        <Card>
          <H2>Számlafotók</H2>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
            {photos.map((p) => urls[p.id] ? (
              <Image key={p.id} source={{ uri: urls[p.id] }} style={{ width: 140, height: 140, borderRadius: 8 }} resizeMode="cover" />
            ) : <Sub key={p.id}>Fotó betöltése…</Sub>)}
          </View>
        </Card>
      ) : null}

      <Comments entityType="expense" entityId={expense.id} />
    </Screen>
  );
}
