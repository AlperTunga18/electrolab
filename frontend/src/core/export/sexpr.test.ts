import { describe, expect, it } from 'vitest';
import { headOf, kid, kids, MAX_DEPTH, numAt, parseSexpr, SexprError, strAt, tryParseSexpr, type SList } from './sexpr';
import { sq } from './kicad';

describe('sexpr okuyucu', () => {
  it('liste, atom, sayı, tırnaklı metin', () => {
    const [f] = parseSexpr('(a 1 -2.5 .5 1e3 "x y" sym (b "7") ())') as SList[];
    expect(f).toEqual(['a', 1, -2.5, 0.5, 1000, 'x y', 'sym', ['b', '7'], []]);
    expect(headOf(f)).toBe('a');
    expect(numAt(f, 1)).toBe(1);
    expect(strAt(kid(f, 'b'), 1)).toBe('7'); // tırnaklı "7" metin kalır
  });

  it('kaçışlar: \\" \\\\ \\n, bilinmeyen kaçış karakteri korur', () => {
    const [f] = parseSexpr('(s "a\\"b\\\\c\\nd\\q")') as SList[];
    expect(f[1]).toBe('a"b\\c\nd' + 'q');
  });

  it('sq() çıktısı geri okunur (kaçışlı metinler)', () => {
    for (const s of ['plain', 'a"b', 'back\\slash', 'x\\"y', '(paren)', 'a b  c', '']) {
      const [f] = parseSexpr(`(v ${sq(s)})`) as SList[];
      expect(f[1]).toBe(s);
    }
  });

  it('birden çok üst düzey form, boş girdi', () => {
    expect(parseSexpr('(a) (b) c')).toEqual([['a'], ['b'], 'c']);
    expect(parseSexpr('  \n ')).toEqual([]);
  });

  it('yardımcılar: kids/kid', () => {
    const [f] = parseSexpr('(z (n 1) (n 2) (m 3))') as SList[];
    expect(kids(f, 'n').length).toBe(2);
    expect(numAt(kid(f, 'm'), 1)).toBe(3);
    expect(kid(f, 'yok')).toBeUndefined();
  });

  it('parantez dengesizliği: fazladan ) ve eksik ( hata verir, çökmez', () => {
    expect(() => parseSexpr('(a))')).toThrow(SexprError);
    expect(() => parseSexpr(')')).toThrow(/Fazladan/);
    expect(() => parseSexpr('(a (b)')).toThrow(/kapatılmamış/);
    const r = tryParseSexpr('(a (b)');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.pos).toBe(6);
  });

  it('kapanmamış metin hata verir', () => {
    expect(() => parseSexpr('(a "abc')).toThrow(/Kapanmamış/);
    expect(() => parseSexpr('(a "abc\\')).toThrow(/Kapanmamış/);
    expect(tryParseSexpr('"').ok).toBe(false);
  });

  it('çok derin iç içelik yığını taşırmaz, sınır hatası verir', () => {
    const r = tryParseSexpr('('.repeat(MAX_DEPTH + 10));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/derinlik/);
    expect(tryParseSexpr('('.repeat(MAX_DEPTH - 1) + ')'.repeat(MAX_DEPTH - 1)).ok).toBe(true);
    expect(tryParseSexpr('('.repeat(200000)).ok).toBe(false);
  });

  it('gelişigüzel çöp girdide hep ya sonuç ya hata (istisna sızmaz)', () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const alphabet = ['(', ')', '"', '\\', ' ', 'a', '1', '.', '-', '\n'];
    for (let i = 0; i < 300; i++) {
      const t = Array.from({ length: 1 + Math.floor(rnd() * 40) }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join('');
      expect(() => tryParseSexpr(t)).not.toThrow();
    }
  });
});
