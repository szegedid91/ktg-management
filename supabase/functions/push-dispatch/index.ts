// Push-értesítések kiküldése (Expo Push API natívra + Web Push a PWA-ra)
// + heti összefoglaló és lejárt tételek emlékeztetője.
//
// Hívások:
//  - {job: "drain"}   → a notification_queue ürítése (app-sync után, ill. cron)
//  - {job: "digest"}  → heti összefoglaló (pl. péntek délutáni cron)
//  - {job: "overdue"} → N napnál régebbi kifizetetlen bér / be nem folyt számla
//
// Web Push: a VAPID kulcspár a Vaultban ('vapid_public', 'vapid_private'),
// csak a service role olvassa (fn_vapid_keys RPC). A címzett minden élő
// push_subscriptions sorára küldünk; 404/410 → a feliratkozás lejárt,
// deleted_at-tal jelöljük.

import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const VAPID_SUBJECT = 'mailto:dnl.szegedi@gmail.com';

type WebSub = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };

/** A bell-oldal (notifications.tsx) útvonal-logikájának tükre: a push
 *  kattintás ugyanoda vigyen, ahová az app-beli értesítés. */
function targetUrl(kind: string, payload: any): string {
  const p = payload ?? {};
  if (kind === 'worker_approved' || kind === 'worker_rejected') return '/';
  if (kind === 'timesheet') return p.timesheet_id ? '/timesheets' : '/';
  if (p.task_id) return `/task/${p.task_id}`;
  if (p.site_id) return `/site/${p.site_id}`;
  if (p.worker_id) return `/worker/${p.worker_id}`;
  if (p.expense_id) return `/expense/${p.expense_id}`;
  if (p.request_id) return '/settings';
  if (p.entity_type && p.entity_id) {
    const map: Record<string, string> = { site: '/site/', expense: '/expense/', invoice: '/invoice/', worker: '/worker/' };
    if (map[p.entity_type]) return `${map[p.entity_type]}${p.entity_id}`;
  }
  return '/notifications';
}

/** Web Push küldés egy feliratkozásra. Visszatérés: ok | gone (lejárt,
 *  törlendő) | error. */
async function sendWebPush(sub: WebSub, payload: { title: string; body: string; url: string })
  : Promise<{ status: 'ok' | 'gone' | 'error'; error?: string }> {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { TTL: 86400 },
    );
    return { status: 'ok' };
  } catch (e: any) {
    const code = Number(e?.statusCode);
    if (code === 404 || code === 410) return { status: 'gone', error: `HTTP ${code}` };
    return { status: 'error', error: String(e?.body ?? e?.message ?? e).slice(0, 300) };
  }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ft = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' Ft';

/** Expo push küldés; a válasz ticketjei alapján visszaadja, mely üzenetek
 *  mentek el, és mely tokenek érvénytelenek (DeviceNotRegistered). */
