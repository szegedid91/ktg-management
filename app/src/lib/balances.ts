// Egyenleg-számítás a lokális tükörből — a szerveroldali v_user_balances
// képletének pontos mása. Előnye: minden rögzítés (költség, bér, számla,
// rendezés) azonnal módosítja az egyenleget, hálózati kör nélkül; a partner
// rögzítései a következő szinkronnal jelennek meg.

import {
  Attendance, Expense, Invoice, Profile, ProfitShareHistory, Settlement,
} from './types';

export interface LocalBalance {
  user_id: string;
  display_name: string;
  profit_share_percent: number;
  profit_share_amount: number;
  spent_expenses: number;
  spent_wages: number;
  spent_commissions: number;
  settlements_out: number;
  commission_credit: number;
  received_invoices: number;
  settlements_in: number;
  balance: number;
}

export function computeBalances(
  profiles: Profile[],
  expenses: Expense[],
  attendance: Attendance[],
  invoices: Invoice[],
  settlements: Settlement[],
  history: ProfitShareHistory[],
): LocalBalance[] {
  const partners = profiles.filter((p) => !p.is_admin);

  // a felhasználó részesedése adott napon (a módosítások nem visszamenőlegesek)
  const shareAt = (uid: string, date: string): number => {
    let best: ProfitShareHistory | null = null;
    for (const h of history) {
      if (h.user_id !== uid || h.valid_from > date) continue;
      if (!best || h.valid_from > best.valid_from) best = h;
    }
    if (best) return Number(best.percent);
    return Number(profiles.find((p) => p.id === uid)?.profit_share_percent ?? 0);
  };

  return partners.map((p) => {
    // eredmény-részesedés tételenként: bevétel a befolyás napja, költség/bér
    // a tétel napja szerint érvényes százalékkal
    let share = 0;
    for (const i of invoices) {
      if (i.paid_at) share += (Number(i.net_amount) * shareAt(p.id, i.paid_at)) / 100;
    }
    for (const e of expenses) share -= (Number(e.net_amount) * shareAt(p.id, e.expense_date)) / 100;
    for (const a of attendance) share -= (Number(a.amount) * shareAt(p.id, a.work_date)) / 100;

    const spentExpenses = expenses
      .filter((e) => e.paid_by === p.id)
      .reduce((s, e) => s + Number(e.net_amount), 0);
    const spentWages = attendance
      .filter((a) => a.paid_by === p.id && !!a.paid_at)
      .reduce((s, a) => s + Number(a.amount) - Number(a.commission_amount), 0);
    const spentCommissions = attendance
      .filter((a) => a.commission_paid_by === p.id && !!a.referrer_external_id && !!a.commission_paid_at)
      .reduce((s, a) => s + Number(a.commission_amount), 0);
    const commissionCredit = attendance
      .filter((a) => a.referrer_user_id === p.id)
      .reduce((s, a) => s + Number(a.commission_amount), 0);
    const receivedInvoices = invoices
      .filter((i) => !!i.paid_at && (i.paid_marked_by ?? i.created_by) === p.id)
      .reduce((s, i) => s + Number(i.net_amount), 0);
    const settlementsOut = settlements
      .filter((s2) => s2.from_user === p.id)
      .reduce((s, x) => s + Number(x.amount), 0);
    const settlementsIn = settlements
      .filter((s2) => s2.to_user === p.id)
      .reduce((s, x) => s + Number(x.amount), 0);

    const profitShareAmount = Math.round(share * 100) / 100;
    return {
      user_id: p.id,
      display_name: p.display_name,
      profit_share_percent: Number(p.profit_share_percent),
      profit_share_amount: profitShareAmount,
      spent_expenses: spentExpenses,
      spent_wages: spentWages,
      spent_commissions: spentCommissions,
      settlements_out: settlementsOut,
      commission_credit: commissionCredit,
      received_invoices: receivedInvoices,
      settlements_in: settlementsIn,
      balance: profitShareAmount + spentExpenses + spentWages + spentCommissions
        + settlementsOut + commissionCredit - receivedInvoices - settlementsIn,
    };
  });
}

/** Mohó rendezés-javaslat: a tartozók utaljanak a többet állóknak. */
export function suggestTransfers(
  balances: LocalBalance[],
): { from_name: string; to_name: string; amount: number }[] {
  const creditors = balances
    .filter((b) => b.balance > 0.005)
    .map((b) => ({ name: b.display_name, rem: b.balance }))
    .sort((a, b) => b.rem - a.rem);
  const debtors = balances
    .filter((b) => b.balance < -0.005)
    .sort((a, b) => a.balance - b.balance);
  const out: { from_name: string; to_name: string; amount: number }[] = [];
  for (const d of debtors) {
    let rem = -d.balance;
    for (const c of creditors) {
      if (rem <= 0.005) break;
      if (c.rem <= 0.005) continue;
      const v = Math.min(rem, c.rem);
      if (Math.round(v) >= 1) out.push({ from_name: d.display_name, to_name: c.name, amount: Math.round(v) });
      rem -= v;
      c.rem -= v;
    }
  }
  return out;
}
