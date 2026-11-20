import { COMPONENTS } from '../../library/components';
import type { ComponentDef } from '../../library/types';
import type { PlacedComponent } from '../circuit/types';
import { formatSI } from '../units';
import { runTransient } from '../sim/mna';
import { ensureDesign } from '../pcb/design';
import { emcChecks, runDrc } from '../pcb/drc';
import { effectiveRth, thermalSpec } from '../thermal/thermal';
import { explainComponent, review } from './analysis';
import { baseResistor, divider, heatsink, ledResistor, mosfetRank, psuSize, rcTime, rippleCap, wireSize } from './calc';
import { generateSketch } from './codegen';
import { buildContext, num, type Ctx } from './context';
import { SRC, refOf, type Answer, type Block, type Calc } from './types';
import type { Circuit } from '../circuit/types';

export const QUICK_QUESTIONS: { label: string; q: string }[] = [
  { label: 'Devreyi incele', q: 'Devrede hata var mı? Güvenli çalışması için ne değiştirmeliyim?' },
  { label: 'Kaç amper çeker?', q: 'Bu devre kaç amper çeker?' },
  { label: 'Güç kaynağı yeterli mi?', q: 'Güç kaynağım yeterli mi?' },
  { label: 'Hangisi ısınıyor?', q: 'Hangi bileşen aşırı ısınıyor?' },
  { label: 'Seçili parça neden var?', q: 'Bu bileşen neden gerekli?' },
  { label: 'Röle diyotu neden?', q: 'Röle bobinine neden diyot bağlanır?' },
  { label: 'GPIO yükü sürer mi?', q: 'Mikrodenetleyici bu yükü doğrudan sürebilir mi?' },
  { label: 'Kondansatör uygun mu?', q: 'Kondansatörün değeri uygun mu?' },
  { label: 'MOSFET seç', q: 'Bu yük için hangi MOSFET’i seçmeliyim? 12 V 2 A, gate 5 V' },
  { label: 'LED direnci', q: 'LED için direnç hesapla 5 V 15 mA' },
  { label: 'Kablo kesiti', q: 'Hangi kablo kesitini kullanmalıyım? 5 A 2 m 12 V' },
  { label: 'Sonuçları yorumla', q: 'Simülasyon sonuçlarını yorumla' },
  { label: 'PCB incele', q: 'PCB tasarımını incele' },
  { label: 'Kod yaz', q: 'Bu devre için Arduino kodu yaz' },
  { label: 'Alternatif öner', q: 'Alternatif bir devre öner' },
];

const norm = (s: string) => s.toLocaleLowerCase('tr').replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c').replace(/[?!.,;:()]/g, ' ');

interface Qty { V?: number; A?: number; W?: number; m?: number; ohm?: number }
function quantities(q: string): Qty {
  const t = q.replace(',', '.').toLowerCase();
  const grab = (re: RegExp, mult = 1) => { const m = re.exec(t); return m ? Number(m[1]) * mult : undefined; };
  return {
    V: grab(/(\d+(?:\.\d+)?)\s*v(?:olt)?\b/),
    A: grab(/(\d+(?:\.\d+)?)\s*ma\b/, 1e-3) ?? grab(/(\d+(?:\.\d+)?)\s*a(?:mper)?\b/),
    W: grab(/(\d+(?:\.\d+)?)\s*w(?:att)?\b/),
    m: grab(/(\d+(?:\.\d+)?)\s*m(?:etre)?\b/),
    ohm: grab(/(\d+(?:\.\d+)?)\s*k\s*(?:ohm|ω)/, 1e3) ?? grab(/(\d+(?:\.\d+)?)\s*(?:ohm|ω)/),
  };
}

const p = (text: string): Block => ({ t: 'p', text });
const calc = (c: Calc): Block => ({ t: 'calc', calc: c });
const srcOf = (blocks: Block[], extra: string[] = []): string[] => [...new Set([...extra, ...blocks.flatMap((b) => (b.t === 'calc' ? b.calc.sources : []))])];
const mk = (intent: string, title: string, blocks: Block[], extra: string[] = []): Answer => ({ intent, title, blocks, sources: srcOf(blocks, extra) });

const supply = (ctx: Ctx) => ctx.byModel('vsource').filter((c) => ctx.results?.[c.id]);
const noSolution = (ctx: Ctx): Answer | null => (ctx.results ? null : mk('error', 'Devre çözülemedi', [{ t: 'warn', text: ctx.dcError ?? 'DC çözüm yok.' }, p('Önce toprak (GND) ekleyin ve kaynak kısa devrelerini giderin.')]));

