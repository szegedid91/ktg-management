// A chat utolsó megnyitásának ideje ezen a készüléken — ebből számoljuk az olvasatlan jelvényt az
// alsó menüsoron. A tár kurzorai közt marad meg (kijelentkezéskor azokkal együtt törlődik).

import { useSyncExternalStore } from 'react';
import { store } from './store';

const KEY = 'chat:seen';
const listeners = new Set<() => void>();
const EPOCH = '1970-01-01T00:00:00Z';

export function getChatSeen(): string {
  const v = store.getCursor(KEY);
  return v === EPOCH ? '' : v;
}

/** A chat megnyitva: minden eddigi üzenet olvasottnak számít. */
export function markChatSeen(): void {
  store.setCursor(KEY, new Date().toISOString());
  listeners.forEach((l) => l());
}

export function useChatSeen(): string {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); const un = store.subscribe(cb); return () => { listeners.delete(cb); un(); }; },
    getChatSeen, getChatSeen,
  );
}
