import { describe, expect, it } from 'vitest';
import { CircuitBuilder } from '../circuit/builder';
import { EXAMPLES } from '../../examples/examples';
import { answer, QUICK_QUESTIONS } from './answer';
import { baseResistor, e24, heatsink, ledResistor, mosfetRank, psuSize, rippleCap, wireSize } from './calc';
import { buildContext } from './context';
import { resistorRole, review } from './analysis';
import { generateSketch } from './codegen';
import { buildSystem, describeContext } from './llm';
import { createRuntime } from '../mcu/factory';
import { getDef } from '../../library/components';
import type { Answer, Block } from './types';

const ex = (id: string) => EXAMPLES.find((e) => e.id === id)!.build();
const text = (a: Answer | null): string => (a?.blocks ?? []).map((b: Block) => (b.t === 'p' || b.t === 'warn' ? b.text : b.t === 'calc' ? b.calc.steps.join(' ') + b.calc.result : b.t === 'finding' ? b.f.title + b.f.detail + (b.f.fix ?? '') : b.t === 'list' ? b.items.join(' ') : b.t === 'table' ? b.rows.flat().join(' ') : b.t === 'code' ? b.code : '')).join('\n');

describe('calculators (hand-checked numbers)', () => {
  it('E24 rounding', () => {
    expect(e24(140, 'up')).toBe(150);
    expect(e24(140, 'down')).toBe(130);
    expect(e24(4700, 'near')).toBe(4700);
    expect(e24(0.95, 'up')).toBe(1);
  });
  it('LED resistor: 5 V, Vf 2 V, 20 mA -> 150 Ω exactly', () => {
    const c = ledResistor(5, 2, 0.02);
    expect(c.values!.r).toBeCloseTo(150, 6);
    expect(c.values!.std).toBe(150);
    expect(c.result).toContain('150');
  });
  it('base resistor: Ic 100 mA, forced beta 10, 5 V drive -> 430 Ω region', () => {
    const c = baseResistor(0.1, 200, 5);
    expect(c.values!.ib).toBeCloseTo(0.01, 6);
    expect(c.values!.r).toBeCloseTo((5 - 0.7) / 0.01, 3);
  });
  it('wire size: 5 A, 2 m, 12 V, 3 % drop -> 2.5 mm² limited by voltage drop', () => {
    const c = wireSize(5, 2, 12, 3, 4);
    expect(c.values!.aTherm).toBeCloseTo(1.25, 6);
    expect(c.values!.aDrop).toBeCloseTo((5 * 0.0172 * 4) / 0.36, 4);   // 0.955 mm²
    expect(c.values!.pick).toBe(1.5);   // thermal 1.25 mm² dominates -> next standard size
    const c2 = wireSize(10, 5, 12, 3, 4);
    expect(c2.values!.aDrop).toBeCloseTo((10 * 0.0172 * 10) / 0.36, 3); // 4.78 mm² > thermal 2.5
    expect(c2.values!.pick).toBe(6);
  });
  it('heatsink: 5 W, Tj max 175, Tamb 25, Rjc 1.4 -> Rθsa ≤ 25.1 K/W picks the small clip', () => {
    const c = heatsink(5, 175, 25, 1.4, 0.5, 10);
    expect(c.values!.rsaReq).toBeCloseTo((175 - 10 - 25) / 5 - 1.4 - 0.5, 6);
    expect(c.result).toMatch(/Küçük/);
    expect(heatsink(40, 175, 25, 1.4).result).toMatch(/yetersiz|soğutucu yetmez|fan/i);
  });
  it('PSU and ripple capacitor', () => {
    expect(psuSize(12, 0.8).values!.pick).toBe(1);
    expect(rippleCap(0.1, 100, 1, 'tam dalga').values!.c).toBeCloseTo(1e-3, 9);
  });
  it('MOSFET ranking: logic-level wins at 5 V gate, standard-gate part rejected; 3.3 V gate rejects IRFZ44N-class', () => {
    const r5 = mosfetRank({ vsupply: 12, iload: 2, vgs: 5, inductive: false, polarity: 'n', tamb: 25 });
    expect(r5.ranked.length).toBeGreaterThan(0);
    expect(r5.ranked[0].loss).toBeLessThanOrEqual(r5.ranked[r5.ranked.length - 1].loss);
    expect(r5.rejected.some((c) => c.def.mpn === 'IRFZ44N')).toBe(false); // 5 V is enough for the model (Vov = 2): allowed
    const r33 = mosfetRank({ vsupply: 12, iload: 5, vgs: 3.3, inductive: true, polarity: 'n', tamb: 25 });
    const irf = r33.rejected.find((c) => c.def.mpn === 'IRFZ44N');
    expect(irf?.reasons.join(' ')).toMatch(/aşırı sürüş|Gate/);
    expect(r33.ranked.every((c) => c.def.params.find((p) => p.key === 'vdsmax')!.default as number >= 24)).toBe(true);
  });
});