function aCurrent(ctx: Ctx): Answer {
  const bad = noSolution(ctx); if (bad) return bad;
  const src = supply(ctx);
  if (!src.length) return mk('current', 'Devre akımı', [p('Devrede gerilim kaynağı yok; akım çeken kaynak bulunamadı.')]);
  const rows = src.map((c) => { const r = ctx.results![c.id]; return [refOf(c), formatSI(num(c, 'v'), 'V'), formatSI(r.i, 'A', 3), formatSI(-r.p, 'W', 3)]; });
  const total = src.reduce((a, c) => a + Math.max(ctx.results![c.id].i, 0), 0);
  const blocks: Block[] = [{ t: 'table', head: ['Kaynak', 'Gerilim', 'Verdiği akım', 'Verdiği güç'], rows }, p(`Toplam çekilen akım ≈ ${formatSI(total, 'A', 3)} (KCL: kaynak akımı, kollardan geçen akımların toplamına eşittir).`)];
  const top = ctx.circuit.components.filter((c) => !['vsource', 'ground'].includes(ctx.def(c).model) && ctx.results![c.id]).sort((a, b) => Math.abs(ctx.results![b.id].i) - Math.abs(ctx.results![a.id].i)).slice(0, 5);
  blocks.push({ t: 'table', head: ['Parça', 'Akım', 'Gerilim', 'Güç'], rows: top.map((c) => [refOf(c), formatSI(ctx.results![c.id].i, 'A', 3), formatSI(ctx.results![c.id].v, 'V', 3), formatSI(ctx.results![c.id].p, 'W', 3)]) });
  blocks.push({ t: 'warn', text: 'DC çalışma noktası: kondansatörler dolu/açık, bobinler kısa sayılır; AC/anahtarlamalı devrelerde ortalama ve tepe akımı için Çalıştır ile geçici analiz yapın.' });
  return mk('current', 'Bu devre ne kadar akım çeker?', blocks, [SRC.kcl, SRC.sim, SRC.power]);
}

function aPsu(ctx: Ctx): Answer {
  const bad = noSolution(ctx); if (bad) return bad;
  const src = supply(ctx);
  if (!src.length) return mk('psu', 'Güç kaynağı', [p('Devrede gerilim kaynağı yok.')]);
  const blocks: Block[] = [];
  for (const c of src) {
    const r = ctx.results![c.id], i = Math.max(r.i, 0), lim = num(c, 'ilimit', 0);
    blocks.push(calc(psuSize(num(c, 'v') || Math.abs(r.v), i, 1.25)));
    if (lim) blocks.push(p(`${refOf(c)}: ${formatSI(i, 'A', 3)} / ${formatSI(lim, 'A')} (%${((i / lim) * 100).toFixed(0)}) — ${i > lim ? 'AKIM LİMİTİ AŞILDI' : i > 0.8 * lim ? 'yükleme yüksek, pay az' : 'yeterli'}.`));
  }
  if (ctx.byModel('capacitor').length) blocks.push({ t: 'warn', text: 'Devrede kondansatör var: açılışta (inrush) kısa süreli yüksek akım çekilir; DC çözüm bunu göstermez.' });
  return mk('psu', 'Güç kaynağım yeterli mi?', blocks);
}

function aHot(ctx: Ctx, q: string): Answer {
  const bad = noSolution(ctx); if (bad) return bad;
  const amb = ctx.circuit.ambient ?? 25;
  const rows = Object.entries(ctx.thermal).filter(([, t]) => t.P > 1e-4).sort((a, b) => b[1].T - a[1].T).slice(0, 8);
  if (!rows.length) return mk('hot', 'Isınma', [p('Anlamlı güç harcayan (ısınan) parça yok.')], [SRC.thermal]);
  const blocks: Block[] = [{ t: 'table', head: ['Parça', 'Güç', 'Rθ (K/W)', 'Tj (kararlı hal)', 'Limit'], rows: rows.map(([id, t]) => [refOf(ctx.comp(id)), formatSI(t.P, 'W', 3), t.rth.toFixed(1), `${t.T.toFixed(0)} °C`, `${t.tjmax} °C`]) }];
  const [hid, h] = rows[0];
  const hc = ctx.comp(hid)!;
  const spec = thermalSpec(ctx.def(hc), hc);
  blocks.push(p(`En sıcak: ${refOf(hc)} — Tj ≈ ${h.T.toFixed(0)} °C (Tamb ${amb} °C). Rθ değerleri paket sınıfından yapılan TAHMİNDİR.`));
  const pwr = quantities(q).W ?? h.P;
  if (h.T > h.tjmax - 20 && spec) blocks.push(calc(heatsink(pwr, spec.tjmax, amb, spec.rthJC, 0.5)));
  else blocks.push(p('Hiçbir parça Tj limitine yaklaşmıyor.'));
  if (spec?.heatsinkable) blocks.push(p(`Mevcut Rθja,eff = ${effectiveRth(spec, hc).rth.toFixed(1)} K/W. Inspector → Isıl bölümünden soğutucu/fan ekleyip yeniden çözebilirsiniz.`));
  return mk('hot', 'Hangi bileşen ısınıyor?', blocks, [SRC.thermal, SRC.power]);
}

