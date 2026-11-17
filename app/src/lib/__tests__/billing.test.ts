import { describe, it, expect } from 'vitest';
import { taskListItems, parseHours, startedHours, billingDefaults } from '../tasks';

describe('feladat szövegében felsorolt munkák', () => {
  it('gondolatjeles felsorolás bevezetővel', () => {
    const t = 'Sziasztok, - szegőléc feljött, balesetveszélyes - fehér mosogatóban lámpa leszakadt - fehér mosogató medence lefolyó szétesett';
    expect(taskListItems(t)).toEqual(['szegőléc feljött, balesetveszélyes', 'fehér mosogatóban lámpa leszakadt', 'fehér mosogató medence lefolyó szétesett']);
  });
  it('sorvégi gondolatjel + sortörés (Opteamus-másolat)', () => {
    const t = 'A felsorolt hibák javítását kérjük szépen:  - \n mosogatógép csöve kilyukadt, spricceli a vizet  - \n vágódeszkák cseréje (az összes színnel együtt 3-3 db-ot szeretnénk kérni)  - \n vágódeszkatartó elhelyezése (perforált polc a vágódeszkák tárolására – Gimi)';
    const items = taskListItems(t);
    expect(items).toHaveLength(3);
    expect(items[1]).toBe('vágódeszkák cseréje (az összes színnel együtt 3-3 db-ot szeretnénk kérni)');
    expect(items[2]).toContain('– Gimi');
  });
  it('szóköz nélküli gondolatjel nagybetű előtt; az első rész is tétel, ha nem bevezető', () => {
    const t = 'NET étterem étkező részénél erősen koszolódott a fal - Konyha területén falak festése -Ajtók, tokok javítása -Szerelő nyílások mázolása';
    expect(taskListItems(t)).toHaveLength(4);
  });
  it('a részletek mezőben, sor eleji pontokkal', () => {
    expect(taskListItems('Karbantartás', '• csap csere\n• lefolyó tisztítás\n• szifon')).toEqual(['csap csere', 'lefolyó tisztítás', 'szifon']);
  });
  it('nem felsorolás: egyetlen kötőjel, kötőjeles szavak', () => {
    expect(taskListItems('Hofherr - mosogatógép javítása')).toEqual([]);
    expect(taskListItems('Primax sütő: párol-süt-melegít, de megáll (3-4 percenként)')).toEqual([]);
    expect(taskListItems('NET étterem – 1233018 Bejelentve 07.27 A szekrény rozsdás.')).toEqual([]);
  });
});

describe('óraszám', () => {
  it('beviteli mező', () => {
    expect(parseHours('1,5')).toBe(1.5);
    expect(parseHours(' 3 óra')).toBe(3);
    expect(parseHours('')).toBe(0);
    expect(parseHours('abc')).toBe(0);
  });
  it('megkezdett óra', () => {
    expect(startedHours(0)).toBe(0);
    expect(startedHours(0.1)).toBe(1);
    expect(startedHours(4)).toBe(4);
    expect(startedHours(4.00001)).toBe(4);
    expect(startedHours(4.2)).toBe(5);
  });
});

describe('elszámolás előtöltése a mért időből', () => {
  const ses = (id: string, task: string, site: string, from: string, to: string) =>
    ({ id, worker_id: 'w', task_id: task, site_id: site, started_at: from, ended_at: to }) as any;
  it('naponként felfelé kerekít, kiszállás csak ahol ez volt a nap első feladata a helyszínen', () => {
    const all = [
      ses('1', 'A', 's1', '2026-11-10T07:00:00Z', '2026-11-10T09:20:00Z'), // 2 ó 20 p → 3
      ses('2', 'B', 's1', '2026-11-10T09:30:00Z', '2026-11-10T10:00:00Z'),
      ses('3', 'B', 's1', '2026-11-11T07:00:00Z', '2026-11-11T08:00:00Z'), // másnap B az első
      ses('4', 'A', 's1', '2026-11-11T08:10:00Z', '2026-11-11T09:40:00Z'), // 1 ó 30 p → 2
    ];
    const d = billingDefaults('A', 'w', all);
    expect(d.hours).toBe(5);
    expect(d.callouts).toBe(1);
    expect(Math.round(d.actual * 60)).toBe(230);
  });
});
