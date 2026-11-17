import { describe, it, expect } from 'vitest';
import { moneyInText } from '../moneyText';

describe('összeg felismerése szövegben', () => {
  it('a valós eset: „Ez kb 100000ft”', () => {
    expect(moneyInText('Az 500as üstnél vezérlőpanel cserére, illetve gyújtótrafó cserére volt szükség. Ez kb 100000ft')).toBe(100000);
  });
  it('gyakori írásmódok', () => {
    expect(moneyInText('kb 100 000 Ft volt')).toBe(100000);
    expect(moneyInText('12.500,- lett a csap')).toBe(12500);
    expect(moneyInText('25 ezer forint az anyag')).toBe(25000);
    expect(moneyInText('80e volt')).toBe(80000);
    expect(moneyInText('kb 100k')).toBe(100000);
    expect(moneyInText('1,5 millió')).toBe(1500000);
    expect(moneyInText('3490 HUF')).toBe(3490);
    expect(moneyInText('Összesen: 45 000 forintba került')).toBe(45000);
  });
  it('ami nem összeg', () => {
    expect(moneyInText('A 300as üstnél thermóelem és fúvóka csere volt és működik. Az 500as panel cserés!!!')).toBeNull();
    expect(moneyInText('2 db csap, 3 kg ragasztó, 5 km kiszállás')).toBeNull();
    expect(moneyInText('12:30-ra értem oda, 2026.11.05.')).toBeNull();
    expect(moneyInText('1548324 számú feladat, tel: 06 30 123 4567')).toBeNull();
    expect(moneyInText('2 emelet, 4 elem cserélve')).toBeNull();
    expect(moneyInText('')).toBeNull();
    expect(moneyInText(null)).toBeNull();
  });
});
