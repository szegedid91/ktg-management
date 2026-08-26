import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { Screen, Card, H2, Sub, Btn, KV, Divider, Empty, Input, Picker, Body } from '../ui/kit';
import { C, S } from '../ui/theme';
import { useOnlineView, useTable } from '../lib/hooks';
import { fetchView, callRpc, insertRow, getCurrentUserId, softDeleteRow } from '../lib/repo';
import { ft, hd, todayISO, parseAmount } from '../lib/format';
import { UserBalance, CommonResult, Settlement, Profile } from '../lib/types';

export default function SettlementScreen() {
  const balances = useOnlineView<UserBalance[]>('balances', () => fetchView('v_user_balances'), []);
  const common = useOnlineView<CommonResult[]>('common', () => fetchView('v_common_result'), []);
  const suggestions = useOnlineView<any[]>('suggestions', () => callRpc('suggested_settlements'), []);
  const settlements = useTable<Settlement>('settlements');
  const profiles = useTable<Profile>('profiles');
  const me = getCurrentUserId();

  const [showForm, setShowForm] = useState(false);
  const [toUser, setToUser] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  const c = common.data?.[0];
  const name = (id: string | null | undefined) => profiles.find((p) => p.id === id)?.display_name ?? '?';

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
              items={profiles.filter((p) => p.id !== me)}
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