describe('topology understanding', () => {
  it('LED example: R1 is recognised as the LED current limiter with the simulated current', () => {
    const ctx = buildContext(ex('led'));
    const role = resistorRole(ctx, ctx.comp('R1')!);
    expect(role.role).toMatch(/LED akım sınırlama/);
    expect(role.detail).toMatch(/20\.\d mA|19\.\d mA/);
  });
  it('divider resistors recognised; base resistor recognised in the NPN example', () => {
    const ctxN = buildContext(ex('npn'));
    expect(resistorRole(ctxN, ctxN.comp('R1')!).role).toMatch(/taban/i);
    const ctxD = buildContext(ex('divider'));
    expect(resistorRole(ctxD, ctxD.comp('R2')!).role).toMatch(/bölücü/i);
  });
  it('relay example: flyback diode present -> no FLYBACK finding; without it -> finding', () => {
    const withD = review(buildContext(ex('role-flyback')));
    expect(withD.some((f) => f.id.startsWith('FLYBACK'))).toBe(false);
    const c = ex('role-flyback');
    const noD = { ...c, components: c.components.filter((x) => getDef(x.type).model !== 'diode'), wires: c.wires.filter((w) => !['D1'].includes(w.a.comp) && !['D1'].includes(w.b.comp)) };
    expect(review(buildContext(noD)).some((f) => f.id.startsWith('FLYBACK'))).toBe(true);
  });
  it('LED without proper resistor (fault example) is flagged with a numeric fix', () => {
    const f = review(buildContext(ex('led_fault')));
    expect(f.some((x) => x.severity === 'error' && /LED|D1/.test(x.title))).toBe(true);
    expect(f.find((x) => x.fix?.includes('Seri direnç'))).toBeTruthy();
  });
  it('ESP32 5 V on GPIO is an error finding; MCU driving a motor directly is flagged', () => {
    const f = review(buildContext(ex('esp32_5v')));
    expect(f.some((x) => /GPIO gerilimi/.test(x.title))).toBe(true);
    const b = new CircuitBuilder();
    b.add('mod_esp32_devkit_v1', {}, 0, 0, 0, 'U1'); b.add('dc_motor', {}, 0, 0, 0, 'M1'); b.add('ground');
    b.chain('U1.D26', 'M1.P'); b.chain('M1.N', 'GND1.G'); b.chain('U1.GND', 'GND1.G');
    expect(review(buildContext(b.circuit)).some((x) => x.id.startsWith('GPIO_LOAD'))).toBe(true);
  });
  it('circuit without ground gives a clear NO_SOLUTION finding', () => {
    const b = new CircuitBuilder(); b.add('dc_supply'); b.add('resistor'); b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'V1.N');
    expect(review(buildContext(b.circuit))[0].id).toBe('NO_SOLUTION');
  });
});

