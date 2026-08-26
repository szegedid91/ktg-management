// Push-értesítések kiküldése (Expo Push API) + heti összefoglaló és
// lejárt tételek emlékeztetője.
//
// Hívások:
//  - {job: "drain"}   → a notification_queue ürítése (app-sync után, ill. cron)
//  - {job: "digest"}  → heti összefoglaló (pl. péntek délutáni cron)
//  - {job: "overdue"} → N napnál régebbi kifizetetlen bér / be nem folyt számla

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ft = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' Ft';

async function sendExpoPush(messages: { to: string; title: string; body: string; data?: unknown }[]) {
  if (messages.length === 0) return;
  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(messages),
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const { job = 'drain' } = await req.json().catch(() => ({}));

  const { data: profiles } = await supabase.from('profiles').select('*');
  const tokenOf = (id: string) => profiles?.find((p) => p.id === id)?.push_token as string | null;

  let sentCount = 0;

  if (job === 'drain') {
    const { data: queue } = await supabase
      .from('notification_queue')
      .select('*')
      .is('sent_at', null)
      .order('created_at')
      .limit(100);
    const messages = [];
    const ids = [];
    for (const n of queue ?? []) {
      ids.push(n.id);
      const token = tokenOf(n.recipient);
      if (token) messages.push({ to: token, title: n.title, body: n.body, data: n.payload });
    }
    await sendExpoPush(messages);
    sentCount = messages.length;
    if (ids.length) {
      await supabase.from('notification_queue').update({ sent_at: new Date().toISOString() }).in('id', ids);
    }
  }

  if (job === 'digest') {
    const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
    const [{ data: exp }, { data: att }, { data: inv }] = await Promise.all([
      supabase.from('expenses').select('net_amount').gte('expense_date', weekAgo).is('deleted_at', null),
      supabase.from('attendance').select('amount').gte('work_date', weekAgo).is('deleted_at', null),
      supabase.from('invoices').select('net_amount').gte('paid_at', weekAgo).not('paid_at', 'is', null).is('deleted_at', null),
    ]);
    const cost = (exp ?? []).reduce((s, e) => s + Number(e.net_amount), 0)
      + (att ?? []).reduce((s, a) => s + Number(a.amount), 0);
    const revenue = (inv ?? []).reduce((s, i) => s + Number(i.net_amount), 0);
    const { data: balances } = await supabase.from('v_user_balances').select('*');
    const messages = [];
    for (const p of profiles ?? []) {
      if (!p.notify_weekly || !p.push_token) continue;
      const b = balances?.find((x) => x.user_id === p.id);
      messages.push({
        to: p.push_token,
        title: 'Heti összefoglaló 📊',
        body: `Heti költés: ${ft(cost)} · bevétel: ${ft(revenue)} · egyenleged: ${ft(Number(b?.balance ?? 0))}`,
      });
    }
    await sendExpoPush(messages);
    sentCount = messages.length;
  }

  if (job === 'overdue') {
    const messages = [];
    for (const p of profiles ?? []) {
      if (!p.notify_overdue || !p.push_token) continue;
      const cutoffDate = new Date(Date.now() - Number(p.overdue_days) * 86400_000).toISOString().slice(0, 10);
      const [{ data: wages }, { data: inv }] = await Promise.all([
        supabase.from('attendance').select('amount, commission_amount')
          .is('paid_at', null).is('deleted_at', null).neq('pay_basis', 'presence').lte('work_date', cutoffDate),
        supabase.from('invoices').select('net_amount')
          .is('paid_at', null).is('deleted_at', null).lte('invoice_date', cutoffDate),
      ]);
      const unpaidWage = (wages ?? []).reduce((s, a) => s + Number(a.amount) - Number(a.commission_amount), 0);
      const outstanding = (inv ?? []).reduce((s, i) => s + Number(i.net_amount), 0);
      if (unpaidWage > 0 || outstanding > 0) {
        const parts = [];
        if (unpaidWage > 0) parts.push(`kifizetetlen bér: ${ft(unpaidWage)}`);
        if (outstanding > 0) parts.push(`be nem folyt számla: ${ft(outstanding)}`);
        messages.push({
          to: p.push_token,
          title: 'Régóta függő tételek ⏰',
          body: `${p.overdue_days} napnál régebbi — ${parts.join(' · ')}`,
        });
      }
    }
    await sendExpoPush(messages);
    sentCount = messages.length;
  }

  return new Response(JSON.stringify({ ok: true, sent: sentCount }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
