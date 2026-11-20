import type { PlacedComponent } from '../circuit/types';
import { touching } from './analysis';
import type { Ctx } from './context';
import { refOf } from './types';

interface PinUse { id: string; num: number; name: string; kind: 'led' | 'driver' | 'button' | 'analog'; note: string }

/** Reads how the board's pins are wired in the circuit and writes a matching Arduino-subset sketch (pin numbers from the real connections). */
export function generateSketch(ctx: Ctx, board: PlacedComponent): { code: string; notes: string[]; uses: PinUse[] } | null {
  const def = ctx.def(board);
  const spec = def.mcu;
  if (!spec) return null;
  const numOf = new Map(Object.entries(spec.pinMap).map(([n, id]) => [id, Number(n)]));
  const gndNets = new Set(spec.gnd.map((g) => ctx.net(board, g)));
  const analogName = (n: number) => Object.entries(spec.constants).find(([k, v]) => v === n && /^A\d+$/.test(k))?.[0];
  const uses: PinUse[] = [];
  for (const [pinId, n] of numOf) {
    if (spec.supplies.some((s) => s.pin === pinId) || ctx.net(board, pinId) < 0) continue;
    const near = touching(ctx, board, pinId).filter((p) => p.comp.id !== board.id);
    if (!near.length) continue;
    // one hop through series resistors
    const hop = near.flatMap((p) => (ctx.def(p.comp).model === 'resistor' ? touching(ctx, p.comp, p.pin === '1' ? '2' : '1') : []));
    const all = [...near, ...hop];
    const name = analogName(n) ?? String(n);
    const find = (model: string, pins?: string[]) => all.find((p) => ctx.def(p.comp).model === model && (!pins || pins.includes(p.pin)));
    const led = find('led', ['A']), gate = find('nmos', ['G']) ?? find('pmos', ['G']), base = find('npn', ['B']) ?? find('pnp', ['B']);
    const sw = near.find((p) => ctx.def(p.comp).model === 'switch' && gndNets.has(ctx.net(p.comp, p.pin === '1' ? '2' : '1')));
    const pot = near.find((p) => ctx.def(p.comp).model === 'pot' && p.pin === 'W');
    const divider = near.filter((p) => ctx.def(p.comp).model === 'resistor').length >= 2 && spec.adcPins.includes(n);
    if (led) uses.push({ id: pinId, num: n, name, kind: 'led', note: `${refOf(led.comp)} LED` });
    else if (gate || base) uses.push({ id: pinId, num: n, name, kind: 'driver', note: `${refOf((gate ?? base)!.comp)} ${gate ? 'MOSFET gate' : 'transistör taban'} (yük sürücü)` });
    else if (sw) uses.push({ id: pinId, num: n, name, kind: 'button', note: `${refOf(sw.comp)} buton/anahtar (toprağa)` });
    else if ((pot || divider) && spec.adcPins.includes(n)) uses.push({ id: pinId, num: n, name, kind: 'analog', note: pot ? `${refOf(pot.comp)} potansiyometre` : 'direnç bölücü' });
  }
  if (!uses.length) return null;
  const outs = uses.filter((u) => u.kind === 'led' || u.kind === 'driver');
  const btns = uses.filter((u) => u.kind === 'button');
  const ana = uses.filter((u) => u.kind === 'analog');
  const id = (u: PinUse) => `${u.kind === 'led' ? 'LED' : u.kind === 'driver' ? 'YUK' : u.kind === 'button' ? 'BUTON' : 'ANALOG'}_${u.num}`;
  const L: string[] = [`// ElectroLab asistanı tarafından üretildi — ${def.name} (${ctx.circuit.components.length} parçalı devre)`, '// Pin numaraları devredeki gerçek bağlantılardan okundu.'];
  for (const u of uses) L.push(`const int ${id(u)} = ${u.name};  // ${u.id} → ${u.note}`);
  L.push('', 'void setup() {');
  for (const u of outs) L.push(`  pinMode(${id(u)}, OUTPUT);`);
  for (const u of btns) L.push(`  pinMode(${id(u)}, INPUT_PULLUP);  // basılınca LOW`);
  L.push('  Serial.begin(115200);', '}', '', 'void loop() {');
  const pwmOut = outs.find((o) => spec.pwmPins.includes(o.num));
  const maxv = (1 << spec.adcBits) - 1;
  if (ana.length && pwmOut) {
    L.push(`  int deger = analogRead(${id(ana[0])});             // 0..${maxv}`, `  int duty = map(deger, 0, ${maxv}, 0, 255);`, `  analogWrite(${id(pwmOut)}, duty);                 // PWM`, '  Serial.print("ADC=");', '  Serial.print(deger);', '  Serial.print(" PWM=");', '  Serial.println(duty);', '  delay(50);');
  } else if (btns.length && outs.length) {
    L.push(`  if (digitalRead(${id(btns[0])}) == LOW) {`, ...outs.map((o) => `    digitalWrite(${id(o)}, HIGH);`), '  } else {', ...outs.map((o) => `    digitalWrite(${id(o)}, LOW);`), '  }');
  } else if (outs.length) {
    for (const o of outs) L.push(`  digitalWrite(${id(o)}, HIGH);`, '  delay(500);', `  digitalWrite(${id(o)}, LOW);`, '  delay(500);');
  } else if (ana.length) {
    L.push(`  Serial.println(analogRead(${id(ana[0])}));`, '  delay(200);');
  }
  L.push('}', '');
  const notes = uses.map((u) => `${u.id} (${u.name}): ${u.note}`);
  if (uses.some((u) => u.kind === 'driver')) notes.push('Yük pinden doğrudan değil sürücü (MOSFET/transistör) üzerinden sürülüyor; sürücü kodu ve pull-down/gate direnci donanımda olmalı.');
  return { code: L.join('\n'), notes, uses };
}
