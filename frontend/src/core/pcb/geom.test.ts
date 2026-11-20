import { describe, expect, it } from 'vitest';
import { distToBoundary, offsetPoly, outlinePoly, pointInPoly, polyArea, polyBBox, ptSegDist, segBoundaryDist, signedInsideDist, type Poly } from './geom';

/** L shape: 40 x 40 square with the top-right 20 x 20 quarter removed (area 1200) */
const L: Poly = [[0, 0], [20, 0], [20, 20], [40, 20], [40, 40], [0, 40]];

describe('geom', () => {
  it('pointInPoly: dikdörtgen içi/dışı/kenar', () => {
    const sq: Poly = [[0, 0], [10, 0], [10, 10], [0, 10]];
    expect(pointInPoly(sq, 5, 5)).toBe(true);
    expect(pointInPoly(sq, 11, 5)).toBe(false);
    expect(pointInPoly(sq, 10, 5)).toBe(true); // kenar içeride sayılır
    expect(pointInPoly([[0, 0], [1, 1]], 0.5, 0.5)).toBe(false); // < 3 köşe
  });

  it('pointInPoly: konkav L, girinti dışarıda', () => {
    expect(pointInPoly(L, 10, 10)).toBe(true);
    expect(pointInPoly(L, 30, 30)).toBe(true);
    expect(pointInPoly(L, 30, 10)).toBe(false); // çıkarılan köşe
    expect(pointInPoly(L, 30, 19)).toBe(false);
    expect(pointInPoly(L, 30, 21)).toBe(true);
    expect(pointInPoly([...L].reverse(), 30, 10)).toBe(false); // sarım yönü fark etmez
  });

  it('alan: konkav L = 1200, sarım işareti fark etmez; bbox', () => {
    expect(polyArea(L)).toBeCloseTo(1200, 9);
    expect(polyArea([...L].reverse())).toBeCloseTo(1200, 9);
    expect(polyBBox(L)).toEqual([0, 0, 40, 40]);
  });

  it('mesafeler', () => {
    expect(ptSegDist(5, 3, [0, 0], [10, 0])).toBeCloseTo(3, 9);
    expect(ptSegDist(-3, 4, [0, 0], [10, 0])).toBeCloseTo(5, 9); // uç noktaya
    expect(distToBoundary(L, 10, 10)).toBeCloseTo(10, 9);
    expect(signedInsideDist(L, 10, 10)).toBeCloseTo(10, 9);
    expect(signedInsideDist(L, 30, 10)).toBeCloseTo(-10, 9);
    // girintiyi kesen segment: iki ucu içeride olsa da sınıra değer
    expect(segBoundaryDist(L, [10, 30], [30, 10])).toBe(0);
    expect(segBoundaryDist(L, [5, 30], [35, 30])).toBeCloseTo(5, 9); // x=40 kenarına 5 mm
  });

  it('içe offset: kare ve L alanı küçülür, köşe konumları doğru; dejenere boş döner', () => {
    const sq: Poly = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const o = offsetPoly(sq, 1);
    expect(polyBBox(o).map((v) => Math.round(v * 1e6) / 1e6)).toEqual([1, 1, 9, 9]);
    expect(polyArea(o)).toBeCloseTo(64, 9);
    expect(offsetPoly([...sq].reverse(), 1).length).toBe(4); // ters sarım
    expect(offsetPoly(sq, 6)).toEqual([]); // ters döndü
    const ol = offsetPoly(L, 2);
    expect(ol.length).toBe(6);
    expect(polyArea(ol)).toBeLessThan(1200);
    expect(pointInPoly(ol, 2.1, 2.1)).toBe(true);
    expect(pointInPoly(ol, 1.5, 1.5)).toBe(false);
    // dışa büyütme (negatif)
    expect(polyArea(offsetPoly(sq, -1))).toBeCloseTo(144, 9);
  });

  it('outlinePoly: poly yoksa w x h dikdörtgeni', () => {
    expect(outlinePoly({ w: 5, h: 3 })).toEqual([[0, 0], [5, 0], [5, 3], [0, 3]]);
    expect(outlinePoly({ w: 5, h: 3, poly: L })).toBe(L);
    expect(outlinePoly({ w: 5, h: 3, poly: [[0, 0], [1, 1]] }).length).toBe(4);
  });
});
