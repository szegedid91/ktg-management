// Local-first tároló: minden szinkronizált tábla lokális tükre + outbox.
// Minden írás először ide kerül (optimista), majd a sync.ts tolja fel a
// szerverre, amikor van hálózat. Konfliktus: last-write-wins, de a szerver
// audit logja minden verziót megőriz.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { SYNC_TABLES, SyncTable } from './types';

type Row = Record<string, any> & { id: string; updated_at?: string };

export interface OutboxOp {
  opId: string;
  /** upsert: teljes sor (insert); update: mezőszintű patch; rpc: függvényhívás */
  kind: 'upsert' | 'update' | 'rpc';
  table?: SyncTable;
  row?: Row;
  id?: string;
  patch?: Record<string, any>;
  fn?: string;
  args?: Record<string, any>;
  queuedAt: string;
  lastError?: string;
}

/** Az op melyik sor(oka)t érinti — pending-védelemhez és rollbackhez */
export function opRowIds(op: OutboxOp, table: SyncTable): string[] {
  if (op.kind === 'upsert' && op.table === table && op.row) return [String(op.row.id)];
  if (op.kind === 'update' && op.table === table && op.id) return [String(op.id)];
  return [];
}

const PREFIX = 'ktg:';

class Store {
  private tables = new Map<SyncTable, Map<string, Row>>();
  private outbox: OutboxOp[] = [];
  private failed: OutboxOp[] = [];
  private cursors: Record<string, string> = {};
  private listeners = new Set<() => void>();
  private loaded = false;
  private loadPromise: Promise<void> | null = null;
  private persistTimers = new Map<string, ReturnType<typeof setTimeout>>();
  version = 0;

  /** Betöltés-váró: a sync és az írások megvárhatják a diszk-állapotot */
  whenLoaded(): Promise<void> {
    if (this.loaded) return Promise.resolve();
    if (!this.loadPromise) this.loadPromise = this.load();
    return this.loadPromise;
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = this.doLoad();
    return this.loadPromise;
  }

  private async doLoad(): Promise<void> {
    if (this.loaded) return;
    const keys = [
      ...SYNC_TABLES.map((t) => PREFIX + 't:' + t),
      PREFIX + 'outbox',
      PREFIX + 'failed',
      PREFIX + 'cursors',
    ];
    const pairs = await AsyncStorage.multiGet(keys);
    for (const [key, value] of pairs) {
      if (!value) continue;
      try {
        const parsed = JSON.parse(value);
        // MERGE, nem felülírás: ha a betöltés alatt már történt írás
        // (korai sync vagy felhasználói művelet), a memória a frissebb
        if (key === PREFIX + 'outbox') {
          const memIds = new Set(this.outbox.map((o) => o.opId));
          this.outbox = [...(parsed as OutboxOp[]).filter((o) => !memIds.has(o.opId)), ...this.outbox];
        } else if (key === PREFIX + 'failed') {
          const memIds = new Set(this.failed.map((o) => o.opId));
          this.failed = [...(parsed as OutboxOp[]).filter((o) => !memIds.has(o.opId)), ...this.failed];
        } else if (key === PREFIX + 'cursors') {
          this.cursors = { ...parsed, ...this.cursors };
        } else {
          const table = key.slice((PREFIX + 't:').length) as SyncTable;
          const map = this.tables.get(table) ?? new Map<string, Row>();
          for (const r of parsed as Row[]) {
            if (!map.has(String(r.id))) map.set(String(r.id), r);
          }
          this.tables.set(table, map);
        }
      } catch {
        // sérült cache — kihagyjuk, a következő sync újratölti
      }
    }
    this.loaded = true;
    this.emit();
  }