function aReview(ctx: Ctx): Answer {
  const f = review(ctx);
  const e = f.filter((x) => x.severity === 'error').length, w = f.filter((x) => x.severity === 'warning').length;
  const blocks: Block[] = [p(f.length ? `${e} hata, ${w} uyarı, ${f.length - e - w} bilgi bulundu.` : 'Kural tabanlı incelemede sorun bulunmadı. (Bu bir güvenlik onayı değildir: yalnızca modellenen kurallar kontrol edilir.)'), ...f.map((x): Block => ({ t: 'finding', f: x }))];
  return mk('review', 'Devre incelemesi', blocks, [SRC.sim, 'ERC kuralları', 'Tasarım kontrol kuralları (flyback, GPIO yükü, gate sürüşü, anma payları)']);
}

function findRef(ctx: Ctx, q: string): PlacedComponent | undefined {
  const m = [...q.matchAll(/\b([A-Za-z]{1,3}\d+)\b/g)].map((x) => x[1].toUpperCase());
  return ctx.circuit.components.find((c) => m.includes(c.ref.toUpperCase()));
}

function aWhy(ctx: Ctx, q: string, selId?: string): Answer {
  const c = findRef(ctx, q) ?? (selId ? ctx.comp(selId) : undefined);
  if (!c) return mk('why', 'Bileşen açıklaması', [p('Hangi bileşeni sorduğunuzu anlayamadım: sahnede bir parça seçin ya da referansını yazın (örn. “R2 neden gerekli?”).')]);
  return explainComponent(ctx, c);
}

function aRelayDiode(ctx: Ctx): Answer {
  const relay = ctx.byModel('relay')[0] ?? ctx.byModel('motor')[0];
  const l = relay ? (ctx.def(relay).model === 'relay' ? num(relay, 'lcoil') : num(relay, 'l')) : 0.15;
  const r = relay ? (ctx.def(relay).model === 'relay' ? num(relay, 'rcoil') : num(relay, 'r')) : 70;
  const v = Math.max(5, ...ctx.byModel('vsource').map((c) => Math.abs(num(c, 'v'))));
  const i = v / r, e = 0.5 * l * i * i;
  const blocks: Block[] = [
    p('Bobin akımı ani değişemez: v = L·di/dt. Anahtar açıldığında akım çok kısa sürede sıfırlanmaya çalışır ve bobin uçlarında büyük, ters yönlü bir gerilim darbesi oluşur; bu darbe transistörü/MOSFET’i veya kontağı (ark) bozar.'),
    calc({ title: 'Yaklaşık darbe', steps: [`Bobin: L = ${formatSI(l, 'H')}, R = ${formatSI(r, 'Ω')}, ${v} V’ta I = V/R = ${formatSI(i, 'A', 3)}`, `Depolanan enerji: E = ½·L·I² = ${formatSI(e, 'J', 3)}`, `Akım 1 µs’de kesilirse teorik v = L·di/dt = ${formatSI((l * i) / 1e-6, 'V', 3)} (gerçekte ark/parazit kapasite bu değeri sınırlar ama yüzlerce–binlerce volta çıkabilir)`, 'Çözüm: bobine ters yönde diyot (flyback): akım diyottan dolaşır, gerilim ≈ Vf’de kıskaçlanır.'], result: 'Katot +beslemeye, anot anahtar tarafına', sources: ['v = L·di/dt', 'E = ½LI²'] }),
    p('Diyot bobin akımının sönme süresini uzatır (röle bırakma gecikmesi biraz artar); hızlı bırakma gerekiyorsa diyoda seri zener kullanılır.'),
  ];
  if (relay) { const f = review(ctx).find((x) => x.id === `FLYBACK:${relay.id}`); blocks.push(f ? { t: 'finding', f } : p(`${refOf(relay)} için devrede flyback diyotu mevcut görünüyor.`)); }
  return mk('flyback', 'Röle bobinine neden diyot bağlanır?', blocks);
}

