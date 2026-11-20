import type { PlacedComponent } from '../circuit/types';
import { formatSI } from '../units';
import { CLASS_LABEL, thermalClass } from '../thermal/thermal';
import { ledResistor, mosfetRank } from './calc';
import { num, type Ctx } from './context';
import { SRC, refOf, type Answer, type Block, type Finding } from './types';

/** Topology helpers --------------------------------------------------------------------------------------------- */

/** other parts (optionally filtered by model) touching the same net as comp.pin */
export function touching(ctx: Ctx, c: PlacedComponent, pin: string, models?: string[]): { comp: PlacedComponent; pin: string }[] {
  const n = ctx.net(c, pin);
  return ctx.netPins(n).filter((p) => p.comp.id !== c.id && (!models || models.includes(ctx.def(p.comp).model)));
}

const SWITCHES = ['npn', 'pnp', 'nmos', 'pmos', 'switch', 'relay', 'eload'];
const INDUCTIVE = ['relay', 'motor', 'inductor'];
const coilPins = (m: string): [string, string] => (m === 'relay' ? ['C1', 'C2'] : m === 'motor' ? ['P', 'N'] : ['1', '2']);

export interface Role { role: string; detail: string }

/** What is this resistor doing in the circuit? (topology + simulated numbers) */
export function resistorRole(ctx: Ctx, c: PlacedComponent): Role {
  const r = ctx.results?.[c.id];
  const a = '1', b = '2';
  const side = (pin: string) => touching(ctx, c, pin);
  const has = (pin: string, model: string, pins?: string[]) => side(pin).filter((p) => ctx.def(p.comp).model === model && (!pins || pins.includes(p.pin)));
  for (const pin of [a, b]) {
    const led = has(pin, 'led')[0];
    if (led) {
      const i = r ? Math.abs(r.i) : 0;
      return { role: 'LED akım sınırlama direnci', detail: `${refOf(led.comp)} LED’ine seri bağlı. LED ideal bir gerilim kaynağı gibi davranır (Vf ≈ 2 V); akımı yalnızca bu direnç sınırlar. Şu an ${formatSI(i, 'A', 3)} akıyor${led.comp ? ` (LED sınırı ${formatSI(num(led.comp, 'ifmax'), 'A')})` : ''}.` };
    }
    const bjt = [...has(pin, 'npn', ['B']), ...has(pin, 'pnp', ['B'])][0];
    if (bjt) return { role: 'Transistör taban direnci', detail: `${refOf(bjt.comp)} transistörünün tabanına seri. Taban akımını Ib = (Vsürücü − Vbe)/Rb ile sınırlar; transistörü doyuma sürecek kadar akım vermeli ama sürücü pinini ve jonksiyonu aşırı yüklememeli. Şu an ${r ? formatSI(Math.abs(r.i), 'A', 3) : '?'}.` };
    const mos = [...has(pin, 'nmos', ['G']), ...has(pin, 'pmos', ['G'])][0];
    if (mos) {
      const other = pin === a ? b : a;
      const otherNet = ctx.net(c, other);
      const toGroundOrSource = otherNet === 0 || ctx.netPins(otherNet).some((p) => p.comp.id === mos.comp.id && p.pin === 'S');
      return toGroundOrSource
        ? { role: 'Gate pull-down direnci', detail: `${refOf(mos.comp)} gate’ini source/toprağa bağlar. Sürücü pini yüksek empedansta (reset, açılış) iken gate’in yüzmesini ve MOSFET’in kendiliğinden iletime geçmesini önler.` }
        : { role: 'Gate seri direnci', detail: `${refOf(mos.comp)} gate’ine seri. Gate kapasitesinin yükleme akımını (tepe sürücü akımı) ve anahtarlama zil/aşırı gerilimini sınırlar; sürücü pinini korur.` };
    }
  }
  const vsrc = (pin: string) => side(pin).some((p) => ['vsource'].includes(ctx.def(p.comp).model) && p.pin === 'P');
  const gnd = (pin: string) => ctx.net(c, pin) === 0;
  if ((vsrc(a) || vsrc(b)) && !(gnd(a) || gnd(b))) {
    const other = vsrc(a) ? b : a;
    if (touching(ctx, c, other, ['switch', 'npn', 'nmos']).length) return { role: 'Pull-up direnci', detail: 'Pozitif besleme ile bir giriş/anahtar düğümü arasında; anahtar açıkken düğümü yüksek seviyeye çeker (floating girişi önler).' };
  }
  if (gnd(a) || gnd(b)) {
    const other = gnd(a) ? b : a;
    const mates = touching(ctx, c, other, ['resistor', 'pot']);
    if (mates.length) return { role: 'Gerilim bölücünün alt direnci', detail: `${mates.map((m) => refOf(m.comp)).join(', ')} ile gerilim bölücü oluşturur: Vout = Vin·R_alt/(R_üst+R_alt); orta nokta ${formatSI(ctx.v(c, other), 'V', 3)}.` };
    if (touching(ctx, c, other, ['mcu']).length) return { role: 'Pull-down / yük direnci', detail: 'Mikrodenetleyici pinini toprağa bağlar; pin yüksek empedansta iken seviyeyi LOW’da tutar. Çıkışta ise pine yük olarak biner.' };
  }
  const chain = [a, b].flatMap((p) => touching(ctx, c, p, ['resistor']));
  if (chain.length) return { role: 'Seri direnç / bölücü elemanı', detail: `${chain.map((m) => refOf(m.comp)).join(', ')} ile seri; toplam direnç ve gerilim paylaşımını belirler.` };
  return { role: 'Yük / seri direnç', detail: `Akımı ${r ? formatSI(Math.abs(r.i), 'A', 3) : '?'} olarak sınırlar; üzerinde ${r ? formatSI(Math.abs(r.v), 'V', 3) : '?'} düşer.` };
}

