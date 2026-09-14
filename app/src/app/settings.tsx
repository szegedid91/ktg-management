import React, { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { Screen, Card, H2, Sub, Input, Btn, Divider, Body, Check, Segmented } from '../ui/kit';
import { S, C, getThemeMode, setThemeMode, ThemeMode } from '../ui/theme';
import { useTable, useOnlineView } from '../lib/hooks';
import { updateRow, callRpc, getCurrentUserId, softDeleteRow, insertRow, fetchView } from '../lib/repo';
import { syncNow } from '../lib/sync';
import { supabase } from '../lib/supabase';
import { parseAmount, hd } from '../lib/format';
import { AppSettings, Profile, ExpenseCategory, ShareChangeRequest } from '../lib/types';
import { notify, confirmDialog } from '../lib/dialogs';
import { PercentSlider } from '../components/PercentSlider';
import { PartnerAccountCard } from '../components/PartnerAccountCard';
import { WebPushRow } from '../components/WebPushRow';

function RateInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <Input label={label} value={value} onChangeText={onChange} keyboardType="numeric" placeholder="0" />;
}

export default function Settings() {
  const settings = useTable<AppSettings>('app_settings')[0];
  const profiles = useTable<Profile>('profiles');
  const categories = useTable<ExpenseCategory>('expense_categories');
  const me = getCurrentUserId();
  const myProfile = profiles.find((p) => p.id === me);
  // az admin nem üzleti partner: a részesedés-kártyán nem szerepel;
  // a hozzáférés-kezelés az adminé (amíg nincs admin: mindenkié)
  const partners = profiles.filter((p) => !p.is_admin && !p.worker_id);
  const canManageAccess = !!myProfile?.is_admin || !profiles.some((p) => p.is_admin);

  // részesedés-módosítási javaslatok (a másik fél beleegyezése kell)
  const shareRequests = useTable<ShareChangeRequest>('share_change_requests');
  const pendingReq = shareRequests.find((r) => r.status === 'pending');

  const [rates, setRates] = useState<Record<string, string>>({});
  const [shares, setShares] = useState<Record<string, number>>({});
  const [threshold, setThreshold] = useState('');
  const [newCat, setNewCat] = useState('');
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [theme, setThemeState] = useState<ThemeMode>(getThemeMode());

  // zárt regisztráció: csak az itt engedélyezett e-mailek regisztrálhatnak
  const allowed = useOnlineView<{ email: string; is_admin?: boolean }[]>(
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

  // ha a szerveren változik a részesedés (pl. jóváhagyott javaslat),
  // a csúszkák álljanak át az új értékre
  const shareKey = partners.map((p) => `${p.id}:${Math.round(Number(p.profit_share_percent))}`).join(',');
  useEffect(() => {
    if (partners.length) {
      setShares(Object.fromEntries(partners.map((p) => [p.id, Math.round(Number(p.profit_share_percent))])));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareKey]);

  useEffect(() => {
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

  /** Csúszka-állítás: a többi partner arányosan kapja a maradékot, így
   *  az összeg mindig pontosan 100. */
  const setShare = (id: string, val: number) => {
    const others = partners.filter((p) => p.id !== id);
    const rest = 100 - val;
    const prevSum = others.reduce((s, p) => s + (shares[p.id] ?? 0), 0);
    const next: Record<string, number> = { ...shares, [id]: val };
    let acc = 0;
    others.forEach((p, i) => {
      const w = prevSum > 0 ? (shares[p.id] ?? 0) / prevSum : 1 / others.length;
      const v = i === others.length - 1 ? rest - acc : Math.round(rest * w);
      next[p.id] = Math.max(0, v);
      acc += v;
    });
    setShares(next);
  };

  const sharesChanged = partners.some((p) => Math.round(Number(p.profit_share_percent)) !== (shares[p.id] ?? 0));

  const proposeShares = async () => {
    try {
      const status = await callRpc<string>('propose_profit_shares', {
        p_shares: partners.map((p) => ({ user_id: p.id, percent: shares[p.id] ?? 0 })),
      });
      void syncNow();
      if (status === 'approved') notify('Mentve ✅', 'A részesedés a mai naptól érvényes. A korábbi tételeket nem érinti.');
      else notify('Javaslat elküldve 🤝', 'A módosításhoz a másik fél beleegyezése kell — jóváhagyás után, annak napjától érvényes. A korábbi tételeket nem érinti.');
    } catch (e: any) {
      notify('Hiba', String(e?.message ?? e));
    }
  };

  const decideShares = async (id: string, approve: boolean) => {
    try {
      const status = await callRpc<string>('decide_share_change', { p_id: id, p_approve: approve });
      void syncNow();
      if (status === 'approved') notify('Jóváhagyva ✅', 'Az új részesedés a mai naptól érvényes. A korábbi tételeket nem érinti.');
      else if (status === 'rejected') notify('Elutasítva', 'A részesedések változatlanok maradtak.');
      else notify('Visszavonva', 'A javaslatot visszavontad.');
    } catch (e: any) {
      notify('Hiba', String(e?.message ?? e));
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
      <PartnerAccountCard />
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
        {pendingReq ? (
          <>
            <Sub>🤝 Függőben lévő módosítási javaslat ({hd(pendingReq.created_at.slice(0, 10))}, javasolta: {profiles.find((p) => p.id === pendingReq.proposed_by)?.display_name ?? '?'}):</Sub>
            {pendingReq.shares.map((s) => (
              <Body key={s.user_id} style={{ fontWeight: '700' }}>
                {profiles.find((p) => p.id === s.user_id)?.display_name ?? '?'}: {Number(s.percent)}%
                <Body style={{ fontWeight: '400', color: C.sub }}>
                  {'  '}(most: {Math.round(Number(profiles.find((p) => p.id === s.user_id)?.profit_share_percent ?? 0))}%)
                </Body>
              </Body>
            ))}
            <Sub>Jóváhagyás után az új arány annak napjától érvényes — a korábbi tételek a régi arányban maradnak.</Sub>
            {pendingReq.proposed_by === me ? (
              <Btn title="Javaslat visszavonása" kind="ghost" onPress={() => void decideShares(pendingReq.id, false)} />
            ) : myProfile && !myProfile.is_admin && !myProfile.worker_id ? (
              <View style={{ flexDirection: 'row', gap: S.md }}>
                <View style={{ flex: 1 }}><Btn title="Elutasítom" kind="ghost" onPress={() => void decideShares(pendingReq.id, false)} /></View>
                <View style={{ flex: 1 }}><Btn title="Jóváhagyom ✓" onPress={() => void decideShares(pendingReq.id, true)} /></View>
              </View>
            ) : (
              <Sub>A másik fél döntésére vár.</Sub>
            )}
          </>
        ) : (
          <>
            <Sub>A módosításhoz a másik fél beleegyezése kell, és csak a jóváhagyás napjától érvényes — visszamenőleg nem változtat semmit.</Sub>
            {partners.map((p) => (
              <View key={p.id} style={{ gap: 2 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Body style={{ fontWeight: '600' }}>{p.display_name}</Body>
                  <Body style={{ fontWeight: '800', color: C.primary }}>{shares[p.id] ?? 0}%</Body>
                </View>
                <PercentSlider value={shares[p.id] ?? 0} onChange={(v) => setShare(p.id, v)} />
              </View>
            ))}
            <Btn
              title={partners.length > 1 ? 'Módosítás javaslása 🤝' : 'Részesedés mentése'}
              onPress={() => void proposeShares()}
              disabled={!sharesChanged}
            />
          </>
        )}
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
            {Platform.OS === 'web' ? <><Divider /><WebPushRow /></> : null}
          </>
        ) : null}
      </Card>

      {canManageAccess ? (
        <Card>
          <H2>🔐 Hozzáférés</H2>
          <Sub>Csak az itt engedélyezett e-mail címekkel lehet regisztrálni. A meglévő fiókokat a lista nem érinti.</Sub>
          {(allowed.data ?? []).filter((a) => !a.is_admin).map((a) => (
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
      ) : null}

      <Card>
        <H2>Kategóriák</H2>
        {categories.map((c) => (
          <View key={c.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Body>{c.name}</Body>
            <Btn title="Törlés" kind="ghost" small onPress={() => {
              void confirmDialog(
                'Kategória törlése',
                `${c.name}\n\nA korábbi költségeken megmarad, csak új költséghez nem lesz választható.`,
                'Törlés', true,
              ).then((ok) => { if (ok) softDeleteRow('expense_categories', c.id); });
            }} />
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
