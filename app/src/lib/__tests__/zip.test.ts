import { describe, it, expect } from 'vitest';
import { crc32, makeZip, base64ToBytes } from '../zip';

describe('zip', () => {
  it('crc32 a szabványos ellenőrző értéket adja', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
  it('makeZip: helyi fejlécek, központi könyvtár, bejegyzésszám', () => {
    const a = new TextEncoder().encode('hello'), b = new TextEncoder().encode('világ');
    const z = makeZip([{ path: '47_het/a.txt', bytes: a }, { path: 'b.txt', bytes: b }]);
    expect([z[0], z[1], z[2], z[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    // a vége-rekord: bejegyzések száma = 2
    const end = z.length - 22;
    expect([z[end], z[end + 1], z[end + 2], z[end + 3]]).toEqual([0x50, 0x4b, 0x05, 0x06]);
    expect(z[end + 10] | (z[end + 11] << 8)).toBe(2);
    expect(z.length).toBe((30 + 12 + 5) + (30 + 5 + 6) + (46 + 12) + (46 + 5) + 22);
  });
  it('base64ToBytes', () => {
    expect([...base64ToBytes('aGVsbG8=')]).toEqual([104, 101, 108, 108, 111]);
  });
});