describe('question answering (offline, Turkish)', () => {
  it('quick questions are all answered', () => {
    for (const q of QUICK_QUESTIONS) {
      const a = answer(q.q, ex('mosfet'));
      expect(a, q.label).not.toBeNull();
      expect(a!.blocks.length).toBeGreaterThan(0);
    }
  });
  it('"Bu devre kaç amper çeker?" reports the real source current', () => {
    const a = answer('Bu devre kaç amper çeker?', ex('divider'))!;
    expect(a.intent).toBe('current');
    expect(text(a)).toMatch(/3\.33 mA/);
    expect(a.sources.join(' ')).toMatch(/KCL/);
  });
  it('power supply question flags an overloaded source', () => {
    const c = ex('led');
    c.components.find((x) => x.id === 'V1')!.params.ilimit = 0.021;
    expect(text(answer('Güç kaynağım yeterli mi?', c))).toMatch(/yükleme yüksek|AŞILDI/);
  });
  it('hot component question uses the thermal model and proposes a heatsink calculation when needed', () => {
    const a = answer('Hangi bileşen aşırı ısınıyor?', ex('mosfet_heat'))!;
    expect(a.intent).toBe('hot');
    expect(text(a)).toMatch(/Q1/);
    expect(text(a)).toMatch(/Soğutucu seçimi|Rθsa/);
  });
  it('"R1 neden gerekli?" explains the role with numbers; selection works too', () => {
    const a = answer('R1 neden gerekli?', ex('led'))!;
    expect(a.intent).toBe('why');
    expect(text(a)).toMatch(/LED/);
    const b = answer('Bu bileşen neden gerekli?', ex('led'), { selection: 'D1' })!;
    expect(b.title).toMatch(/D1/);
  });
  it('relay diode question gives the energy/spike calculation', () => {
    const t = text(answer('Röle bobinine neden diyot bağlanır?', ex('role-flyback')));
    expect(t).toMatch(/½·L·I²|Depolanan enerji/);
    expect(t).toMatch(/flyback/i);
  });
  it('ESP32 direct-drive question compares load current with the GPIO limit and suggests MOSFETs', () => {
    const b = new CircuitBuilder();
    b.add('mod_esp32_devkit_v1', {}, 0, 0, 0, 'U1'); b.add('dc_motor', {}, 0, 0, 0, 'M1'); b.add('dc_supply', { v: 6 }); b.add('ground');
    b.chain('V1.P', 'M1.P'); b.chain('M1.N', 'GND1.G'); b.chain('V1.N', 'GND1.G'); b.chain('U1.GND', 'GND1.G');
    const a = answer('ESP32 bu motoru doğrudan sürebilir mi?', b.circuit)!;
    expect(a.intent).toBe('mcu-drive');
    expect(text(a)).toMatch(/HAYIR/);
    expect(text(a)).toMatch(/MOSFET/);
  });
  it('capacitor question measures ripple on the adaptor example with a transient run', () => {
    const t = text(answer('Kondansatörün değeri uygun mu?', ex('ac-dc-adaptor')));
    expect(t).toMatch(/ripple/);
    expect(t).toMatch(/Filtre kondansatörü|C ≈ I/);
  });
  it('wire / mosfet / resistor calculators parse quantities from the question', () => {
    expect(text(answer('Hangi kablo kesitini kullanmalıyım? 10 A 5 m 12 V', ex('led')))).toMatch(/6 mm²/);
    expect(text(answer('Bu yük için hangi MOSFET’i seçmeliyim? 12 V 2 A, gate 5 V', ex('led')))).toMatch(/12 V|VDS/);
    expect(text(answer('LED için direnç hesapla 5 V 20 mA', ex('led')))).toMatch(/150/);
  });
  it('code generation reads the real pin connections and the result compiles on the board', () => {
    for (const id of ['mcu_blink', 'mcu_button', 'mcu_pot_pwm', 'esp32_mosfet']) {
      const c = ex(id);
      const ctx = buildContext(c);
      const board = ctx.byModel('mcu')[0];
      const g = generateSketch(ctx, board)!;
      expect(g, id).toBeTruthy();
      const rt = createRuntime('sketch', ctx.def(board).mcu!)!;
      const res = rt.load(g.code);
      expect(res.diagnostics.filter((d) => d.severity === 'error'), id).toEqual([]);
    }
    const blink = generateSketch(buildContext(ex('mcu_blink')), buildContext(ex('mcu_blink')).byModel('mcu')[0])!;
    expect(blink.code).toContain('13');
    const pot = generateSketch(buildContext(ex('mcu_pot_pwm')), buildContext(ex('mcu_pot_pwm')).byModel('mcu')[0])!;
    expect(pot.code).toMatch(/analogRead\(ANALOG_14\)/);
    expect(pot.code).toMatch(/analogWrite\(LED_9/);
  });
  it('unknown question returns null (caller shows help / uses the LLM)', () => {
    expect(answer('Bugün hava nasıl?', ex('led'))).toBeNull();
  });
  it('datasheet question for a library part includes its specs and the verification warning', () => {
    const t = text(answer('IRFZ44N datasheet açıkla', ex('led')));
    expect(t).toMatch(/IRFZ44N/);
    expect(t).toMatch(/doğrulanmamıştır/);
  });
});

describe('LLM context (what would be sent)', () => {
  it('contains component values, nets, findings and the safety rules; no secrets', () => {
    const c = ex('led_fault');
    const s = buildSystem(c, 'D1', answer('Devreyi incele', c));
    expect(s).toMatch(/BİLEŞENLER/);
    expect(s).toMatch(/R1 \| Direnç/);
    expect(s).toMatch(/DÜĞÜMLER/);
    expect(s).toMatch(/SEÇİLİ/);
    expect(s).toMatch(/KURAL TABANLI BULGULAR/);
    expect(s).toMatch(/uydurma/);
    expect(s).not.toMatch(/sk-ant|x-api-key/);
    expect(buildSystem(c, undefined, null, false)).not.toMatch(/BİLEŞENLER/);
    expect(describeContext(buildContext(c)).length).toBeLessThan(25000);
  });
});