function aMcuDrive(ctx: Ctx, q: string): Answer {
  const boards = ctx.byModel('mcu');
  const spec = boards[0] ? ctx.def(boards[0]).mcu : undefined;
  const imax = spec?.imaxPin ?? 0.04, vcc = spec?.vcc ?? 3.3;
  const loads = ctx.circuit.components.filter((c) => ['motor', 'relay'].includes(ctx.def(c).model));
  const blocks: Block[] = [];
  const v = Math.max(...ctx.byModel('vsource').map((c) => Math.abs(num(c, 'v'))), quantities(q).V ?? 12);
  const rows = loads.map((c) => { const m = ctx.def(c).model; const i = m === 'relay' ? v / num(c, 'rcoil', 70) : v / num(c, 'r', 3); return [refOf(c), formatSI(i, 'A', 3), formatSI(imax, 'A'), i <= imax ? 'evet' : 'HAYIR']; });
  if (rows.length) blocks.push({ t: 'table', head: ['Yük', `Çekeceği akım (${v} V)`, 'GPIO sınırı', 'Doğrudan sürülür mü'], rows });
  else blocks.push(p(`Devrede röle/motor yok; genel kural: GPIO pini ${formatSI(imax, 'A')} (mutlak sınır, önerilen ≈ ${formatSI(imax / 2, 'A')}) üzerindeki yükleri sürmemeli.`));
  const iLoad = loads.length ? Math.max(...rows.map((r) => Number(ctx.circuit.components.find((c) => refOf(c) === r[0]) ? (ctx.def(loads.find((c) => refOf(c) === r[0])!).model === 'relay' ? v / num(loads.find((c) => refOf(c) === r[0])!, 'rcoil', 70) : v / num(loads.find((c) => refOf(c) === r[0])!, 'r', 3)) : 0))) : quantities(q).A ?? 1;
  blocks.push(p(`Sonuç: ${vcc} V mantıklı GPIO yükü doğrudan sürmez; yüksek akımlı yükleri transistör/MOSFET ile sürün.`));
  const rank = mosfetRank({ vsupply: v, iload: iLoad, vgs: vcc, inductive: true, polarity: 'n', tamb: ctx.circuit.ambient ?? 25 });
  blocks.push(calc(rank.calc));
  if (!rank.ranked.length) blocks.push(p(`Not: ${vcc} V gate sürüşüyle kütüphanedeki parçalar yeterli olmayabilir; mantık seviyeli MOSFET veya sürücü kullanın.`));
  return mk('mcu-drive', 'Mikrodenetleyici bu yükü sürebilir mi?', blocks, [SRC.library]);
}

function aCap(ctx: Ctx): Answer {
  const bad = noSolution(ctx); if (bad) return bad;
  const ac = ctx.byModel('vsource').find((c) => String(c.params.wave) !== 'dc' && num(c, 'freq') > 0);
  const caps = ctx.byModel('capacitor');
  const rect = ctx.circuit.components.some((c) => ['diode', 'bridge'].includes(ctx.def(c).model));
  const blocks: Block[] = [];
  if (ac && rect && caps.length) {
    const f = num(ac, 'freq');
    const kind = ctx.byModel('bridge').length ? 'tam dalga' : 'yarım dalga';
    try {
      const t = runTransient(ctx.circuit, { stop: 12 / f, dt: 1 / (f * 200) });
      const cap = caps[0], v = t.comps[cap.id].v.slice(Math.floor(t.comps[cap.id].v.length * 0.6));
      const pp = Math.max(...v) - Math.min(...v), mean = v.reduce((a, b) => a + b, 0) / v.length;
      const iAvg = Math.abs(t.comps[ctx.comp(cap.id)!.id].i.slice(-200).reduce((a, b) => a + Math.abs(b), 0) / 200);
      blocks.push(p(`Geçici analiz (12 periyot): ${refOf(cap)} üzerinde ortalama ${formatSI(mean, 'V', 3)}, ripple ${formatSI(pp, 'V', 3)} pp (%${((pp / Math.max(mean, 1e-9)) * 100).toFixed(1)}).`));
      const target = 0.05 * mean;
      const need = num(cap, 'c') * (pp / Math.max(target, 1e-9));
      blocks.push(calc(rippleCap(Math.max(mean / 1000, 1e-6), kind === 'tam dalga' ? 2 * f : f, Math.max(target, 1e-6), kind as 'yarım dalga')));
      blocks.push(p(pp > target ? `Ripple hedefin (%5) üstünde: kondansatörü yaklaşık ${formatSI(need, 'F', 2)} civarına büyütün (ripple ∝ 1/C).` : `Ripple %5 hedefinin altında: ${formatSI(num(cap, 'c'), 'F')} yeterli görünüyor. Gerilim anma değeri ≥ ${formatSI(Math.max(...v) * 1.5, 'V', 2)} olmalı (şu an ${formatSI(num(cap, 'vmax'), 'V')}).`));
      void iAvg;
    } catch (e) { blocks.push({ t: 'warn', text: `Geçici analiz yapılamadı: ${e instanceof Error ? e.message : e}` }); }
  } else {
    for (const c of caps.slice(0, 3)) {
      const rs = ctx.circuit.components.filter((x) => ctx.def(x).model === 'resistor' && [ '1', '2'].some((pin) => [ '1', '2'].some((pc) => ctx.net(x, pin) === ctx.net(c, pc) && ctx.net(c, pc) > 0)));
      if (rs[0]) blocks.push(calc(rcTime(num(rs[0], 'r'), num(c, 'c'))));
    }
    if (!blocks.length) blocks.push(p('Devrede değerlendirilecek kondansatör/RC bulunamadı. Genel kural: IC besleme pinlerine 100 nF seramik, güç hatlarına yük akımına göre 10–1000 µF elektrolitik.'));
  }
  return mk('cap', 'Kondansatörün değeri uygun mu?', blocks);
}

