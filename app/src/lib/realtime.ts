// Azonnali eszközök közti frissítés: a szerver minden adatváltozásról
// (bárki rögzít bármit) realtime jelzést küld, amire rövid összevonás
// után szinkront futtatunk. A 30 mp-es sync-kör csak tartalék marad.

import { supabase } from './supabase';
import { syncNow } from './sync';
import { store } from './store';

let channel: ReturnType<typeof supabase.channel> | null = null;
let pending: ReturnType<typeof setTimeout> | null = null;
let seq = 0;

export function startRealtime(): void {
  if (channel) return;
  // Egyedi csatornanév minden indításnál: a supabase.channel(név) a még
  // le nem bontott (aszinkron removeChannel) régi csatornát adná vissza, és a
  // már feliratkozott csatornára nem lehet figyelőt tenni („cannot add
  // postgres_changes callbacks … after subscribe()”).
  channel = supabase
    .channel(`db-changes-${Date.now()}-${++seq}`)
    .on('postgres_changes', { event: '*', schema: 'public' }, (payload: any) => {
      // kommentek: azonnal a tükörbe (ne várjon a szinkronra); hard DELETE-nél
      // a payload.old csak az id-t hozza, ilyenkor eltávolítjuk a sort
      if (payload?.table === 'comments') {
        if (payload.eventType === 'DELETE') {
          const oldId = payload.old?.id;
          if (oldId) store.removeLocal('comments', String(oldId));
        } else if (payload.new?.id) {
          store.putLocal('comments', payload.new, true);
        }
      }
      // gyors egymásutáni változásokat egy szinkronba vonunk össze
      if (pending) clearTimeout(pending);
      pending = setTimeout(() => {
        pending = null;
        void syncNow();
      }, 400);
    })
    .subscribe();
}

export function stopRealtime(): void {
  if (pending) {
    clearTimeout(pending);
    pending = null;
  }
  if (channel) {
    void supabase.removeChannel(channel);
    channel = null;
  }
}