async function sendExpoPush(messages: { to: string; title: string; body: string; data?: unknown }[])
  : Promise<{ ok: boolean[]; deadTokens: string[] }> {
  const ok = messages.map(() => false);
  const deadTokens: string[] = [];
  if (messages.length === 0) return { ok, deadTokens };
  try {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
    });
    if (!res.ok) return { ok, deadTokens };
    const body = await res.json().catch(() => ({}));
    const tickets: any[] = Array.isArray(body?.data) ? body.data : [];
    tickets.forEach((t, i) => {
      if (t?.status === 'ok') ok[i] = true;
      else if (t?.details?.error === 'DeviceNotRegistered') deadTokens.push(messages[i].to);
    });
  } catch (e) {
    console.error('expo push', e);
  }
  return { ok, deadTokens };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const { job = 'drain' } = await req.json().catch(() => ({}));

  // a digest/overdue csak cronból (service kulccsal) futhat; a drain-t
  // bejelentkezett felhasználó is kérheti, de akkor csak a SAJÁT sorai mennek ki
  const auth = req.headers.get('Authorization') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const isService = !!serviceKey && auth === `Bearer ${serviceKey}`;
  let onlyRecipient: string | null = null;
  if (!isService) {
    if (job !== 'drain') {
      return new Response(JSON.stringify({ error: 'Ez a feladat csak ütemezett (service) hívásból futtatható.' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: auth } } });
    const { data: u } = await userClient.auth.getUser().catch(() => ({ data: { user: null } } as any));
    if (!u?.user) {
      return new Response(JSON.stringify({ error: 'Bejelentkezés szükséges.' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    onlyRecipient = u.user.id;
  }

  const { data: profiles } = await supabase.from('profiles').select('*');
  const tokenOf = (id: string) => profiles?.find((p) => p.id === id)?.push_token as string | null;
  // cégszintű összesítők (heti, lejárt) csak a vezetőknek
  const partners = (profiles ?? []).filter((p) => p.worker_id == null);
  const clearDeadTokens = async (tokens: string[]) => {
    if (tokens.length) await supabase.from('profiles').update({ push_token: null }).in('push_token', tokens);
  };

  let sentCount = 0;

  if (job === 'drain') {
    let q = supabase
      .from('notification_queue')
      .select('*')
      .is('sent_at', null)
      .lt('attempts', 5) // tartósan hibás sor ne tartsa fel a többit
      .order('created_at')
      .limit(100);
    if (onlyRecipient) q = q.eq('recipient', onlyRecipient);
    const { data: queue } = await q;
    const rows = queue ?? [];

    // Web Push: VAPID kulcsok + a címzettek élő böngésző-feliratkozásai.
    // Kulcs nélkül (még nincs beszúrva) a web ág egyszerűen kimarad.
    const recipients = [...new Set(rows.map((n) => n.recipient as string))];
    let webSubs: WebSub[] = [];
    let vapidReady = false;
    if (recipients.length) {
      // a kulcspár a Vaultban él, csak service-kulccsal olvasható (fn_vapid_keys)
      const { data: keys } = await supabase.rpc('fn_vapid_keys').maybeSingle();
      const pub = (keys as any)?.public_key as string | undefined;
      const priv = (keys as any)?.private_key as string | undefined;
      if (pub && priv) {
        webpush.setVapidDetails(VAPID_SUBJECT, pub, priv);
        vapidReady = true;
        const { data: subs } = await supabase.from('push_subscriptions')
          .select('id, user_id, endpoint, p256dh, auth')
          .in('user_id', recipients).is('deleted_at', null);
        webSubs = (subs ?? []) as WebSub[];
      } else {
        console.warn('web push: hiányzó VAPID kulcs az app_secrets táblában');
      }
    }
    const subsOf = (uid: string) => (vapidReady ? webSubs.filter((s) => s.user_id === uid) : []);

    // 1) Expo (natív) üzenetek
    const messages: { to: string; title: string; body: string; data?: unknown }[] = [];
    const msgIds: number[] = [];
    const doneIds: number[] = []; // se token, se feliratkozás: az app-beli értesítés megvan, push nincs
    for (const n of rows) {
      const token = tokenOf(n.recipient);
      if (token) { messages.push({ to: token, title: n.title, body: n.body, data: n.payload }); msgIds.push(n.id); }
      else if (subsOf(n.recipient).length === 0) doneIds.push(n.id);
    }
    const { ok, deadTokens } = await sendExpoPush(messages);
    ok.forEach((v, i) => { if (v) doneIds.push(msgIds[i]); });
    // érvénytelen tokenű címzett sora is lezárható (újraküldésnek nincs értelme)
    deadTokens.forEach((t) => msgIds.forEach((id, i) => { if (messages[i].to === t) doneIds.push(id); }));
    await clearDeadTokens(deadTokens);
    sentCount = ok.filter(Boolean).length;

    // 2) Web Push minden feliratkozott böngészőre; a sor akkor is lezárul,
    //    ha csak a webes ág sikerült
    const goneIds = new Set<string>();
    const errors = new Map<string, string>();
    for (const n of rows) {
      const subs = subsOf(n.recipient);
      if (!subs.length) continue;
      const payload = { title: n.title, body: n.body, url: targetUrl(n.kind, n.payload) };
      const results = await Promise.all(subs.map((s) => sendWebPush(s, payload)));
      let any = false;
      results.forEach((r, i) => {
        if (r.status === 'ok') any = true;
        else if (r.status === 'gone') goneIds.add(subs[i].id);
        else errors.set(subs[i].id, r.error ?? 'ismeretlen hiba');
      });
      if (any) { doneIds.push(n.id); sentCount++; }
      // csak lejárt feliratkozások: a sor lezárható, kézbesíteni nincs hová
      else if (results.every((r) => r.status === 'gone') && !msgIds.includes(n.id)) doneIds.push(n.id);
    }
    if (goneIds.size) {
      await supabase.from('push_subscriptions')
        .update({ deleted_at: new Date().toISOString(), last_error: 'lejárt (404/410)' })
        .in('id', [...goneIds]);
    }
    for (const [id, err] of errors) {
      if (!goneIds.has(id)) await supabase.from('push_subscriptions').update({ last_error: err }).eq('id', id);
    }

    if (doneIds.length) {
      await supabase.from('notification_queue').update({ sent_at: new Date().toISOString() })
        .in('id', [...new Set(doneIds)]);
    }
    // sikertelen sorok: próbálkozás-számláló; 5 után lezárjuk (az app-beli értesítés megvan)
    const done = new Set(doneIds);
    for (const n of rows) {
      if (done.has(n.id)) continue;
      const attempts = Number(n.attempts ?? 0) + 1;
      await supabase.from('notification_queue')
        .update(attempts >= 5 ? { attempts, sent_at: new Date().toISOString() } : { attempts })
        .eq('id', n.id);
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
    for (const p of partners) {
      if (!p.notify_weekly || !p.push_token) continue;
      const b = balances?.find((x) => x.user_id === p.id);
      messages.push({
        to: p.push_token,
        title: 'Heti összefoglaló 📊',
        body: `Heti költés: ${ft(cost)} · bevétel: ${ft(revenue)} · egyenleged: ${ft(Number(b?.balance ?? 0))}`,
      });
    }
    const r1 = await sendExpoPush(messages);
    await clearDeadTokens(r1.deadTokens);
    sentCount = r1.ok.filter(Boolean).length;
  }

  if (job === 'overdue') {
    const messages = [];
    for (const p of partners) {
      if (!p.notify_overdue || !p.push_token) continue;
      const overdueDays = Number(p.overdue_days ?? 7) || 7;
      const cutoffDate = new Date(Date.now() - overdueDays * 86400_000).toISOString().slice(0, 10);
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
          body: `${overdueDays} napnál régebbi — ${parts.join(' · ')}`,
        });
      }
    }
    const r2 = await sendExpoPush(messages);
    await clearDeadTokens(r2.deadTokens);
    sentCount = r2.ok.filter(Boolean).length;
  }

  return new Response(JSON.stringify({ ok: true, sent: sentCount }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