function aWire(ctx: Ctx, q: string): Answer {
  const x = quantities(q);
  const srcI = Math.max(0, ...supply(ctx).map((c) => Math.max(ctx.results![c.id].i, 0)));
  const i = x.A ?? (srcI > 0 ? srcI : 1), v = x.V ?? (Math.max(...ctx.byModel('vsource').map((c) => Math.abs(num(c, 'v')))) || 12);
  const blocks: Block[] = [calc(wireSize(i, x.m ?? 1, v, 3, 4)), { t: 'warn', text: 'İç kablolama için yaklaşık hesap. Şebeke (230 V) ve sabit tesisat için IEC 60364 / ulusal yönetmelik, uygun sigorta ve sertifikalı kablo gerekir; bunu bu simülasyondan tasarlamayın.' }];
  if (!x.A) blocks.unshift(p(`Akım belirtilmedi: devre simülasyonundan ${formatSI(i, 'A', 3)} kullanıldı (kaynak akımı).`));
  return mk('wire', 'Hangi kablo kesiti?', blocks);
}

function aMosfet(ctx: Ctx, q: string): Answer {
  const x = quantities(q);
  const m = ctx.byModel('nmos')[0] ?? ctx.byModel('pmos')[0];
  const r = m ? ctx.results?.[m.id] : undefined;
  const v = x.V ?? (Math.max(...ctx.byModel('vsource').map((c) => Math.abs(num(c, 'v'))), 0) || 12);
  const i = x.A ?? (r ? Math.abs(r.vals.id ?? 0) : 2) ?? 2;
  const gate = /gate\s*(\d+(?:[.,]\d+)?)/.exec(q.replace(',', '.').toLowerCase());
  const vgs = gate ? Number(gate[1]) : (r ? Math.abs(r.vals.vgs ?? 5) : 5);
  const rank = mosfetRank({ vsupply: v, iload: i || 2, vgs, inductive: ctx.circuit.components.some((c) => ['relay', 'motor', 'inductor'].includes(ctx.def(c).model)), polarity: m && ctx.def(m).model === 'pmos' ? 'p' : 'n', tamb: ctx.circuit.ambient ?? 25 });
  const blocks: Block[] = [calc(rank.calc)];
  if (rank.ranked.length) blocks.push({ t: 'table', head: ['Parça', 'RDS(on) (tahmini)', 'Kayıp', 'Tj (soğutucusuz)', 'Not'], rows: rank.ranked.slice(0, 5).map((c) => [c.def.name, formatSI(c.rds, 'Ω', 3), formatSI(c.loss, 'W', 3), `${c.tj.toFixed(0)} °C`, c.reasons.join('; ') || '—']) });
  if (rank.rejected.length) blocks.push({ t: 'list', items: rank.rejected.slice(0, 6).map((c) => `${c.def.name}: ${c.reasons[0]}`) });
  blocks.push({ t: 'warn', text: 'Kütüphane değerleri elle girilmiş tipik değerlerdir ve datasheet ile doğrulanmamıştır; seçimi gerçek datasheet (SOA, Qg, RDS(on)–VGS eğrisi) ile doğrulayın.' });
  return mk('mosfet', 'MOSFET seçimi', blocks, [SRC.library]);
}

