// Hívó azonosítása edge-funkcióban: a kérés Authorization fejlécéből
// kiolvassuk a felhasználót, és a profiljából a szerepét. A pénzügyi
// funkciók csak vezetőnek (partnernek) állnak rendelkezésre.
// Munkavállalói fiók csak jóváhagyott, nem törölt munkavállalóval számít
// bejelentkezettnek (az RLS-t az edge-funkció service-kulccsal megkerüli,
// ezért itt külön ellenőrizzük).

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
  if (prof.worker_id) {
    const { data: w } = await admin.from('workers').select('approved_at, deleted_at').eq('id', prof.worker_id).maybeSingle();
    if (!w || !w.approved_at || w.deleted_at) return null; // függő / elutasított / törölt munkavállaló
  }
  return { id: data.user.id, isPartner: prof.worker_id == null, isAdmin: !!prof.is_admin };
}

/** Napi hívás-kvóta felhasználónként — atomi számláló (edge_usage_bump RPC),
 *  hogy párhuzamos hívásokkal se lehessen túllépni. */
export async function checkQuota(admin: SupabaseClient, userId: string, fn: string, limit: number): Promise<boolean> {
  const { data, error } = await admin.rpc('edge_usage_bump', { p_user: userId, p_fn: fn, p_limit: limit });
  if (error) return false; // ha a számláló nem elérhető, inkább nem engedünk fizetős hívást
  return data === true;
}