export function capacitorRole(ctx: Ctx, c: PlacedComponent): Role {
  const a = '1', b = '2';
  const ground = ctx.net(c, a) === 0 || ctx.net(c, b) === 0;
  const near = [a, b].flatMap((p) => touching(ctx, c, p));
  const hasIc = near.some((p) => ['none', 'mcu'].includes(ctx.def(p.comp).model));
  const hasDiode = near.some((p) => ['diode', 'bridge'].includes(ctx.def(p.comp).model));
  if (hasIc && ground) return { role: 'Besleme ayrıştırma (decoupling) kondansatörü', detail: 'IC besleme pinine yakın kısa akım darbelerini karşılar, besleme hattındaki gürültü ve dalgalanmayı (ripple) bastırır. Genelde 100 nF seramik, IC’ye en yakın konumda.' };
  if (hasDiode && ground) return { role: 'Doğrultucu filtre (düzgünleştirme) kondansatörü', detail: 'Diyot/köprü çıkışındaki darbeli gerilimi depolayıp yük akımını diyotlar iletmediğinde sağlar; ripple ≈ I/(f·C).' };
  if (!ground) return { role: 'Kuplaj / zamanlama kondansatörü', detail: 'İki düğüm arasında DC’yi bloklar, AC’yi geçirir (kuplaj) ya da R ile birlikte zaman sabiti (τ = R·C) belirler.' };
  return { role: 'Enerji depolama / filtre', detail: 'Toprağa bağlı kondansatör: gerilim değişimlerini yavaşlatır (alçak geçiren / depolama).' };
}

/** Review rules ------------------------------------------------------------------------------------------------- */

