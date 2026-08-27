// Azonnali eszközök közti frissítés: a szerver minden adatváltozásról
// (bárki rögzít bármit) realtime jelzést küld, amire rövid összevonás
// után szinkront futtatunk. A 30 mp-es sync-kör csak tartalék marad.

import { supabase } from './supabase';
import { syncNow } from './sync';

let channel: ReturnType<typeof supabase.channel> | null = null;
let pending: ReturnType<typeof setTimeout> | null = null;

export function startRealtime(): void {
  if (channel) return;
  channel = supabase
    .channel('db-changes')
    .on('postgres_changes', { event: '*', schema: 'public' }, () => {
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