function aResistor(ctx: Ctx, q: string): Answer {
  const x = quantities(q), n = norm(q);
  const vs = x.V ?? (Math.max(...ctx.byModel('vsource').map((c) => Math.abs(num(c, 'v'))), 0) || 5);
  const blocks: Block[] = [];
  if (n.includes('taban') || n.includes('transistor')) blocks.push(calc(baseResistor(x.A ?? 0.1, 200, x.V ?? 5)));
  else if (n.includes('bolucu')) blocks.push(calc(divider(vs, x.V && x.V < vs ? x.V : vs / 2, x.A ?? 0.001)));
  else {
    const led = ctx.byModel('led')[0];
    blocks.push(calc(ledResistor(vs, 2, x.A ?? (led ? 0.8 * num(led, 'ifmax', 0.02) : 0.015))));
  }
  return mk('resistor', 'Direnç hesabı', blocks);
}

function aInterpret(ctx: Ctx): Answer {
  const bad = noSolution(ctx); if (bad) return bad;
  const blocks: Block[] = [{ t: 'table', head: ['Düğüm', 'Gerilim'], rows: ctx.nets.names.map((nm, i) => [nm, formatSI(ctx.netPins(i).length ? ctx.v(ctx.netPins(i)[0].comp, ctx.netPins(i)[0].pin) : 0, 'V', 4)]) }];
  const parts = ctx.circuit.components.filter((c) => ctx.results![c.id] && ctx.def(c).model !== 'ground');
  blocks.push({ t: 'table', head: ['Parça', 'V', 'I', 'P'], rows: parts.map((c) => [refOf(c), formatSI(ctx.results![c.id].v, 'V', 3), formatSI(ctx.results![c.id].i, 'A', 3), formatSI(ctx.results![c.id].p, 'W', 3)]) });
  const pTot = parts.filter((c) => ctx.results![c.id].p > 0).reduce((a, c) => a + ctx.results![c.id].p, 0), pSrc = -parts.filter((c) => ctx.results![c.id].p < 0).reduce((a, c) => a + ctx.results![c.id].p, 0);
  blocks.push(p(`Güç dengesi: kaynaklardan ${formatSI(pSrc, 'W', 3)}, parçalarda harcanan ${formatSI(pTot, 'W', 3)} (fark gmin kaçağı ve yuvarlama).`));
  const f = review(ctx).filter((x) => x.severity !== 'info').slice(0, 5);
  if (f.length) blocks.push(p('Dikkat çeken noktalar:'), ...f.map((x): Block => ({ t: 'finding', f: x })));
  else blocks.push(p('Sınır aşımı veya kritik bulgu yok.'));
  return mk('interpret', 'Simülasyon sonuçları', blocks, [SRC.sim, SRC.kcl, SRC.power]);
}

function aPcb(ctx: Ctx): Answer {
  const c = ctx.circuit as Circuit;
  const d = ensureDesign(c);
  const issues = runDrc(c, d), emc = emcChecks(c, d);
  const blocks: Block[] = [p(`PCB: ${d.outline.w}×${d.outline.h} mm, ${Object.keys(d.placements).length} parça, ${d.tracks.length} iz, ${d.vias.length} via, ${d.zones.length} zone, ${d.rules.layers} katman.`)];
  const e = issues.filter((i) => i.severity === 'error');
  blocks.push(p(e.length ? `${e.length} DRC hatası, ${issues.filter((i) => i.severity === 'warning').length} uyarı.` : 'DRC hatası yok.'));
  blocks.push({ t: 'list', items: [...issues.slice(0, 8).map((i) => `[${i.code}] ${i.message}`), ...emc.slice(0, 5).map((i) => i.message)] });
  if (!d.tracks.length) blocks.push(p('Henüz iz yok: PCB sayfasında “Otomatik yönlendir” veya elle iz çizin.'));
  blocks.push({ t: 'warn', text: 'Footprint’ler genel şablonlardır; DRC yalnızca yerel kuralları denetler. Üretim öncesi üreticinin DFM kontrolü ve footprint’lerin datasheet ile doğrulanması gerekir.' });
  return mk('pcb', 'PCB incelemesi', blocks, ['IPC-2221', 'ElectroLab DRC (yerel kurallar)']);
}

