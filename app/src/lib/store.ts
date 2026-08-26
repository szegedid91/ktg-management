// Local-first tároló: minden szinkronizált tábla lokális tükre + outbox.
// Minden írás először ide kerül (optimista), majd a sync.ts tolja fel a
// szerverre, amikor van hálózat. Konfliktus: last-write-wins, de a szerver
// audit logja minden verziót megőriz.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { SYNC_TABLES, SyncTable } from './types';

type Row = Record<string, any> & { id: string; updated_at?: string };

export interface OutboxOp {
  opId: string;
  kind: 'upsert' | 'rpc';
  table?: SyncTable;
  row?: Row;
  fn?: string;
  args?: Record<string, any>;
  queuedAt: string;
  lastError?: string;
}

const PREFIX = 'ktg:';

class Store {
  private tables = new Map<SyncTable, Map<string, Row>>();
  private outbox: OutboxOp[] = [];
  private failed: OutboxOp[] = [];
  private cursors: Record<string, string> = {};
  private listeners = new Set<() => void>();
  private loaded = false;
  private persistTimers = new Map<string, ReturnType<typeof setTimeout>>();
  version = 0;

  async load(): Promise<void> {
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
        if (key === PREFIX + 'outbox') this.outbox = parsed;
        else if (key === PREFIX + 'failed') this.failed = parsed;
        else if (key === PREFIX + 'cursors') this.cursors = parsed;
        else {
          const table = key.slice((PREFIX + 't:').length) as SyncTable;
          this.tables.set(table, new Map(parsed.map((r: Row) => [String(r.id), r])));
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
      const pending = this.outbox.some(
        (op) => op.kind === 'upsert' && op.table === table && String(op.row?.id) === String(row.id),
      );
      if (pending) return;
    }
    map.set(String(row.id), row);
    this.persistTable(table);
    this.emit();
  }

  putManyLocal(table: SyncTable, rows: Row[], fromServer = false) {
    if (rows.length === 0) return;
    let map = this.tables.get(table);
    if (!map) { map = new Map(); this.tables.set(table, map); }
    const pendingIds = fromServer
      ? new Set(this.outbox.filter((op) => op.kind === 'upsert' && op.table === table).map((op) => String(op.row!.id)))
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
