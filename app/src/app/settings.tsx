import React, { useEffect, useState } from 'react';
import { View, Alert } from 'react-native';
import { Screen, Card, H2, Sub, Input, Btn, Divider, Body, Check } from '../ui/kit';
import { S, C } from '../ui/theme';
import { useTable } from '../lib/hooks';
import { updateRow, callRpc, getCurrentUserId, softDeleteRow, insertRow } from '../lib/repo';
import { parseAmount } from '../lib/format';
import { AppSettings, Profile, ExpenseCategory } from '../lib/types';

function RateInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <Input label={label} value={value} onChangeText={onChange} keyboardType="numeric" placeholder="0" />;
}

export default function Settings() {
  const settings = useTable<AppSettings>('app_settings')[0];
  const profiles = useTable<Profile>('profiles');
  const categories = useTable<ExpenseCategory>('expense_categories');
  const me = getCurrentUserId();
  const myProfile = profiles.find((p) => p.id === me);

  const [rates, setRates] = useState<Record<string, string>>({});
  const [shares, setShares] = useState<Record<string, string>>({});
  const [threshold, setThreshold] = useState('');
  const [newCat, setNewCat] = useState('');
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  useEffect(() => {
    if (settings && loadedFor !== 'rates') {
      setRates({
        company_hourly_rate: String(Number(settings.company_hourly_rate) || ''),
        company_daily_rate: String(Number(settings.company_daily_rate) || ''),
        company_project_rate: String(Number(settings.company_project_rate) || ''),
        individual_hourly_rate: String(Number(settings.individual_hourly_rate) || ''),
        individual_daily_rate: String(Number(settings.individual_daily_rate) || ''),
        individual_project_rate: String(Number(settings.individual_project_rate) || ''),
        out_hourly_rate: String(Number(settings.out_hourly_rate) || ''),
        out_daily_rate: String(Number(settings.out_daily_rate) || ''),
        out_project_rate: String(Number(settings.out_project_rate) || ''),
        default_vat_rate: String(Number(settings.default_vat_rate)),
      });
      setLoadedFor('rates');
    }
  }, [settings, loadedFor]);

  useEffect(() => {
    if (profiles.length && Object.keys(shares).length === 0) {
      setShares(Object.fromEntries(profiles.map((p) => [p.id, String(Number(p.profit_share_percent))])));
    }
    if (myProfile && threshold === '') {
      setThreshold(String(Number(myProfile.big_expense_threshold)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles.length, myProfile?.id]);

  const saveRates = () => {
    if (!settings) return;
    updateRow('app_settings', '1' as any, Object.fromEntries(
      Object.entries(rates).map(([k, v]) => [k, parseAmount(v)]),
    ));
    Alert.alert('Mentve', 'Alapértelmezett díjak frissítve.');
  };

  const saveShares = async () => {
    const sum = Object.values(shares).reduce((s, v) => s + parseAmount(v), 0);
    if (Math.abs(sum - 100) > 0.01) {
      Alert.alert('Hiba', `A részesedések összege 100% kell legyen (most: ${sum}%).`);
      return;
    }
    try {
      await callRpc('set_profit_shares', {
        p_shares: profiles.map((p) => ({ user_id: p.id, percent: parseAmount(shares[p.id] ?? '0') })),
      });
      for (const p of profiles) {
        updateRow('profiles', p.id, { profit_share_percent: parseAmount(shares[p.id] ?? '0') });
      }
      Alert.alert('Mentve', 'Profitrészesedések frissítve.');
    } catch (e: any) {
      Alert.alert('Hiba', 'A részesedés módosításához internet kell.\n' + String(e?.message ?? e));
    }
  };

  const saveNotif = () => {
    if (!myProfile) return;
    updateRow('profiles', myProfile.id, { big_expense_threshold: parseAmount(threshold) });
    Alert.alert('Mentve', 'Értesítési beállítások frissítve.');
  };

  const toggleNotif = (field: keyof Profile) => {
    if (!myProfile) return;
    updateRow('profiles', myProfile.id, { [field]: !myProfile[field] });
  };

  if (!settings) return <Screen><Sub>Beállítások betöltése (első szinkron)…</Sub></Screen>;

  return (
    <Screen>
      <Card>
        <H2>Alapértelmezett díjak — magánszemély</H2>
        <RateInput label="Órabér (Ft)" value={rates.individual_hourly_rate ?? ''} onChange={(v) => setRates({ ...rates, individual_hourly_rate: v })} />
        <RateInput label="Napi díj (Ft)" value={rates.individual_daily_rate ?? ''} onChange={(v) => setRates({ ...rates, individual_daily_rate: v })} />
        <RateInput label="Projektdíj (Ft)" value={rates.individual_project_rate ?? ''} onChange={(v) => setRates({ ...rates, individual_project_rate: v })} />
        <Divider />
        <H2>Alapértelmezett díjak — céges</H2>
        <RateInput label="Órabér (Ft)" value={rates.company_hourly_rate ?? ''} onChange={(v) => setRates({ ...rates, company_hourly_rate: v })} />
        <RateInput label="Napi díj (Ft)" value={rates.company_daily_rate ?? ''} onChange={(v) => setRates({ ...rates, company_daily_rate: v })} />
        <RateInput label="Projektdíj (Ft)" value={rates.company_project_rate ?? ''} onChange={(v) => setRates({ ...rates, company_project_rate: v })} />
        <Divider />
        <H2>Kimenő (kiszámlázott) díjak</H2>
        <RateInput label="Órabér (Ft)" value={rates.out_hourly_rate ?? ''} onChange={(v) => setRates({ ...rates, out_hourly_rate: v })} />
        <RateInput label="Napi díj (Ft)" value={rates.out_daily_rate ?? ''} onChange={(v) => setRates({ ...rates, out_daily_rate: v })} />
        <RateInput label="Projektdíj (Ft)" value={rates.out_project_rate ?? ''} onChange={(v) => setRates({ ...rates, out_project_rate: v })} />
        <Divider />
        <RateInput label="Alapértelmezett ÁFA (%)" value={rates.default_vat_rate ?? '27'} onChange={(v) => setRates({ ...rates, default_vat_rate: v })} />
        <Btn title="Díjak mentése" onPress={saveRates} />
      </Card>

      <Card>
        <H2>Profitrészesedés</H2>
        <Sub>Az összegnek 100%-nak kell lennie. Az adatbázis is ellenőrzi.</Sub>
        {profiles.map((p) => (
          <Input
            key={p.id}
            label={`${p.display_name} (%)`}
            value={shares[p.id] ?? ''}
            onChangeText={(v) => setShares({ ...shares, [p.id]: v })}
            keyboardType="numeric"
          />
        ))}
        <Btn title="Részesedések mentése" onPress={() => void saveShares()} />
      </Card>

      <Card>
        <H2>Értesítések</H2>
        {myProfile ? (
          <>
            <Check checked={myProfile.notify_comments} onToggle={() => toggleNotif('notify_comments')} label="Komment az általam rögzített tételhez" />
            <Check checked={myProfile.notify_big_expense} onToggle={() => toggleNotif('notify_big_expense')} label="Nagy költés riasztás" />
            <Input label="Riasztási küszöb (Ft)" value={threshold} onChangeText={setThreshold} keyboardType="numeric" />
            <Check checked={myProfile.notify_weekly} onToggle={() => toggleNotif('notify_weekly')} label="Heti összefoglaló (péntek délután)" />
            <Check checked={myProfile.notify_overdue} onToggle={() => toggleNotif('notify_overdue')} label="Régi kifizetetlen bér / be nem folyt számla" />
            <Btn title="Értesítések mentése" onPress={saveNotif} />
          </>
        ) : null}
      </Card>

      <Card>
        <H2>Kategóriák</H2>
        {categories.map((c) => (
          <View key={c.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Body>{c.name}{c.is_builtin ? ' 🔒' : ''}</Body>
            {!c.is_builtin && c.created_by === me ? (
              <Btn title="Törlés" kind="ghost" small onPress={() => softDeleteRow('expense_categories', c.id)} />
            ) : null}
          </View>
        ))}
        <View style={{ flexDirection: 'row', gap: S.sm, alignItems: 'flex-end' }}>
          <View style={{ flex: 1 }}>
            <Input label="Új kategória" value={newCat} onChangeText={setNewCat} placeholder="pl. Bérleti díj" />
          </View>
          <Btn title="Felvesz" small onPress={() => {
            if (!newCat.trim()) return;
            insertRow('expense_categories', { name: newCat.trim(), is_builtin: false });
            setNewCat('');
          }} />
        </View>
      </Card>
    </Screen>
  );
}