const GLOSSARY: Record<string, string> = {
  vds: 'Drain–source dayanma gerilimi: anahtar kapalıyken dayanabileceği en yüksek gerilim; endüktif yüklerde 2× pay bırakın.',
  id: 'Sürekli drain akımı (kılıf sıcaklığına bağlı): gerçek kullanılabilir akım soğutmaya bağlıdır.',
  rds: 'RDS(on): iletimdeki direnç; P = I²·RDS(on). Belirtilen VGS’de ölçülür (örn. 10 V); düşük VGS’de çok daha yüksek olabilir.',
  vgs: 'VGS(th): iletimin başladığı eşik. Tam iletim için VGS ≫ VGS(th) gerekir; mantık seviyeli parçalarda 4.5/5 V’ta garanti verilir.',
  vf: 'Vf: ileri yön gerilim düşümü; P = Vf·If.',
  vceo: 'Vceo: baz açıkken kolektör–emitör dayanma gerilimi.',
  hfe: 'hFE (β): akım kazancı; geniş yayılımı vardır, tasarımda tipik değeri değil minimumu ve zorlanmış β ≈ 10’u kullanın.',
  ptot: 'Ptot: toplam güç kaybı sınırı (çoğu zaman kılıf 25 °C iken) — gerçek sınır soğutmaya bağlıdır.',
};

function aDatasheet(ctx: Ctx, q: string): Answer {
  const n = norm(q);
  const part: ComponentDef | undefined = COMPONENTS.find((c) => c.mpn && n.includes(norm(c.mpn))) ?? (() => { const c = findRef(ctx, q) ?? undefined; return c ? ctx.def(c) : undefined; })();
  const blocks: Block[] = [];
  if (part) {
    blocks.push(p(`${part.name}${part.manufacturer ? ` (${part.manufacturer})` : ''}${part.package ? ` — ${part.package}` : ''}: ${part.description}`));
    if (part.specs) blocks.push({ t: 'table', head: ['Özellik', 'Değer'], rows: Object.entries(part.specs) });
    blocks.push(p(`Simülasyon modeli: ${part.simNote ?? 'tam model'}. Eksik veri: ${part.missing.join(', ') || '—'}.`));
    if (part.datasheetUrl) blocks.push(p(`Datasheet arama bağlantısı: ${part.datasheetUrl}`));
  }
  const used = Object.entries(GLOSSARY).filter(([k]) => n.includes(k) || (part?.model?.includes('mos') && ['vds', 'id', 'rds', 'vgs'].includes(k)) || ((part?.model === 'npn' || part?.model === 'pnp') && ['vceo', 'hfe', 'ptot'].includes(k)) || (part?.model === 'diode' && k === 'vf'));
  if (used.length) blocks.push({ t: 'list', items: used.map(([, v]) => v) });
  if (!blocks.length) blocks.push(p('Hangi parçayı kastettiğinizi bulamadım. Model numarasını yazın (örn. “IRFZ44N datasheet açıkla”) veya sahnede bir parça seçin. PDF datasheet yükleme ve otomatik çıkarım henüz yok.'));
  blocks.push({ t: 'warn', text: 'Kütüphane değerleri datasheet ile doğrulanmamıştır; kritik tasarımlarda üreticinin güncel datasheet’ini kullanın.' });
  return mk('datasheet', 'Datasheet açıklaması', blocks, [SRC.library]);
}

function aCode(ctx: Ctx): Answer {
  const boards = ctx.byModel('mcu');
  if (!boards.length) return mk('code', 'Kod', [p('Devrede mikrodenetleyici kartı yok. Kütüphaneden Arduino Uno/Nano/Mega, ESP32 DevKit V1 veya Raspberry Pi Pico ekleyin, pinlere bağlantıları yapın, sonra tekrar sorun.')]);
  const blocks: Block[] = [];
  for (const b of boards) {
    const g = generateSketch(ctx, b);
    if (!g) { blocks.push(p(`${refOf(b)}: bağlı LED/sürücü/buton/analog giriş bulunamadı; önce pinlere bir yük veya giriş bağlayın.`)); continue; }
    blocks.push(p(`${refOf(b)} için bağlantılardan üretilen taslak:`), { t: 'list', items: g.notes }, { t: 'code', code: g.code, comp: b.id });
  }
  blocks.push({ t: 'warn', text: 'Kod Arduino C++ alt kümesindedir (ElectroLab yorumlayıcısında çalışır) ve gerçek derleyiciyle de derlenir. Üretilen taslağı kendi gereksinimlerinize göre uyarlayın.' });
  return mk('code', 'Kod önerisi', blocks, ['Devredeki gerçek pin bağlantıları']);
}