  private emit() {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private schedulePersist(key: string, get: () => any) {
    const existing = this.persistTimers.get(key);
    if (existing) clearTimeout(existing);
    this.persistTimers.set(key, setTimeout(() => {
      this.persistTimers.delete(key);
      AsyncStorage.setItem(key, JSON.stringify(get())).catch(() => {});
    }, 150));
  }

  private persistTable(table: SyncTable) {
    this.schedulePersist(PREFIX + 't:' + table, () => [...(this.tables.get(table)?.values() ?? [])]);
  }

  getAll(table: SyncTable): Row[] {
    return [...(this.tables.get(table)?.values() ?? [])];
  }

  get(table: SyncTable, id: string): Row | undefined {
    return this.tables.get(table)?.get(String(id));
  }

  /** Lokális beírás (optimista vagy szerverről érkező) */
  putLocal(table: SyncTable, row: Row, fromServer = false) {
    let map = this.tables.get(table);
    if (!map) { map = new Map(); this.tables.set(table, map); }
    if (fromServer) {
      // ha van függő lokális írás erre a sorra, a lokális marad, amíg fel nem megy
      const pending = this.outbox.some((op) => opRowIds(op, table).includes(String(row.id)));
      if (pending) return;
    }
    map.set(String(row.id), row);
    this.persistTable(table);
    this.emit();
  }

  /** Szerver-állapot kényszerített visszaírása (elutasított művelet rollbackje) */
  putServer(table: SyncTable, row: Row) {
    let map = this.tables.get(table);
    if (!map) { map = new Map(); this.tables.set(table, map); }
    map.set(String(row.id), row);
    this.persistTable(table);
    this.emit();
  }

  /** Lokális sor eltávolítása (pl. a szerver által elutasított beszúrásé) */
  removeLocal(table: SyncTable, id: string) {
    const map = this.tables.get(table);
    if (map?.delete(String(id))) {
      this.persistTable(table);
      this.emit();
    }
  }

  putManyLocal(table: SyncTable, rows: Row[], fromServer = false) {
    if (rows.length === 0) return;
    let map = this.tables.get(table);
    if (!map) { map = new Map(); this.tables.set(table, map); }
    const pendingIds = fromServer
      ? new Set(this.outbox.flatMap((op) => opRowIds(op, table)))
      : new Set<string>();
    for (const row of rows) {
      if (pendingIds.has(String(row.id))) continue;
      map.set(String(row.id), row);
    }
    this.persistTable(table);
    this.emit();
  }

  // ---------- outbox ----------
  enqueue(op: OutboxOp) {
    this.outbox.push(op);
    this.schedulePersist(PREFIX + 'outbox', () => this.outbox);
    this.emit();
  }

  peekOutbox(): OutboxOp[] {
    return [...this.outbox];
  }

  removeOp(opId: string) {
    this.outbox = this.outbox.filter((o) => o.opId !== opId);
    this.schedulePersist(PREFIX + 'outbox', () => this.outbox);
    this.emit();
  }

  markOpError(opId: string, error: string) {
    const op = this.outbox.find((o) => o.opId === opId);
    if (op) op.lastError = error;
    this.schedulePersist(PREFIX + 'outbox', () => this.outbox);
    this.emit();
  }

  moveOpToFailed(opId: string) {
    const op = this.outbox.find((o) => o.opId === opId);
    if (!op) return;
    this.outbox = this.outbox.filter((o) => o.opId !== opId);
    this.failed.push(op);
    this.schedulePersist(PREFIX + 'outbox', () => this.outbox);
    this.schedulePersist(PREFIX + 'failed', () => this.failed);
    this.emit();
  }

  getFailed(): OutboxOp[] {
    return [...this.failed];
  }

  discardFailed(opId: string) {
    this.failed = this.failed.filter((o) => o.opId !== opId);
    this.schedulePersist(PREFIX + 'failed', () => this.failed);
    this.emit();
  }

  retryFailed(opId: string) {
    const op = this.failed.find((o) => o.opId === opId);
    if (!op) return;
    this.failed = this.failed.filter((o) => o.opId !== opId);
    op.lastError = undefined;
    this.outbox.push(op);
    this.schedulePersist(PREFIX + 'outbox', () => this.outbox);
    this.schedulePersist(PREFIX + 'failed', () => this.failed);
    this.emit();
  }

  outboxSize(): number {
    return this.outbox.length;
  }

  // ---------- sync kurzorok ----------
  getCursor(table: string): string {
    return this.cursors[table] ?? '1970-01-01T00:00:00Z';
  }

  setCursor(table: string, cursor: string) {
    this.cursors[table] = cursor;
    this.schedulePersist(PREFIX + 'cursors', () => this.cursors);
  }

  async clearAll() {
    this.tables.clear();
    this.outbox = [];
    this.failed = [];
    this.cursors = {};
    const keys = await AsyncStorage.getAllKeys();
    await AsyncStorage.multiRemove(keys.filter((k) => k.startsWith(PREFIX)));
    this.emit();
  }
}

export const store = new Store();
