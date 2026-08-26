import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Screen, Card, H2, Sub, Input, Btn, Divider, Body, Check, Segmented } from '../ui/kit';
import { S, C, getThemeMode, setThemeMode, ThemeMode } from '../ui/theme';
import { useTable, useOnlineView } from '../lib/hooks';
import { updateRow, callRpc, getCurrentUserId, softDeleteRow, insertRow, fetchView } from '../lib/repo';
import { syncNow } from '../lib/sync';
import { supabase } from '../lib/supabase';
import { parseAmount } from '../lib/format';
import { AppSettings, Profile, ExpenseCategory } from '../lib/types';
import { notify, confirmDialog } from '../lib/dialogs';

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
  const [theme, setThemeState] = useState<ThemeMode>(getThemeMode());

  // zárt regisztráció: csak az itt engedélyezett e-mailek regisztrálhatnak
  const allowed = useOnlineView<{ email: string }[]>(
    'allowed-emails',
    () => fetchView('allowed_emails', (q) => q.order('email')),
    [],
  );
  const [newEmail, setNewEmail] = useState('');

  const addAllowed = async () => {
    const email = newEmail.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) { notify('Hiba', 'Adj meg érvényes e-mail címet.'); return; }
    const { error } = await supabase.from('allowed_emails').insert({ email });
    if (error && !error.message.includes('duplicate')) notify('Hiba', error.message);
    setNewEmail('');
    void allowed.refresh();
  };

  const removeAllowed = async (email: string) => {
    if (!await confirmDialog('Hozzáférés visszavonása', `${email}\n\nEzzel az e-mail címmel többé nem lehet regisztrálni. A már létező fiókot nem érinti.`, 'Visszavonás', true)) return;
    const { error } = await supabase.from('allowed_emails').delete().eq('email', email);
    if (error) notify('Hiba', error.message);
    void allowed.refresh();
  };

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
        default_payment_days: String(Number(settings.default_payment_days) || 8),
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
    notify('Mentve', 'Alapértelmezett díjak frissítve.');
  };

  const saveShares = async () => {
    // a DB pontosan 100-at követel — a kliens is
    const sum = Math.round(Object.values(shares).reduce((s, v) => s + parseAmount(v), 0) * 100) / 100;
    if (sum !== 100) {
      notify('Hiba', `A részesedések összege pontosan 100% kell legyen (most: ${sum}%).`);
      return;
    }
    try {
      await callRpc('set_profit_shares', {
        p_shares: profiles.map((p) => ({ user_id: p.id, percent: parseAmount(shares[p.id] ?? '0') })),
      });
      // a friss értékeket a szinkron hozza le — mások profilját nem írjuk felül
      void syncNow();
      notify('Mentve', 'Profitrészesedések frissítve.');
    } catch (e: any) {
      notify('Hiba', 'A részesedés módosításához internet kell.\n' + String(e?.message ?? e));
    }
  };

  const saveNotif = () => {
    if (!myProfile) return;
    updateRow('profiles', myProfile.id, { big_expense_threshold: parseAmount(threshold) });
    notify('Mentve', 'Értesítési beállítások frissítve.');
  };

  const toggleNotif = (field: keyof Profile) => {
    if (!myProfile) return;
    updateRow('profiles', myProfile.id, { [field]: !myProfile[field] });
  };

  if (!settings) return <Screen><Sub>Beállítások betöltése (első szinkron)…</Sub></Screen>;

  return (
    <Screen>
      <Card>
        <H2>🌗 Megjelenés</H2>
        <Segmented
          options={[
            { value: 'light', label: '☀️ Világos' },
            { value: 'dark', label: '🌙 Esti (sötét)' },
          ]}
          value={theme}
          onChange={(v: ThemeMode) => { setThemeMode(v); setThemeState(v); }}
        />
      </Card>

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
        <RateInput label="Fizetési határidő (nap a számlázástól)" value={rates.default_payment_days ?? '8'} onChange={(v) => setRates({ ...rates, default_payment_days: v })} />
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
        <H2>🔐 Hozzáférés</H2>
        <Sub>Csak az itt engedélyezett e-mail címekkel lehet regisztrálni. A meglévő fiókokat a lista nem érinti.</Sub>
        {(allowed.data ?? []).map((a) => (
          <View key={a.email} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Body>{a.email}</Body>
            <Btn title="Visszavon" kind="ghost" small onPress={() => void removeAllowed(a.email)} />
          </View>
        ))}
        {allowed.fromCache ? <Sub style={{ color: C.warning }}>⚠️ Offline — a lista kezeléséhez internet kell.</Sub> : null}
        <View style={{ flexDirection: 'row', gap: S.sm, alignItems: 'flex-end' }}>
          <View style={{ flex: 1 }}>
            <Input label="Új engedélyezett e-mail" value={newEmail} onChangeText={setNewEmail}
              placeholder="pl. tars@pelda.hu" keyboardType="email-address" autoCapitalize="none" />
          </View>
          <Btn title="Engedélyez" small onPress={() => void addAllowed()} />
        </View>
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
