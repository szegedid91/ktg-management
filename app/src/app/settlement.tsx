import React, { useMemo, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Screen, Card, H2, Sub, Btn, KV, Divider, Empty, Input, Picker, Body } from '../ui/kit';
import { C, S } from '../ui/theme';
import { useOnlineView, useTable } from '../lib/hooks';
import { fetchView, callRpc, insertRow, getCurrentUserId, softDeleteRow } from '../lib/repo';
import { ft, hd, todayISO, parseAmount } from '../lib/format';
import { UserBalance, CommonResult, Settlement, Profile, Expense, Attendance, Site } from '../lib/types';

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{ backgroundColor: on ? C.primary : C.chipBg, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 }}
    >
      <Text style={{ color: on ? '#fff' : C.text, fontSize: 13, fontWeight: '600' }}>{on ? '✓ ' : ''}{label}</Text>
    </Pressable>
  );
}

type Period = 'month' | 'prev' | 'year' | 'all';
const PERIODS: { value: Period; label: string }[] = [
  { value: 'month', label: 'Ez a hónap' },
  { value: 'prev', label: 'Előző hónap' },
  { value: 'year', label: 'Idén' },
  { value: 'all', label: 'Összes' },
];

function periodRange(p: Period): [string, string] {
  const t = todayISO();
  const y = Number(t.slice(0, 4)); const m = Number(t.slice(5, 7));
  const pad = (n: number) => String(n).padStart(2, '0');
  if (p === 'month') return [`${t.slice(0, 7)}-01`, m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`];
  if (p === 'prev') {
    const py = m === 1 ? y - 1 : y; const pm = m === 1 ? 12 : m - 1;
    return [`${py}-${pad(pm)}-01`, `${t.slice(0, 7)}-01`];
  }
  if (p === 'year') return [`${y}-01-01`, `${y + 1}-01-01`];
  return ['0000-01-01', '9999-12-31'];
}

export default function SettlementScreen() {
  const balances = useOnlineView<UserBalance[]>('balances', () => fetchView('v_user_balances'), []);
  const common = useOnlineView<CommonResult[]>('common', () => fetchView('v_common_result'), []);
  const suggestions = useOnlineView<any[]>('suggestions', () => callRpc('suggested_settlements'), []);
  const settlements = useTable<Settlement>('settlements');
  const profiles = useTable<Profile>('profiles');
  const expenses = useTable<Expense>('expenses');
  const attendance = useTable<Attendance>('attendance');
  const sites = useTable<Site>('sites');
  const me = getCurrentUserId();

  const [showForm, setShowForm] = useState(false);
  const [toUser, setToUser] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  // ---- Költés-összevetés: időszak + terület szűrő ----
  const [period, setPeriod] = useState<Period>('month');
  const [selSites, setSelSites] = useState<Set<string>>(new Set());
  const toggleSite = (id: string) => {
    const next = new Set(selSites);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelSites(next);
  };

  const c = common.data?.[0];
  const name = (id: string | null | undefined) => profiles.find((p) => p.id === id)?.display_name ?? '?';

  /** Ki mennyit költött az időszakban/területen, és ez alapján ki kinek jön.
   *  Minden a lokális tükörből számolódik, ezért átutalás rögzítésekor
   *  azonnal frissül. */
  const compare = useMemo(() => {
    const [from, to] = periodRange(period);
    const inPeriod = (d: string) => d >= from && d < to;
    const siteOk = (siteId: string | null) => selSites.size === 0 || (!!siteId && selSites.has(siteId));

    const stats = profiles.filter((p) => !p.is_admin).map((p) => {
      const exp = expenses
        .filter((e) => e.paid_by === p.id && inPeriod(e.expense_date) && siteOk(e.site_id))
        .reduce((s, e) => s + Number(e.net_amount), 0);
      const wage = attendance
        .filter((a) => a.paid_by === p.id && !!a.paid_at && inPeriod(a.work_date) && siteOk(a.site_id))
        .reduce((s, a) => s + Number(a.amount) - Number(a.commission_amount), 0);
      const comm = attendance
        .filter((a) => a.commission_paid_by === p.id && !!a.commission_paid_at
          && !!a.referrer_external_id && inPeriod(a.work_date) && siteOk(a.site_id))
        .reduce((s, a) => s + Number(a.commission_amount), 0);
      return { id: p.id, name: p.display_name, share: Number(p.profit_share_percent), exp, wage, comm, total: exp + wage + comm };
    });

    const grandTotal = stats.reduce((s, u) => s + u.total, 0);
    // igazságos rész = összköltés a részesedés arányában; aki többet állt,
    // annak jár a különbség — az időszak átutalásai már levonva
    const adjusted = stats.map((u) => {
      const fair = grandTotal * u.share / 100;
      const out = settlements
        .filter((s) => s.from_user === u.id && inPeriod(s.settle_date))
        .reduce((s2, s) => s2 + Number(s.amount), 0);
      const inn = settlements
        .filter((s) => s.to_user === u.id && inPeriod(s.settle_date))
        .reduce((s2, s) => s2 + Number(s.amount), 0);
      return { ...u, saldo: u.total - fair + out - inn };
    });

    // mohó párosítás: a tartozók fizetnek a többet állóknak
    const creditors = adjusted.filter((u) => u.saldo > 0.5).map((u) => ({ ...u }));
    const debtors = adjusted.filter((u) => u.saldo < -0.5).map((u) => ({ ...u, owe: -u.saldo }));
    const transfers: { from: string; to: string; amount: number }[] = [];
    for (const d of debtors) {
      let rem = d.owe;
      for (const cr of creditors) {
        if (rem <= 0.5) break;
        if (cr.saldo <= 0.5) continue;
        const v = Math.min(rem, cr.saldo);
        if (Math.round(v) >= 1) transfers.push({ from: d.name, to: cr.name, amount: Math.round(v) });
        rem -= v;
        cr.saldo -= v;
      }
    }
    return { stats, grandTotal, transfers };
  }, [profiles, expenses, attendance, settlements, period, selSites]);

  const saveSettlement = () => {
    if (!toUser || !amount) return;
    insertRow('settlements', {
      from_user: me,
      to_user: toUser,
      amount: parseAmount(amount),
      settle_date: todayISO(),
      note: note || null,
    });
    setShowForm(false);
    setAmount('');
    setNote('');
    setTimeout(() => { void balances.refresh(); void suggestions.refresh(); }, 1500);
  };

  return (
    <Screen>
      <Card style={{ borderColor: C.primary }}>
        <H2>💸 Ki mennyit költött?</H2>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {PERIODS.map((o) => (
            <Chip key={o.value} label={o.label} on={period === o.value} onPress={() => setPeriod(o.value)} />
          ))}
        </View>
        {sites.length > 1 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            <Text style={{ fontSize: 12, color: C.sub, fontWeight: '600' }}>Terület:</Text>
            <Chip label="Mind" on={selSites.size === 0} onPress={() => setSelSites(new Set())} />
            {[...sites].sort((a, b) => a.name.localeCompare(b.name, 'hu')).map((s) => (
              <Chip key={s.id} label={s.name} on={selSites.has(s.id)} onPress={() => toggleSite(s.id)} />
            ))}
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', gap: S.md, marginTop: 4 }}>
          {compare.stats.map((u, idx) => (
            <View
              key={u.id}
              style={{
                flex: 1, gap: 6,
                borderLeftWidth: idx > 0 ? 1 : 0, borderLeftColor: C.border,
                paddingLeft: idx > 0 ? S.md : 0,
              }}
            >
              <Text style={{ fontSize: 16, fontWeight: '800', color: u.id === me ? C.primary : C.text }}>
                {u.name}{u.id === me ? ' (én)' : ''}
              </Text>
              <View>
                <Sub>Anyag/egyéb</Sub>
                <Body style={{ fontWeight: '600' }}>{ft(u.exp)}</Body>
              </View>
              <View>
                <Sub>Bér</Sub>
                <Body style={{ fontWeight: '600' }}>{ft(u.wage)}</Body>
              </View>
              {u.comm > 0 ? (
                <View>
                  <Sub>Közvetítői díj</Sub>
                  <Body style={{ fontWeight: '600' }}>{ft(u.comm)}</Body>
                </View>
              ) : null}
              <Divider />
              <View>
                <Sub>Összesen</Sub>
                <Text style={{ fontSize: 17, fontWeight: '800', color: C.text }}>{ft(u.total)}</Text>
              </View>
            </View>
          ))}
        </View>

        <Divider />
        <H2>Ki kinek jön ez alapján?</H2>
        {compare.grandTotal === 0 ? (
          <Sub>Nincs költés a kiválasztott időszakban/területen.</Sub>
        ) : compare.transfers.length === 0 ? (
          <Sub>Rendezve — nincs különbség. ✅</Sub>
        ) : (
          compare.transfers.map((t, i) => (
            <Body key={i} style={{ fontWeight: '700' }}>
              💸 {t.from} → {t.to}: <Text style={{ color: C.danger, fontWeight: '800' }}>{ft(t.amount)}</Text>
            </Body>
          ))
        )}
        <Sub>
          A részesedés arányában ({compare.stats.map((u) => `${u.name} ${u.share}%`).join(' · ')}) számolva;
          az időszakban rögzített átutalások már levonva. Átutalás rögzítésekor azonnal frissül.
        </Sub>
      </Card>

      {(balances.fromCache || common.fromCache) ? (
        <Sub style={{ color: C.warning }}>⚠️ Offline — az utolsó ismert egyenlegeket látod.</Sub>
      ) : null}

      <Card>
        <H2>Közös eredmény (nettó)</H2>
        {c ? (
          <>
            <KV k="Befolyt bevétel" v={ft(c.revenue_paid_net)} />
            <KV k="Kiszámlázva, de nem folyt be" v={ft(c.outstanding_net)} />
            <KV k="Költségek" v={ft(-Number(c.expense_net))} />
            <KV k="Bérköltségek" v={ft(-Number(c.wage_net))} />
            <Divider />
            <KV k="Közös nettó eredmény" v={ft(c.profit_net)} strong />
          </>
        ) : <Sub>Betöltés…</Sub>}
      </Card>

      {(balances.data ?? []).map((b) => (
        <Card key={b.user_id} style={b.user_id === me ? { borderColor: C.primary } : undefined}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <H2>{b.display_name}{b.user_id === me ? ' (én)' : ''}</H2>
            <Text style={{ fontSize: 18, fontWeight: '800', color: Number(b.balance) >= 0 ? C.success : C.danger }}>
              {ft(b.balance)}
            </Text>
          </View>
          <KV k={`Eredmény-részesedés (${b.profit_share_percent}%)`} v={ft(b.profit_share_amount)} />
          <KV k="Költségek, amiket ő fizetett" v={ft(b.spent_expenses)} />
          <KV k="Bérek, amiket ő fizetett ki" v={ft(b.spent_wages)} />
          {Number(b.spent_commissions) > 0 ? <KV k="Külsős közvetítői díj, amit ő fizetett" v={ft(b.spent_commissions)} /> : null}
          {Number(b.commission_credit) > 0 ? <KV k="Neki járó közvetítői díj" v={ft(b.commission_credit)} /> : null}
          <KV k="Hozzá befolyt számlák" v={ft(-Number(b.received_invoices))} />
          {Number(b.settlements_out) > 0 ? <KV k="Általa utalt rendezések" v={ft(b.settlements_out)} /> : null}
          {Number(b.settlements_in) > 0 ? <KV k="Neki utalt rendezések" v={ft(-Number(b.settlements_in))} /> : null}
        </Card>
      ))}

      <Card style={{ borderColor: C.accent }}>
        <H2>Javasolt rendezés</H2>
        {(suggestions.data ?? []).length === 0 ? (
          <Sub>Nincs rendezendő különbség. ✅</Sub>
        ) : (
          (suggestions.data ?? []).map((s, i) => (
            <Body key={i} style={{ fontWeight: '600' }}>
              💸 {s.from_name} utaljon {s.to_name} részére: {ft(s.amount)}
            </Body>
          ))
        )}
      </Card>

      <Card>
        <H2>Rendezés rögzítése</H2>
        {showForm ? (
          <>
            <Sub>Én ({name(me)}) utaltam:</Sub>
            <Picker
              label="Kinek"
              items={profiles.filter((p) => p.id !== me && !p.is_admin)}
              selectedId={toUser}
              getId={(p) => p.id}
              getLabel={(p) => p.display_name}
              onSelect={setToUser}
            />
            <Input label="Összeg (Ft)" value={amount} onChangeText={setAmount} keyboardType="numeric" placeholder="pl. 94 000" />
            <Input label="Megjegyzés" value={note} onChangeText={setNote} placeholder="opcionális" />
            <View style={{ flexDirection: 'row', gap: S.md }}>
              <View style={{ flex: 1 }}><Btn title="Mégse" kind="ghost" onPress={() => setShowForm(false)} /></View>
              <View style={{ flex: 1 }}><Btn title="Mentés" onPress={saveSettlement} disabled={!toUser || !amount} /></View>
            </View>
          </>
        ) : (
          <Btn title="+ Átutalás rögzítése" kind="secondary" onPress={() => setShowForm(true)} />
        )}
      </Card>

      <Card>
        <H2>Korábbi rendezések</H2>
        {settlements.length === 0 ? <Empty text="Még nincs rögzített rendezés." /> : null}
        {[...settlements].sort((a, b) => b.settle_date.localeCompare(a.settle_date)).map((s) => (
          <View key={s.id} style={{ paddingVertical: 4 }}>
            <Body>{hd(s.settle_date)} — {name(s.from_user)} → {name(s.to_user)}: <Text style={{ fontWeight: '700' }}>{ft(s.amount)}</Text></Body>
            {s.note ? <Sub>{s.note}</Sub> : null}
            {s.created_by === me ? (
              <Btn title="Törlés" kind="ghost" small onPress={() => {
                softDeleteRow('settlements', s.id);
                setTimeout(() => { void balances.refresh(); void suggestions.refresh(); }, 1500);
              }} />
            ) : null}
          </View>
        ))}
      </Card>
    </Screen>
  );
}