function aAlternatives(ctx: Ctx): Answer {
  const f = review(ctx).filter((x) => x.fix);
  if (!f.length) return mk('alternatives', 'Alternatif öneriler', [p('Kural tabanlı incelemede iyileştirme gerektiren bir nokta bulunamadı. Daha iyi verim/güvenlik için: IC’lere ayrıştırma kondansatörü, giriş koruması (TVS/diyot), sigorta ve test noktaları eklenebilir.')]);
  return mk('alternatives', 'Alternatif / iyileştirme önerileri', [{ t: 'list', items: f.map((x) => `${x.title} → ${x.fix}`) }], ['Tasarım kontrol kuralları']);
}

interface Intent { id: string; test: (n: string) => boolean; run: (ctx: Ctx, q: string, sel?: string) => Answer }
const has = (n: string, ...w: string[]) => w.some((x) => n.includes(x));
const INTENTS: Intent[] = [
  { id: 'flyback', test: (n) => has(n, 'role') && has(n, 'diyot', 'flyback', 'serbest'), run: (c) => aRelayDiode(c) },
  { id: 'code', test: (n) => has(n, 'kod', 'sketch', 'arduino', 'program yaz'), run: (c) => aCode(c) },
  { id: 'pcb', test: (n) => has(n, 'pcb', 'yerlesim', 'baski devre'), run: (c) => aPcb(c) },
  { id: 'wire', test: (n) => has(n, 'kablo', 'iletken kesit', 'kesit'), run: (c, q) => aWire(c, q) },
  { id: 'mosfet', test: (n) => has(n, 'mosfet') && has(n, 'sec', 'hangi', 'oner', 'uygun'), run: (c, q) => aMosfet(c, q) },
  { id: 'mcu-drive', test: (n) => has(n, 'esp32', 'arduino', 'gpio', 'mikrodenetleyici', 'pico') && has(n, 'dogrudan', 'surebilir', 'surer', 'surmek', 'yuk'), run: (c, q) => aMcuDrive(c, q) },
  { id: 'datasheet', test: (n) => has(n, 'datasheet', 'veri sayfasi', 'ne demek'), run: (c, q) => aDatasheet(c, q) },
  { id: 'resistor', test: (n) => has(n, 'direnc') && has(n, 'hesapla', 'kac ohm', 'degeri ne', 'secmeliyim'), run: (c, q) => aResistor(c, q) },
  { id: 'hot', test: (n) => has(n, 'isin', 'sicak', 'termal', 'sogutucu', 'heatsink'), run: (c, q) => aHot(c, q) },
  { id: 'psu', test: (n) => has(n, 'guc kaynagi', 'adaptor', 'besleme yeterli', 'yeterli mi'), run: (c) => aPsu(c) },
  { id: 'current', test: (n) => has(n, 'amper', 'akim ceker', 'toplam akim', 'ne kadar akim'), run: (c) => aCurrent(c) },
  { id: 'cap', test: (n) => has(n, 'kondansator') && has(n, 'deger', 'uygun', 'ripple', 'sec'), run: (c) => aCap(c) },
  { id: 'alternatives', test: (n) => has(n, 'alternatif', 'oner', 'iyilestir'), run: (c) => aAlternatives(c) },
  { id: 'why', test: (n) => has(n, 'neden', 'ne ise yarar', 'niye', 'gerekli'), run: (c, q, s) => aWhy(c, q, s) },
  { id: 'interpret', test: (n) => has(n, 'yorumla', 'sonuc', 'ne oluyor', 'acikla'), run: (c) => aInterpret(c) },
  { id: 'review', test: (n) => has(n, 'hata', 'yanlis', 'sorun', 'incele', 'kontrol', 'guvenli', 'degistirmeliyim', 'ariza'), run: (c) => aReview(c) },
];

export interface AskOptions { selection?: string }

/** Offline assistant: understands common Turkish engineering questions, answers from the real circuit/solver (no API key). */
export function answer(question: string, circuit: Circuit, opts: AskOptions = {}): Answer | null {
  const ctx = buildContext(circuit);
  const n = norm(question);
  const it = INTENTS.find((i) => i.test(n));
  return it ? it.run(ctx, question, opts.selection) : null;
}

export const UNSUPPORTED_HELP = 'Bu soruyu çevrimdışı motor tanımadı. Desteklenen konular: devre incelemesi/hatalar, akım ve güç kaynağı, ısınma/soğutucu, “bu parça neden var”, röle flyback diyotu, GPIO ile yük sürme, kondansatör/ripple, MOSFET seçimi, direnç hesabı, kablo kesiti, simülasyon yorumu, PCB incelemesi, datasheet açıklama, Arduino kodu, alternatif öneri. Yapay zekâ anahtarı girerseniz serbest sorular da cevaplanır.';

export { buildContext };
export type { Ctx };
