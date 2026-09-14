// Hívó azonosítása edge-funkcióban: a kérés Authorization fejlécéből
// kiolvassuk a felhasználót, és a profiljából a szerepét. A pénzügyi
// funkciók csak fő felhasználónak (partnernek) állnak rendelkezésre.

import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2';

export interface Caller { id: string; isPartner: boolean; isAdmin: boolean }

export async function identifyCaller(req: Request, admin: SupabaseClient): Promise<Caller | null> {
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return null;
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: auth } } },
  );
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) return null;
  const { data: prof } = await admin.from('profiles').select('worker_id, is_admin').eq('id', data.user.id).maybeSingle();
  if (!prof) return null;
  return { id: data.user.id, isPartner: prof.worker_id == null, isAdmin: !!prof.is_admin };
}

/** Napi hívás-kvóta felhasználónként (edge_usage tábla, csak service kulccsal írható) */
export async function checkQuota(admin: SupabaseClient, userId: string, fn: string, limit: number): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10);
  const { data } = await admin.from('edge_usage').select('count').eq('user_id', userId).eq('fn', fn).eq('day', day).maybeSingle();
  const count = Number(data?.count ?? 0);
  if (count >= limit) return false;
  await admin.from('edge_usage').upsert({ user_id: userId, fn, day, count: count + 1 }, { onConflict: 'user_id,fn,day' });
  return true;
}