export function review(ctx: Ctx): Finding[] {
  const out: Finding[] = [];
  const add = (f: Finding) => out.push(f);
  const res = ctx.results;
  if (!res) {
    add({ id: 'NO_SOLUTION', severity: 'error', title: 'Devre çözülemedi', detail: ctx.dcError ?? 'DC çözüm yok', fix: 'Toprak (GND) ekleyin, kaynak kısa devrelerini ve kaynak döngülerini giderin.', comps: [] });
    return out;
  }
  const vmax = Math.max(0, ...ctx.byModel('vsource').map((c) => Math.abs(num(c, 'v'))));

  for (const s of ctx.stress) {
    const c = ctx.comp(s.comp);
    if (!c) continue;
    const def = ctx.def(c);
    let fix: string | undefined;
    if (def.model === 'led' && s.label.includes('akım') && vmax > 0) fix = `Seri direnç ≥ ${formatSI(ledResistor(vmax, 2, 0.8 * num(c, 'ifmax', 0.02)).values!.std, 'Ω')} (${ledResistor(vmax, 2, 0.8 * num(c, 'ifmax', 0.02)).result})`;
    else if (def.model === 'resistor') fix = `Anma gücü ≥ ${formatSI(Math.max(Math.abs(res[c.id].p) * 2, 0.25), 'W')} olan direnç kullanın veya direnci büyütün.`;
    else if (def.model === 'mcu') fix = 'GPIO’yu transistör/MOSFET ile tamponlayın; 5 V sinyali bölücü/seviye dönüştürücü ile 3.3 V’a indirin.';
    else if (def.model === 'capacitor' || def.type === 'capacitor_el') fix = 'Anma gerilimi çalışma geriliminin ≥ 1.5 katı olan kondansatör seçin; polariteyi kontrol edin.';
    add({ id: `STRESS:${s.key}`, severity: s.ratio >= 1.5 ? 'error' : 'warning', title: `${s.ref}: ${s.label} aşıldı`, detail: `${s.value.toPrecision(3)} ${s.unit}, sınır ${s.limit} ${s.unit} (${s.ratio.toFixed(1)}×).${s.note ? ' ' + s.note : ''}`, fix, comps: [c.id] });
  }

  // inductive loads without flyback diode
  for (const c of ctx.circuit.components) {
    const m = ctx.def(c).model;
    if (!INDUCTIVE.includes(m)) continue;
    const [p1, p2] = coilPins(m);
    const n1 = ctx.net(c, p1), n2 = ctx.net(c, p2);
    const switched = [n1, n2].some((n) => ctx.netPins(n).some((p) => p.comp.id !== c.id && SWITCHES.includes(ctx.def(p.comp).model)));
    const diode = ctx.netPins(n1).some((p) => ['diode', 'zener'].includes(ctx.def(p.comp).model) && ctx.netPins(n2).some((q) => q.comp.id === p.comp.id));
    if (switched && !diode) add({ id: `FLYBACK:${c.id}`, severity: 'warning', title: `${c.ref}: serbest dönüş (flyback) diyotu yok`, detail: 'Endüktif yük anahtar açılınca akımı aniden kesemez: v = L·di/dt çok yüksek bir gerilim darbesi üretir ve anahtarı (MOSFET/transistör/kontak) bozabilir.', fix: `${c.ref} uçlarına ters yönde bir diyot bağlayın (katot + beslemeye, anot anahtar tarafına). Hızlı sönüm için diyota seri zener veya RC snubber kullanılabilir.`, comps: [c.id] });
  }

  // GPIO drives relays/motors directly
  for (const b of ctx.byModel('mcu')) {
    const spec = ctx.def(b).mcu!;
    for (const pin of Object.values(spec.pinMap)) {
      const loads = touching(ctx, b, pin, ['relay', 'motor']);
      if (loads.length) add({ id: `GPIO_LOAD:${b.id}:${pin}`, severity: 'error', title: `${b.ref}.${pin}: ${refOf(loads[0].comp)} doğrudan GPIO’ya bağlı`, detail: `GPIO pini en çok ${formatSI(spec.imaxPin, 'A')} (mutlak sınır) verebilir; röle bobini/motor çok daha fazla akım çeker.`, fix: 'Bir NPN transistör veya mantık seviyeli N-MOSFET ile sürün (+ flyback diyotu).', comps: [b.id, loads[0].comp.id] });
    }
  }

  for (const c of ctx.circuit.components) {
    const def = ctx.def(c), r = res[c.id];
    if (!r) continue;
    if (def.model === 'led') {
      const guard = [...touching(ctx, c, 'A'), ...touching(ctx, c, 'K')].some((p) => ['resistor', 'npn', 'pnp', 'nmos', 'pmos', 'isource', 'eload', 'mcu'].includes(ctx.def(p.comp).model));
      if (!guard) add({ id: `LED_R:${c.id}`, severity: 'warning', title: `${c.ref}: LED’e seri akım sınırlama elemanı görünmüyor`, detail: 'LED gerilimle değil akımla sürülür; seri direnç yoksa akım kaynağın iç direncine kalır.', fix: 'Seri direnç ekleyin: R = (Vkaynak − Vf)/If.', comps: [c.id] });
    }
    if (def.model === 'nmos' || def.model === 'pmos') {
      const gate = touching(ctx, c, 'G');
      if (gate.length && gate.every((p) => ['mcu', 'vsource'].includes(ctx.def(p.comp).model)) && !gate.some((p) => ctx.def(p.comp).model === 'resistor')) add({ id: `GATE:${c.id}`, severity: 'info', title: `${c.ref}: gate’te pull-down / seri direnç yok`, detail: 'Sürücü reset’te veya yüksek empedansta iken gate yüzer; MOSFET kendiliğinden iletime geçebilir. Seri direnç de sürücünün tepe akımını sınırlar.', fix: 'Gate–source arasına 10 kΩ pull-down, sürücü ile gate arasına 47–220 Ω seri direnç ekleyin.', comps: [c.id] });
      const vgs = Math.abs(r.vals.vgs ?? 0), vth = num(c, 'vth', 2), id = Math.abs(r.vals.id ?? 0), vds = Math.abs(r.vals.vds ?? 0);
      if (id > 0.01 && vgs > vth && vds > 0.5 && Math.abs(r.p) > 0.5) {
        const cand = mosfetRank({ vsupply: Math.max(vmax, vds), iload: id, vgs, inductive: false, polarity: def.model === 'nmos' ? 'n' : 'p', tamb: ctx.circuit.ambient ?? 25 });
        add({ id: `GATE_DRIVE:${c.id}`, severity: 'warning', title: `${c.ref}: tam iletimde değil (VDS = ${vds.toFixed(2)} V, ${formatSI(Math.abs(r.p), 'W', 3)} ısınıyor)`, detail: `VGS = ${vgs.toFixed(2)} V, VGS(th) ≈ ${vth} V: yeterli aşırı sürüş (VGS − VGS(th)) yok, MOSFET doyuma/lineer bölgeye sıkışıyor.`, fix: `Gate gerilimini artırın veya mantık seviyeli parça kullanın${cand.ranked.length ? ` (örn. ${cand.ranked[0].def.name})` : ''}.`, comps: [c.id] });
      }
    }
    if (def.model === 'resistor') {
      const pm = num(c, 'pmax', 0), ratio = pm ? Math.abs(r.p) / pm : 0;
      if (ratio > 0.5 && ratio <= 1) add({ id: `RPOW:${c.id}`, severity: 'warning', title: `${c.ref}: güç payı düşük (%${(ratio * 100).toFixed(0)})`, detail: `${formatSI(Math.abs(r.p), 'W', 3)} / ${formatSI(pm, 'W')}. Kalıcı çalışmada anma gücünün ≤ %50’si önerilir.`, fix: `≥ ${formatSI(Math.abs(r.p) * 2, 'W')} anma gücü seçin.`, comps: [c.id] });
    }
    if (def.model === 'capacitor') {
      const vm = num(c, 'vmax', 0), ratio = vm ? Math.abs(r.v) / vm : 0;
      if (ratio > 0.8 && ratio <= 1) add({ id: `CVOLT:${c.id}`, severity: 'warning', title: `${c.ref}: gerilim payı düşük (%${(ratio * 100).toFixed(0)})`, detail: 'Kondansatör anma geriliminin %80’inden fazlasında çalışıyor; ömür ve güvenilirlik düşer.', fix: 'Anma gerilimi ≥ 1.5× çalışma gerilimi olan parça seçin.', comps: [c.id] });
    }
    if (def.model === 'vsource') {
      const lim = num(c, 'ilimit', 0), ratio = lim ? Math.abs(r.i) / lim : 0;
      if (ratio > 0.8 && ratio <= 1) add({ id: `PSU:${c.id}`, severity: 'warning', title: `${c.ref}: kaynak yüklemesi %${(ratio * 100).toFixed(0)}`, detail: `${formatSI(Math.abs(r.i), 'A', 3)} / ${formatSI(lim, 'A')}`, fix: 'Daha yüksek akım kapasiteli güç kaynağı seçin (en az %25 pay).', comps: [c.id] });
    }
    const th = ctx.thermal[c.id];
    if (th && th.P > 1e-3) {
      const cls = thermalClass(th.T, ctx.circuit.ambient ?? 25, th.tjmax);
      if (cls === 'critical' || cls === 'damage' || cls === 'high') add({ id: `HEAT:${c.id}`, severity: cls === 'high' ? 'warning' : 'error', title: `${c.ref}: ısıl durum "${CLASS_LABEL[cls]}" (Tj ≈ ${th.T.toFixed(0)} °C / ${th.tjmax} °C)`, detail: `Güç kaybı ${formatSI(th.P, 'W', 3)}, Rθ ≈ ${th.rth.toFixed(0)} K/W (tahmini).`, fix: 'Soğutucu/fan ekleyin, güç kaybını azaltın veya daha uygun parça seçin.', comps: [c.id] });
    }
    if (def.model === 'none' && def.category === 'ic') {
      const supplyNets = def.pins.filter((p) => /vcc|vdd|v\+|vin/i.test(p.label)).map((p) => ctx.net(c, p.id)).filter((n) => n > 0);
      if (supplyNets.length && !supplyNets.some((n) => ctx.netPins(n).some((p) => ctx.def(p.comp).model === 'capacitor'))) add({ id: `DECOUP:${c.id}`, severity: 'info', title: `${c.ref}: besleme ayrıştırma kondansatörü yok`, detail: 'IC besleme pinine yakın 100 nF seramik kondansatör önerilir.', fix: `${c.ref} VCC–GND arasına 100 nF ekleyin.`, comps: [c.id] });
    }
  }

  for (const i of ctx.erc) if (i.severity !== 'info' && !['OVERLAP'].includes(i.code)) add({ id: `ERC:${i.code}:${i.comp ?? ''}:${i.pin ?? ''}`, severity: i.severity, title: i.message, detail: 'Elektriksel kural kontrolü (ERC) bulgusu.', comps: i.comp ? [i.comp] : [] });
  const none = ctx.circuit.components.filter((c) => ctx.def(c).model === 'none');
  if (none.length) add({ id: 'NOMODEL', severity: 'info', title: `${none.length} parçanın elektriksel modeli yok`, detail: `${none.map((c) => c.ref).join(', ')} simülasyonda açık devre sayılır: sonuçlar bu parçaların etkisini içermez.`, comps: none.map((c) => c.id) });
  const order = { error: 0, warning: 1, info: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

/** Why is this component in the circuit? -------------------------------------------------------------------------- */

export function explainComponent(ctx: Ctx, c: PlacedComponent): Answer {
  const def = ctx.def(c), r = ctx.results?.[c.id];
  const blocks: Block[] = [];
  let role: Role | null = null;
  if (def.model === 'resistor' || def.model === 'pot') role = resistorRole(ctx, c);
  else if (def.model === 'capacitor') role = capacitorRole(ctx, c);
  else if (def.model === 'diode' || def.model === 'zener') {
    const coil = ctx.circuit.components.find((x) => INDUCTIVE.includes(ctx.def(x).model) && [coilPins(ctx.def(x).model)[0], coilPins(ctx.def(x).model)[1]].every((p) => ctx.net(x, p) >= 0 && ctx.netPins(ctx.net(x, p)).some((q) => q.comp.id === c.id)));
    role = coil ? { role: 'Serbest dönüş (flyback) diyotu', detail: `${refOf(coil)} bobininin uçlarına ters yönde bağlı: anahtar açılınca bobin akımına bir yol sunar, böylece L·di/dt gerilim darbesi anahtarı yakmaz (diyot gerilimi ≈ Vf’ye kıskaçlar).` } : { role: def.model === 'zener' ? 'Gerilim kıskacı / referans' : 'Tek yönlü iletim (doğrultma / koruma)', detail: 'Akımı yalnızca bir yönde geçirir; ters polarite ve doğrultma için kullanılır.' };
  } else if (def.model === 'nmos' || def.model === 'pmos') {
    role = { role: 'Anahtar (yük sürücü)', detail: `Gate gerilimiyle kontrol edilen ${def.model === 'nmos' ? 'düşük taraf' : 'yüksek taraf'} anahtar. Neden MOSFET: gate akım çekmez (yalnızca kapasitesini şarj eder), düşük RDS(on) ile az ısınır ve küçük bir sürücü pini büyük akımı kontrol eder. ${r ? `Şu an VGS = ${(r.vals.vgs ?? 0).toFixed(2)} V, VDS = ${(r.vals.vds ?? 0).toFixed(3)} V, ID = ${formatSI(r.vals.id ?? 0, 'A', 3)}, kayıp ${formatSI(Math.abs(r.p), 'W', 3)}.` : ''}` };
  } else if (def.model === 'npn' || def.model === 'pnp') {
    role = { role: 'Akımla kontrol edilen anahtar / yükselteç', detail: `Taban akımı Ib küçük, kolektör akımı Ic ≈ β·Ib (aktif) veya doyumda Vce ≈ 0.1–0.2 V. ${r ? `Şu an Ic = ${formatSI(r.vals.ic ?? 0, 'A', 3)}, Ib = ${formatSI(r.vals.ib ?? 0, 'A', 3)}, Vce = ${(r.vals.vce ?? 0).toFixed(3)} V.` : ''}` };
  } else if (def.model === 'led') role = { role: 'Gösterge', detail: 'Ileri akımla orantılı ışık verir; mutlaka akım sınırlama direnciyle kullanılır.' };
  else if (def.model === 'relay') role = { role: 'Galvanik ayrık anahtar', detail: 'Küçük bobin akımıyla yüksek akım/gerilim kontağını ayrık devrede anahtarlar. Bobin endüktif olduğundan flyback diyotu gerekir; kontak akım sınırı aşılmamalı.' };
  else if (def.model === 'mcu') role = { role: 'Mikrodenetleyici', detail: 'GPIO’lar sınırlı akım verir (bkz. kart sınırları); yükleri transistör/MOSFET ile sürün, giriş seviyelerine (3.3/5 V) dikkat edin.' };
  else role = { role: def.name, detail: def.description };
  blocks.push({ t: 'p', text: `${c.ref} — ${def.name}: ${role.role}` });
  blocks.push({ t: 'p', text: role.detail });
  if (r) blocks.push({ t: 'p', text: `Simülasyon: V = ${formatSI(r.v, 'V', 3)}, I = ${formatSI(r.i, 'A', 3)}, P = ${formatSI(r.p, 'W', 3)}.` });
  return { intent: 'why', title: `${c.ref} neden var?`, blocks, sources: [SRC.sim, SRC.ohm] };
}
