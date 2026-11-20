/**
 * Modified Nodal Analysis circuit solver (SPICE-class algorithms, own implementation).
 *  - DC operating point with Newton-Raphson, junction limiting, source- and gmin-stepping fallbacks
 *  - Transient with backward-Euler / trapezoidal companion models and step-halving on non-convergence
 * Models: R, C, L, V/I sources, diode/LED/zener (Shockley), BJT (Ebers-Moll), MOSFET (level-1 + body diode).
 * These are generic textbook models — not vendor SPICE models.
 */
import type { Circuit, Fault, PlacedComponent } from '../circuit/types';
import { mainPins } from './faults';
import { buildNets, type NetInfo } from '../circuit/nets';
import { getDef } from '../../library/components';
import { LOOSE_RMAX_DEFAULT, looseContactR } from './loose';

export const VT = 0.025852; // kT/q at 300 K

export type SimErrorKind = 'singular' | 'noconverge' | 'noground' | 'shorted-source' | 'empty';
export class SimError extends Error {
  constructor(public kind: SimErrorKind, message: string) {
    super(message);
  }
}

export interface CompResult {
  /** primary voltage (pin1 - pin2 for two-terminal parts) */
  v: number;
  /** primary current (pin1 -> pin2 through the part) */
  i: number;
  /** power absorbed by the part (negative = delivering) */
  p: number;
  vals: Record<string, number>;
}

export interface SimOptions {
  method?: 'trap' | 'be';
  /** 'ic': capacitors start at v0, inductors at 0 A.  'dc': start from DC operating point. */
  init?: 'ic' | 'dc';
  gmin?: number;
  /** structural faults: open / short / leak / gateShort / intermittent (param-level ones go through effectiveCircuit) */
  faults?: Record<string, Fault>;
  /** virtual instrument loads connected across two pins (voltmeter 10 MΩ, ammeter shunt, ...) */
  meters?: MeterSpec[];
}

export interface MeterSpec {
  id: string;
  a: { comp: string; pin: string };
  b: { comp: string; pin: string };
  /** resistance the instrument presents between its probes */
  r: number;
  kind: 'v' | 'a';
}

type Mode = 'dc' | 'ic' | 'tran';

// ---------------------------------------------------------------- elements
interface Base { owner: string }
interface RE extends Base { k: 'R'; a: number; b: number; g: number; inter?: number; /** time-varying conductance (loose connector); g holds its t=0 value for DC/AC */ dyn?: (t: number) => number }
/** esr: series resistance in ohm (0 = ideal). vPrev is the voltage on the ideal capacitor inside the ESR. */
interface CE extends Base { k: 'C'; a: number; b: number; c: number; v0: number; br: number; vPrev: number; iPrev: number; esr: number }
/**
 * Inductor. ik = saturation knee (A); 0 = ideal linear inductor (old behaviour, untouched code path).
 * Saturating law (documented, smooth, generic - NOT a measured core curve): the DIFFERENTIAL inductance
 *   L_d(i) = dlambda/di = L0 / (1 + (i/ik)^2)          (p = 2, fixed)
 * which is what a datasheet "L at DC bias" / an LCR meter with a small AC signal at bias measures. The flux linkage
 *   lambda(i) = L0*ik*atan(i/ik)                        (odd in i, saturates at +-L0*ik*pi/2)
 * and the stored energy  W(i) = int i dlambda = (L0*ik^2/2)*ln(1 + (i/ik)^2)  follow in closed form, so
 * v = dlambda/dt is energy consistent (no artificial L(i)*di/dt power error).
 * Transient: companion on lambda (BE: v = (lambda(i)-lambda_prev)/dt; trapezoidal: v + v_prev = 2(lambda-lambda_prev)/dt),
 * Newton-linearised with L_d(i0). lambda_prev is recomputed from iPrev, so no extra state is needed.
 * The transformer magnetizing branch is NOT saturable (its L1/L2/M are constant): skipped on purpose.
 */
interface LE extends Base { k: 'L'; a: number; b: number; l: number; br: number; vPrev: number; iPrev: number; ik: number }
interface VE extends Base { k: 'V'; a: number; b: number; br: number; wave: string; v: number; amp: number; freq: number; duty: number }
interface IE extends Base { k: 'I'; a: number; b: number; i: number }
interface DE extends Base { k: 'D'; a: number; b: number; is: number; n: number; vz: number; vLast: number; role: string }
interface QE extends Base { k: 'Q'; c: number; b: number; e: number; p: 1 | -1; is: number; bf: number; brv: number; vbeLast: number; vbcLast: number }
interface ME extends Base { k: 'M'; g: number; d: number; s: number; p: 1 | -1; vth: number; kk: number; lam: number }
/** Thevenin source from node a to node ref: vs behind conductance g (MCU pins and supplies) */
interface TE extends Base { k: 'T'; a: number; ref: number; g: number; vs: number; pin: string; kind: 'gpio' | 'supply'; label: string }
interface MO extends Base { k: 'MO'; a: number; b: number; br: number; br2: number; r: number; l: number; ke: number; j: number; bf: number; tl: number; iPrev: number; wPrev: number }
/**
 * Bipolar 2-phase stepper (generic sinusoidal model). Unknowns: iA, iB (coil currents), w (rotor speed); th = rotor angle (state).
 *   coil A:  vA = R·iA + L·diA/dt + eA,   eA = -Ke·w·sin(Nr·th)
 *   coil B:  vB = R·iB + L·diB/dt + eB,   eB = +Ke·w·cos(Nr·th)
 *   torque:  Te = Ke·(-iA·sin(Nr·th) + iB·cos(Nr·th))     (Te·w = iA·eA + iB·eB: electrical -> mechanical power balance)
 *   motion:  (J+Jload)·dw/dt = Te - B·w - Tload·tanh(w/WS),   dth/dt = w
 * Nr = steps/4 rotor teeth, Ke = Thold/Irated (one phase at Irated gives peak torque Thold). Full-step sequence A, B, -A, -B
 * moves the stable point by pi/(2Nr) = 360°/steps per phase change.
 * Discretisation: backward Euler for L and J (like 'MO'); the angle used for sin/cos inside a step is the mid-step
 * prediction th + 0.5·w_prev·dt (frozen during Newton, so the electrical/mechanical system stays linear in iA,iB,w);
 * th is advanced with the converged w (th += w·dt) after the step.
 */
interface STE extends Base { k: 'ST'; a1: number; b1: number; a2: number; b2: number; br: number; br2: number; br3: number; r: number; l: number; ke: number; nr: number; jt: number; bf: number; tl: number; iAPrev: number; iBPrev: number; wPrev: number; th: number }
/**
 * Hobby servo, BEHAVIOURAL model (no internal circuit): SIG pulse width (edge times interpolated from node voltage,
 * 1.0 ms -> 0°, 2.0 ms -> 180°, clamped) sets the target angle; angle slews to target at <= speed °/s; VCC-GND is a
 * resistive load (R = 4.8 V / I) with I = idle / moving / stalled (blocked shaft) value; SIG has a 100 kΩ pulldown.
 */
interface SVE extends Base { k: 'SV'; vcc: number; gnd: number; sig: number; load: RE; sigR: RE; angle: number; target: number; high: boolean; tRise: number; vSigPrev: number; pulse: number; speed: number; ii: number; im: number; is: number; blocked: boolean; moving: boolean }
/**
 * 3-phase BLDC motor, trapezoidal back-EMF, star winding with FLOATING neutral (neutral voltage vn is an unknown).
 * Unknowns (5 per motor): iU, iV, iW, w (rotor speed), vn.   th = mechanical rotor angle (state), thetaE = pp*th.
 *   phase x:  v_x - vn = R*i_x + L*di_x/dt + e_x,   e_x = Ke*w*trap(thetaE - k*120deg),  k = 0,1,2 for U,V,W
 *   neutral:  iU + iV + iW = 0
 *   torque:   Te = sum Ke*trap_x*i_x  (so Te*w = sum e_x*i_x: electrical -> mechanical power balance, no extra constants)
 *   motion:   J*dw/dt = Te - B*w - Tload*tanh(w/WT),   dth/dt = w
 * trap() has +-1 flat tops of 120 deg and 60 deg linear ramps. Backward Euler for L and J (like 'MO'); the angle inside a step is the
 * mid-step prediction th + 0.5*w_prev*dt, frozen during Newton (system stays linear in i, w, vn); th += w*dt after the step.
 * open: 0 = healthy, 1..3 = that phase winding is broken (its current is forced to 0).
 */
interface BLE extends Base { k: 'BL'; u: number; v: number; w: number; br: number; r: number; l: number; ke: number; pp: number; j: number; bf: number; tl: number; iPrev: [number, number, number]; wPrev: number; th: number; open: number }
/**
 * Behavioural 6-step (trapezoidal) ESC, AVERAGE-VALUE model (no PWM ripple). SIG = analog throttle 0..5 V -> duty 0..1
 * (below 0.2 V = off/coast, 5 V or more = 100 %). Commutation is derived from the rotor electrical angle of the motor wired to
 * U/V/W (hall-less, ideal position knowledge; a real sensorless ESC needs start-up and back-EMF zero-crossing detection).
 * Per sector one phase is the high side, one the low side, one floats (Hi-Z). A high phase is an averaging half-bridge:
 * i_out = g*(D*Vcc + (1-D)*Vgnd - Vout), supply current = D*i_out (lossless buck-like power balance, Ron = ESC_RON).
 * Freewheel diodes of all three half-bridges are present as separate 'D' elements. Modes: 0 = Hi-Z, 1 = low, 2 = high.
 */
interface ESE extends Base { k: 'ES'; vcc: number; gnd: number; sig: number; o: [number, number, number]; load: RE; sigR: RE; duty: number; mode: [number, number, number]; adv: number; vmin: number; motor: BLE | null; sector: number }
/**
 * Solenoid / electromagnet actuator. Unknowns: i (coil current), x (plunger position 0..xmax, 0 = retracted), v (plunger speed).
 *   L(x) = L0 + g*x, g = dL/dx = dL_total/xmax            flux  lambda = L(x)*i
 *   coil:   vc = R*i + d(lambda)/dt = R*i + L*di/dt + i*g*v      (the i*g*v term is the motional back-EMF: current dip while moving)
 *   force:  F = 0.5*i^2*g  (reluctance force, pulls the plunger in);  spring return: -(f0 + k*x);  viscous B
 *   motion: m*dv/dt = F - f0 - k*x - B*v,   dx/dt = v
 * Backward Euler with the exact Newton linearisation of the products x*i and i^2. Stroke stops are perfectly inelastic: after each
 * step x is clamped to [0, xmax] and the velocity into the stop is removed. DC / initial-condition solves hold the plunger at its stored position.
 * jam: plunger frozen at its position (fault).
 */
interface SOE extends Base { k: 'SO'; a: number; b: number; br: number; r: number; l0: number; g: number; xmax: number; ks: number; f0: number; m: number; bd: number; jam: boolean; iPrev: number; xPrev: number; vPrev: number }
/**
 * Relay: coil R+L with pull-in / drop-out thresholds and operate / release delays (see relayStep), plus contact physics
 * (all generic, typical-value models, NOT measured on a specific relay):
 *  - CONTACT BOUNCE: the contact that MAKES at an armature transition (NO on pull-in, NC on release) does not close cleanly.
 *    It touches (high constriction resistance), re-opens, touches again ... `nb` re-openings spread over `bounce` seconds, with
 *    deterministic pseudo-random segment durations (mulberry32 seeded from the component id and the event number, so a run is
 *    reproducible and independent of the time step). Open segments shrink geometrically (bounce energy decays). Segment edges are
 *    discontinuities: Sim.step() splits a step at the next edge so every state change lands on a step boundary.
 *    bounce = 0 or nb = 0: no bounce (old behaviour, ideal 50 mOhm contact). The breaking contact opens at once (no break bounce).
 *  - ARCING: a contact that OPENS while carrying > ARC_IMIN is armed for an arc. The arc is a smooth clamp i(v) with arc voltage
 *    V_arc(t) = ARC_V0 + ARC_DVDT*t_arc (gap grows while the contact separates, so the arc extinguishes by itself against a DC
 *    supply). The clamp conducts only above V_arc (> the ~12 V minimum arc voltage of common contact metals, so a flyback diode that
 *    holds the contact below it, or a low supply with a resistive load, produces no arc). The arc ends when its current falls
 *    below ARC_IFLOOR (smooth tail instead of chopping the inductor current) or after ARC_TMAX. Energy int v*i dt is accumulated in
 *    arcEnergy (wear indicator; the damage model reports 'kontak aşınması' above the `warc` limit).
 */
interface RYE extends Base {
  k: 'RY'; a: number; b: number; br: number; r: number; l: number; iPrev: number; ipull: number; idrop: number; top: number; trel: number; on: boolean; timer: number; force: 'closed' | 'open' | null; no: RE; nc: RE;
  bounce: number; nb: number; arcOn: boolean; warc: number; seed: number; ev: number;
  /** per contact [NO, NC]: bounce start (absolute t, -1 = none), cumulative segment end offsets, conductive flag at the last applied state */
  bs: [number, number]; seg: [number[], number[]]; cl: [boolean, boolean];
  /** per contact: arc active, arc start time, current reached ARC_IMIN at some point */
  ar: [boolean, boolean]; arT0: [number, number]; arStruck: [boolean, boolean];
  /** totals: completed arcs, accumulated arc energy (J), bounce re-openings */
  arcN: number; arcEnergy: number; bounces: number;
}
interface TRE extends Base { k: 'TR'; p1: number; p2: number; s1: number; s2: number; br: number; br2: number; r1: number; r2: number; l1: number; l2: number; m: number; i1Prev: number; i2Prev: number }
/** constant-power load: i = p / v */
interface WE extends Base { k: 'W'; a: number; b: number; p: number }
type Elem = RE | CE | LE | VE | IE | DE | QE | ME | TE | MO | STE | SVE | BLE | ESE | SOE | RYE | TRE | WE;

const LED_VF: Record<string, number> = { red: 1.9, yellow: 2.0, green: 2.1, blue: 3.0, white: 3.1, orange: 2.0, ir: 1.3, uv: 3.4 };
const LED_N = 2;
const LED_IREF = 0.02;
const BJT_BR = 5;
const BODY_IS = 1e-12;
const BODY_N = 1.2;
const R_ON = 1e-3;
/** reverse-conduction knee of a reverse-biased electrolytic capacitor (V). Generic, typical, not from a datasheet. */
const REV_CAP_VZ = 1.0;
const R_OFF = 1e9;
const IBV = 1e-3;
const WT = 1; // rad/s smoothing of the motor load-torque sign
const WS = 0.02; // rad/s smoothing of the stepper load-torque sign (small: static friction should hold, creep = WS·atanh(Te/Tload))
const SV_VTH = 1.5; // servo signal logic threshold (V)
const SV_VMIN = 3.5; // servo minimum supply for operation (V)
const SV_VNOM = 4.8; // supply at which the servo current figures are specified
const SV_RSIG = 1e5; // servo signal input pulldown
const ESC_RON = 0.02; // ESC half-bridge on-resistance (ohm), generic
const ESC_VTHR = 5; // ESC analog throttle full scale (V)
const ESC_VDEAD = 0.2; // ESC throttle below this = off (V)
/** trapezoidal back-EMF shape: +-1 flat tops of 120 deg with 60 deg ramps, zero at theta = 0 (rising), period 2pi */
export function trapezoid(theta: number): number {
  const TP = 2 * Math.PI, S = Math.PI / 6;
  const f = ((theta % TP) + TP) % TP;
  if (f < S) return f / S;
  if (f < 5 * S) return 1;
  if (f < 7 * S) return 1 - (f - 5 * S) / S;
  if (f < 11 * S) return -1;
  return -1 + (f - 11 * S) / S;
}
/** normalised back-EMF shapes of phases U, V, W at electrical angle thetaE (rad) */
export function bldcShapes(thetaE: number): [number, number, number] {
  const T3 = (2 * Math.PI) / 3;
  return [trapezoid(thetaE), trapezoid(thetaE - T3), trapezoid(thetaE - 2 * T3)];
}
/** six-step table: [high phase, low phase] per 60 deg sector (sector 0 starts at 30 deg electrical), phases 0=U 1=V 2=W */
const SIX_STEP: [number, number][] = [[0, 1], [0, 2], [1, 2], [1, 0], [2, 0], [2, 1]];
const RY_ON = 0.05; // relay contact resistance
/** extra constriction resistance (ohm) at the first touch of a bouncing contact, fading to 0 over the bounce window. Generic. */
const RY_BOUNCE_R0 = 0.5;
const RY_EPS = 1e-12; // time tolerance for bounce edges (s)
/** Contact arc constants. TYPICAL values for common contact metals (silver alloys), UNVERIFIED for any specific relay. */
const ARC_V0 = 14; // arc voltage at ignition (V); minimum arc voltage of typical metals is ~12 V, arc drop ~12-15 V
const ARC_DVDT = 5e3; // arc voltage growth while the gap opens (V/s), ~ gap speed x column field; generic
const ARC_R = 0.1; // dynamic arc resistance (ohm)
const ARC_W = 0.1; // smoothing width of the arc knee (V)
const ARC_IMIN = 0.3; // minimum arc current to ignite (A), typical
const ARC_IFLOOR = 1e-3; // arc considered out below this current (A)
const ARC_TMAX = 10e-3; // arc time limit (s)

/** Saturation knee from the data-sheet point "L has dropped by droppct % at Isat": L_d(Isat) = L0*(1-d)  =>  ik = Isat*sqrt((1-d)/d). */
export function satKnee(isat: number, droppct: number): number {
  const d = Math.min(Math.max(droppct / 100, 0.01), 0.9);
  return isat * Math.sqrt((1 - d) / d);
}
/** differential inductance L_d(i) = L0/(1+(i/ik)^2) */
export const ldSat = (l0: number, ik: number, i: number): number => l0 / (1 + (i / ik) * (i / ik));
/** flux linkage lambda(i) = L0*ik*atan(i/ik) */
export const lamSat = (l0: number, ik: number, i: number): number => l0 * ik * Math.atan(i / ik);
/** stored energy W(i) = (L0*ik^2/2)*ln(1+(i/ik)^2) */
export const enSat = (l0: number, ik: number, i: number): number => 0.5 * l0 * ik * ik * Math.log1p((i / ik) * (i / ik));
/** smooth arc clamp: current and slope at contact voltage v for arc voltage vc */
function arcEval(vc: number, v: number): { i: number; g: number } {
  const x = (Math.abs(v) - vc) / ARC_W, gA = 1 / ARC_R;
  const sp = x > 30 ? x : Math.log1p(Math.exp(x));
  const sg = x > 30 ? 1 : x < -30 ? 0 : 1 / (1 + Math.exp(-x));
  return { i: Math.sign(v) * gA * ARC_W * sp, g: gA * sg };
}
function hashId(s: string): number {
  let h = 2166136261;
  for (let k = 0; k < s.length; k++) { h ^= s.charCodeAt(k); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a: number): () => number {
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/**
 * Cumulative end offsets (s) of the bounce segments: closed (first touch), open1, closed, open2, ..., closed, openN; the contact is
 * closed for good after the last offset (= total). Weights: random 0.7..1.3 x geometric decay, normalised to `total`.
 */
export function bounceSequence(seed: number, total: number, nb: number): number[] {
  if (!(total > 0) || nb <= 0) return [];
  const rnd = mulberry32(seed);
  const w: number[] = [];
  for (let k = 1; k <= nb; k++) {
    w.push((k === 1 ? 0.5 : 0.5 * Math.pow(0.7, k - 1)) * (0.7 + 0.6 * rnd())); // closed segment before re-opening k
    w.push(Math.pow(0.6, k - 1) * (0.7 + 0.6 * rnd())); // open segment k
  }
  const sum = w.reduce((a, b) => a + b, 0);
  let acc = 0;
  return w.map((x) => (acc += (x / sum) * total));
}
export type { MO as MotorElem };

const num = (c: PlacedComponent, key: string): number => {
  const v = c.params[key];
  return typeof v === 'number' ? v : Number(v);
};

const expl = (x: number): number => (x > 80 ? Math.exp(80) * (1 + x - 80) : Math.exp(x));

function pnjlim(vnew: number, vold: number, vt: number, vcrit: number): number {
  if (vnew > vcrit && Math.abs(vnew - vold) > 2 * vt) {
    if (vold > 0) {
      const arg = (vnew - vold) / vt;
      vnew = arg > 0 ? vold + vt * (2 + Math.log(Math.max(arg - 2, 1e-9))) : vold - vt * (2 + Math.log(2 - arg));
    } else {
      vnew = vt * Math.log(vnew / vt);
    }
  }
  return vnew;
}
const vcritOf = (is: number, nvt: number): number => nvt * Math.log(nvt / (Math.SQRT2 * is));

export function sourceValue(e: { wave: string; v: number; amp: number; freq: number; duty: number }, t: number): number {
  switch (e.wave) {
    case 'sine':
      return e.v + e.amp * Math.sin(2 * Math.PI * e.freq * t);
    case 'square': {
      const ph = (t * e.freq) % 1;
      return e.v + (ph < e.duty / 100 ? e.amp : -e.amp);
    }
    case 'triangle': {
      const ph = (t * e.freq) % 1;
      return e.v + e.amp * (ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph);
    }
    default:
      return e.v;
  }
}

/** Level-1 MOSFET channel current in NMOS orientation (vds >= 0). */
function level1(vgs: number, vds: number, vth: number, K: number, lam: number): { i: number; gm: number; gds: number } {
  const vov = vgs - vth;
  if (vov <= 0) return { i: 0, gm: 0, gds: 0 };
  const cm = 1 + lam * vds;
  if (vds < vov) {
    const core = 2 * vov * vds - vds * vds;
    return { i: K * core * cm, gm: K * 2 * vds * cm, gds: K * (2 * vov - 2 * vds) * cm + K * core * lam };
  }
  return { i: K * vov * vov * cm, gm: 2 * K * vov * cm, gds: K * vov * vov * lam };
}

/** Solve dense A x = z by Gaussian elimination with partial pivoting. Returns null if singular. */
function solveDense(A: Float64Array, z: Float64Array, n: number): Float64Array | null {
  const x = Float64Array.from(z);
  for (let col = 0; col < n; col++) {
    let piv = col, best = Math.abs(A[col * n + col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(A[r * n + col]);
      if (v > best) { best = v; piv = r; }
    }
    if (best < 1e-18) return null;
    if (piv !== col) {
      for (let c = col; c < n; c++) { const t = A[col * n + c]; A[col * n + c] = A[piv * n + c]; A[piv * n + c] = t; }
      const t = x[col]; x[col] = x[piv]; x[piv] = t;
    }
    const d = A[col * n + col];
    for (let r = col + 1; r < n; r++) {
      const f = A[r * n + col] / d;
      if (f === 0) continue;
      for (let c = col; c < n; c++) A[r * n + c] -= f * A[col * n + c];
      x[r] -= f * x[col];
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let s = x[r];
    for (let c = r + 1; c < n; c++) s -= A[r * n + c] * x[c];
    x[r] = s / A[r * n + r];
  }
  return x;
}

/** Complex Gaussian elimination with partial pivoting (separate real/imag arrays). */
function solveComplex(Ar: Float64Array, Ai: Float64Array, zr: Float64Array, zi: Float64Array, n: number): { re: Float64Array; im: Float64Array } | null {
  const xr = Float64Array.from(zr), xi = Float64Array.from(zi);
  for (let col = 0; col < n; col++) {
    let piv = col, best = Math.hypot(Ar[col * n + col], Ai[col * n + col]);
    for (let r = col + 1; r < n; r++) {
      const m = Math.hypot(Ar[r * n + col], Ai[r * n + col]);
      if (m > best) { best = m; piv = r; }
    }
    if (best < 1e-18) return null;
    if (piv !== col) {
      for (let c = col; c < n; c++) {
        let t = Ar[col * n + c]; Ar[col * n + c] = Ar[piv * n + c]; Ar[piv * n + c] = t;
        t = Ai[col * n + c]; Ai[col * n + c] = Ai[piv * n + c]; Ai[piv * n + c] = t;
      }
      let t = xr[col]; xr[col] = xr[piv]; xr[piv] = t;
      t = xi[col]; xi[col] = xi[piv]; xi[piv] = t;
    }
    const dr = Ar[col * n + col], di = Ai[col * n + col], dd = dr * dr + di * di;
    for (let r = col + 1; r < n; r++) {
      const ar = Ar[r * n + col], ai = Ai[r * n + col];
      if (ar === 0 && ai === 0) continue;
      const fr = (ar * dr + ai * di) / dd, fi = (ai * dr - ar * di) / dd;
      for (let c = col; c < n; c++) {
        const br = Ar[col * n + c], bi = Ai[col * n + c];
        Ar[r * n + c] -= fr * br - fi * bi; Ai[r * n + c] -= fr * bi + fi * br;
      }
      xr[r] -= fr * xr[col] - fi * xi[col]; xi[r] -= fr * xi[col] + fi * xr[col];
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let sr = xr[r], si = xi[r];
    for (let c = r + 1; c < n; c++) {
      const ar = Ar[r * n + c], ai = Ai[r * n + c];
      sr -= ar * xr[c] - ai * xi[c]; si -= ar * xi[c] + ai * xr[c];
    }
    const dr = Ar[r * n + r], di = Ai[r * n + r], dd = dr * dr + di * di;
    xr[r] = (sr * dr + si * di) / dd; xi[r] = (si * dr - sr * di) / dd;
  }
  return { re: xr, im: xi };
}

export interface AcStim {
  /** component id of the voltage source driven with 1 V (all other sources are AC-dead) */
  vsrc?: string;
  /** component id of a current source driven with 1 A */
  isrc?: string;
  /** inject 1 A from node b into node a (net indices, 0 = ground) — impedance measurement */
  port?: { a: number; b: number };
}

export class Sim {
  readonly nets: NetInfo;
  readonly elems: Elem[] = [];
  /** refs of parts without an electrical model (treated as open circuit) */
  readonly ignored: string[] = [];
  readonly circuit: Circuit;
  readonly nodeN: number; // number of non-ground nodes
  readonly size: number;
  t = 0;
  x: Float64Array;
  private gmin: number;
  private method: 'trap' | 'be';
  private initMode: 'ic' | 'dc';
  private limited = false;
  private stepCount = 0;
  private lastSrc: number[] = [];
  private vsrcs: VE[] = [];
  private faults: Record<string, Fault> = {};
  private deadPins = new Set<string>();
  private wScale = 1;
  private meterElems: { e: RE; spec: MeterSpec }[] = [];
  private byOwner = new Map<string, Elem[]>();

  constructor(circuit: Circuit, opts: SimOptions = {}) {
    this.circuit = circuit;
    this.gmin = opts.gmin ?? 1e-12;
    this.faults = opts.faults ?? {};
    this.method = opts.method ?? 'trap';
    this.initMode = opts.init ?? 'ic';
    if (circuit.components.length === 0) throw new SimError('empty', 'Devre boş.');
    this.nets = buildNets(circuit);
    if (!this.nets.hasGround) throw new SimError('noground', 'Devrede toprak (GND) yok. Bir toprak bileşeni ekleyip bağlayın.');
    this.nodeN = this.nets.netCount - 1;
    let br = 0;
    const node = (c: PlacedComponent, pin: string): number => this.nets.pinNet.get(`${c.id}:${pin}`)! - 1;
    for (const c of circuit.components) {
      const def = getDef(c.type);
      const o = c.id;
      const flt = this.faults[c.id];
      if (flt && (flt.kind === 'open' || flt.kind === 'short') && def.model !== 'ground' && def.model !== 'none') {
        if (flt.kind === 'short') {
          const [pa, pb] = mainPins(def.model);
          this.elems.push({ k: 'R', owner: o, a: node(c, pa), b: node(c, pb), g: 1 / R_ON });
          if (def.model === 'pot') this.elems.push({ k: 'R', owner: o, a: node(c, 'A'), b: node(c, 'W'), g: 1 / R_ON });
        }
        continue;
      }
      const before = this.elems.length;
      switch (def.model) {
        case 'resistor': this.elems.push({ k: 'R', owner: o, a: node(c, '1'), b: node(c, '2'), g: 1 / Math.max(num(c, 'r'), 1e-9) }); break;
        case 'switch': {
          const closed = c.params.closed === true;
          this.elems.push({ k: 'R', owner: o, a: node(c, '1'), b: node(c, '2'), g: 1 / (closed ? R_ON : R_OFF) });
          break;
        }
        case 'pot': {
          const r = num(c, 'r');
          const pos = Math.min(Math.max(num(c, 'pos'), 0), 1);
          const r1 = Math.max(r * pos, R_ON), r2 = Math.max(r * (1 - pos), R_ON);
          this.elems.push({ k: 'R', owner: o, a: node(c, 'A'), b: node(c, 'W'), g: 1 / r1 });
          this.elems.push({ k: 'R', owner: o, a: node(c, 'W'), b: node(c, 'B'), g: 1 / r2 });
          break;
        }
        case 'capacitor':
          this.elems.push({ k: 'C', owner: o, a: node(c, '1'), b: node(c, '2'), c: num(c, 'c'), v0: num(c, 'v0') || 0, br: br++, vPrev: 0, iPrev: 0, esr: Math.max(Number(c.params.esr) || 0, 0) });
          break;
        case 'inductor':
          {
            const isat = Number(c.params.isat), dp = Number(c.params.droppct);
            const ik = isat > 0 ? satKnee(isat, Number.isFinite(dp) && dp > 0 ? dp : 30) : 0;
            this.elems.push({ k: 'L', owner: o, a: node(c, '1'), b: node(c, '2'), l: num(c, 'l'), br: br++, vPrev: 0, iPrev: 0, ik });
          }
          break;
        case 'vsource': {
          const a = node(c, 'P'), b = node(c, 'N');
          if (a === b) throw new SimError('shorted-source', `${c.ref}: kaynağın iki ucu aynı düğümde (kısa devre).`);
          this.elems.push({ k: 'V', owner: o, a, b, br: br++, wave: String(c.params.wave ?? 'dc'), v: num(c, 'v') || 0, amp: num(c, 'amp') || 0, freq: num(c, 'freq') || 0, duty: num(c, 'duty') || 50 });
          break;
        }
        case 'isource': this.elems.push({ k: 'I', owner: o, a: node(c, 'P'), b: node(c, 'N'), i: num(c, 'i') }); break;
        case 'diode':
          this.elems.push({ k: 'D', owner: o, a: node(c, 'A'), b: node(c, 'K'), is: num(c, 'is'), n: num(c, 'n'), vz: 0, vLast: 0, role: 'diode' });
          break;
        case 'led': {
          const vf = LED_VF[String(c.params.color)] ?? 2;
          const is = LED_IREF / (Math.exp(vf / (LED_N * VT)) - 1);
          this.elems.push({ k: 'D', owner: o, a: node(c, 'A'), b: node(c, 'K'), is, n: LED_N, vz: 0, vLast: 0, role: 'led' });
          break;
        }
        case 'zener':
          this.elems.push({ k: 'D', owner: o, a: node(c, 'A'), b: node(c, 'K'), is: 1e-14, n: 1, vz: num(c, 'vz'), vLast: 0, role: 'zener' });
          break;
        case 'npn':
        case 'pnp':
          this.elems.push({ k: 'Q', owner: o, c: node(c, 'C'), b: node(c, 'B'), e: node(c, 'E'), p: def.model === 'npn' ? 1 : -1, is: num(c, 'is'), bf: num(c, 'bf'), brv: BJT_BR, vbeLast: 0, vbcLast: 0 });
          break;
        case 'nmos':
        case 'pmos': {
          const p = def.model === 'nmos' ? 1 : -1;
          const g = node(c, 'G'), d = node(c, 'D'), s = node(c, 'S');
          this.elems.push({ k: 'M', owner: o, g, d, s, p, vth: num(c, 'vth'), kk: num(c, 'k'), lam: num(c, 'lambda') });
          // body diode: NMOS anode=S cathode=D ; PMOS anode=D cathode=S
          this.elems.push({ k: 'D', owner: o, a: p === 1 ? s : d, b: p === 1 ? d : s, is: BODY_IS, n: BODY_N, vz: 0, vLast: 0, role: 'body' });
          break;
        }
        case 'bridge': {
          const is = num(c, 'is'), n = num(c, 'n');
          const ac1 = node(c, 'AC1'), ac2 = node(c, 'AC2'), p = node(c, 'P'), m = node(c, 'N');
          const d = (a: number, b: number) => this.elems.push({ k: 'D', owner: o, a, b, is, n, vz: 0, vLast: 0, role: 'diode' });
          d(ac1, p); d(ac2, p); d(m, ac1); d(m, ac2);
          break;
        }
        case 'motor':
          this.elems.push({ k: 'MO', owner: o, a: node(c, 'P'), b: node(c, 'N'), br: br++, br2: br++, r: num(c, 'r'), l: num(c, 'l'), ke: num(c, 'ke'), j: num(c, 'j'), bf: num(c, 'b'), tl: num(c, 'tload'), iPrev: 0, wPrev: 0 });
          break;
        case 'stepper': {
          const steps = Math.max(num(c, 'steps'), 4), irated = Math.max(num(c, 'irated'), 1e-6);
          this.elems.push({
            k: 'ST', owner: o, a1: node(c, 'A+'), b1: node(c, 'A-'), a2: node(c, 'B+'), b2: node(c, 'B-'), br: br++, br2: br++, br3: br++,
            r: num(c, 'r'), l: num(c, 'l'), ke: num(c, 'thold') / irated, nr: steps / 4, jt: num(c, 'j') + (num(c, 'jload') || 0), bf: Math.max(num(c, 'b'), 1e-9), tl: num(c, 'tload') || 0,
            iAPrev: 0, iBPrev: 0, wPrev: 0, th: 0,
          });
          break;
        }
        case 'servo': {
          const ii = num(c, 'iidle');
          const load: RE = { k: 'R', owner: o, a: node(c, 'VCC'), b: node(c, 'GND'), g: ii / SV_VNOM };
          const sigR: RE = { k: 'R', owner: o, a: node(c, 'SIG'), b: node(c, 'GND'), g: 1 / SV_RSIG };
          const a0 = Math.min(Math.max(num(c, 'a0'), 0), 180);
          this.elems.push({ k: 'SV', owner: o, vcc: node(c, 'VCC'), gnd: node(c, 'GND'), sig: node(c, 'SIG'), load, sigR, angle: a0, target: a0, high: false, tRise: -1, vSigPrev: 0, pulse: 0, speed: num(c, 'speed'), ii, im: num(c, 'imove'), is: num(c, 'istall'), blocked: c.params.blocked === true, moving: false }, load, sigR);
          break;
        }
        case 'bldc': {
          const open = flt?.kind === 'openPhase' ? Math.min(Math.max(Math.round(flt.amount ?? 1), 1), 3) : 0;
          this.elems.push({ k: 'BL', owner: o, u: node(c, 'U'), v: node(c, 'V'), w: node(c, 'W'), br, r: num(c, 'r'), l: num(c, 'l'), ke: num(c, 'ke'), pp: Math.max(Math.round(num(c, 'pp')), 1), j: num(c, 'j'), bf: Math.max(num(c, 'b'), 1e-9), tl: num(c, 'tload') || 0, iPrev: [0, 0, 0], wPrev: 0, th: 0, open });
          br += 5;
          break;
        }
        case 'bldc_esc': {
          const load: RE = { k: 'R', owner: o, a: node(c, 'VCC'), b: node(c, 'GND'), g: num(c, 'iq') / 5 };
          const sigR: RE = { k: 'R', owner: o, a: node(c, 'SIG'), b: node(c, 'GND'), g: 1 / SV_RSIG };
          const outs: [number, number, number] = [node(c, 'U'), node(c, 'V'), node(c, 'W')];
          const vcc = node(c, 'VCC'), gnd = node(c, 'GND');
          this.elems.push({ k: 'ES', owner: o, vcc, gnd, sig: node(c, 'SIG'), o: outs, load, sigR, duty: 0, mode: [0, 0, 0], adv: (num(c, 'adv') * Math.PI) / 180, vmin: num(c, 'vmin'), motor: null, sector: 0 }, load, sigR);
          for (const out of outs) {
            // freewheel diodes of the half-bridge: GND -> out, out -> VCC
            this.elems.push({ k: 'D', owner: o, a: gnd, b: out, is: BODY_IS, n: BODY_N, vz: 0, vLast: 0, role: 'body' });
            this.elems.push({ k: 'D', owner: o, a: out, b: vcc, is: BODY_IS, n: BODY_N, vz: 0, vLast: 0, role: 'body' });
          }
          break;
        }
        case 'solenoid': {
          const xmax = Math.max(num(c, 'stroke') * 1e-3, 1e-6);
          this.elems.push({ k: 'SO', owner: o, a: node(c, 'P'), b: node(c, 'N'), br, r: num(c, 'r'), l0: num(c, 'l0'), g: num(c, 'dl') / xmax, xmax, ks: num(c, 'k'), f0: num(c, 'f0'), m: Math.max(num(c, 'm'), 1e-6), bd: Math.max(num(c, 'b'), 0), jam: c.params.jam === true, iPrev: 0, xPrev: 0, vPrev: 0 });
          br += 3;
          break;
        }
        case 'relay': {
          const r = num(c, 'rcoil');
          const com = node(c, 'COM');
          const no: RE = { k: 'R', owner: o, a: com, b: node(c, 'NO'), g: 1 / R_OFF };
          const nc: RE = { k: 'R', owner: o, a: com, b: node(c, 'NC'), g: 1 / RY_ON };
          const bms = Number(c.params.bounce), nbn = Number(c.params.nbounce);
          const force = flt?.kind === 'welded' ? 'closed' : flt?.kind === 'stuckOpen' ? 'open' : null;
          const e: RYE = { k: 'RY', owner: o, a: node(c, 'C1'), b: node(c, 'C2'), br: br++, r, l: num(c, 'lcoil'), iPrev: 0, ipull: num(c, 'vpull') / r, idrop: num(c, 'vdrop') / r, top: num(c, 'top'), trel: num(c, 'trel'), on: false, timer: 0, force, no, nc,
            bounce: Number.isFinite(bms) ? Math.max(bms, 0) * 1e-3 : 2e-3, nb: Number.isFinite(nbn) ? Math.max(Math.round(nbn), 0) : 3, arcOn: c.params.arc !== false,
            warc: Number.isFinite(Number(c.params.warc)) ? Number(c.params.warc) : 0, seed: hashId(o), ev: 0,
            bs: [-1, -1], seg: [[], []], cl: [false, true], ar: [false, false], arT0: [0, 0], arStruck: [false, false], arcN: 0, arcEnergy: 0, bounces: 0 };
          this.elems.push(e, no, nc);
          this.applyRelay(e);
          break;
        }
        case 'transformer': {
          const l1 = num(c, 'l1'), n = num(c, 'n'), k = num(c, 'k');
          const l2 = l1 / (n * n), m = k * Math.sqrt(l1 * l2);
          this.elems.push({ k: 'TR', owner: o, p1: node(c, 'P1'), p2: node(c, 'P2'), s1: node(c, 'S1'), s2: node(c, 'S2'), br: br++, br2: br++, r1: num(c, 'rp'), r2: num(c, 'rs'), l1, l2, m, i1Prev: 0, i2Prev: 0 });
          break;
        }
        case 'eload': {
          const P = node(c, 'P'), N = node(c, 'N');
          const mode = String(c.params.mode);
          if (mode === 'cr') this.elems.push({ k: 'R', owner: o, a: P, b: N, g: 1 / Math.max(num(c, 'r'), 1e-3) });
          else if (mode === 'cp') this.elems.push({ k: 'W', owner: o, a: P, b: N, p: num(c, 'p') });
          else this.elems.push({ k: 'I', owner: o, a: N, b: P, i: num(c, 'i') });
          break;
        }
        case 'mcu': {
          const spec = def.mcu!;
          const gnd = spec.gnd.filter((g) => this.nets.pinNet.has(`${c.id}:${g}`));
          const gref = node(c, gnd[0]);
          for (let k = 1; k < gnd.length; k++) this.elems.push({ k: 'R', owner: o, a: node(c, gnd[k]), b: gref, g: 1 / R_ON });
          // lowVoltage: the board's supply rails sag by `amount` percent (USB/regulator brown-out); the runner resets the MCU below its BOD threshold
          const sag = flt?.kind === 'lowVoltage' ? Math.min(Math.max(1 - (flt.amount ?? 30) / 100, 0), 1) : 1;
          for (const sp of spec.supplies) this.elems.push({ k: 'T', owner: o, a: node(c, sp.pin), ref: gref, g: 1 / sp.rout, vs: sp.v * sag, pin: sp.pin, kind: 'supply', label: sp.label });
          const supplyPins = new Set(spec.supplies.map((x) => x.pin));
          for (const pid of Object.values(spec.pinMap)) {
            if (supplyPins.has(pid) || !this.nets.pinNet.has(`${c.id}:${pid}`)) continue;
            this.elems.push({ k: 'T', owner: o, a: node(c, pid), ref: gref, g: 0, vs: 0, pin: pid, kind: 'gpio', label: pid });
          }
          break;
        }
        case 'none': this.ignored.push(c.ref); break;
        case 'busdev': break; // high-impedance pins; behaviour lives in the MCU bus layer (core/mcu/bus.ts)
        case 'ground': break;
      }
      if (flt) {
        const [pa, pb] = mainPins(def.model);
        if (flt.kind === 'leak') this.elems.push({ k: 'R', owner: o, a: node(c, pa), b: node(c, pb), g: 1 / Math.max(flt.amount ?? 1e4, 1) });
        if (flt.kind === 'gateShort' && (def.model === 'nmos' || def.model === 'pmos')) this.elems.push({ k: 'R', owner: o, a: node(c, 'G'), b: node(c, 'S'), g: 1 / R_ON });
        if (flt.kind === 'reverseVoltage' && def.model === 'capacitor') {
          // reverse-biased electrolytic: oxide conducts once the marked polarity is violated by ~1 V (zener-like knee, no forward branch)
          this.elems.push({ k: 'D', owner: o, a: node(c, '1'), b: node(c, '2'), is: 1e-14, n: 1, vz: REV_CAP_VZ, vLast: 0, role: 'rev' });
        }
        if (flt.kind === 'insulationFault') {
          const pin = flt.pin && def.pins.some((p) => p.id === flt.pin) ? flt.pin : pa;
          const toNet = flt.to ? this.nets.pinNet.get(`${flt.to.comp}:${flt.to.pin}`) : 0;
          const a = node(c, pin), b = toNet === undefined ? -1 : toNet - 1;
          if (a !== b) this.elems.push({ k: 'R', owner: o, a, b, g: 1 / Math.max(flt.amount ?? 1e6, 1) });
        }
        if (flt.kind === 'intermittent') for (let i = before; i < this.elems.length; i++) { const e = this.elems[i]; if (e.k === 'R') e.inter = flt.amount ?? 50; }
      }
    }
    for (const w of circuit.wires) {
      if (!w.loose || w.broken) continue;
      const na = this.nets.pinNet.get(`${w.a.comp}:${w.a.pin}`), nb = this.nets.pinNet.get(`${w.b.comp}:${w.b.pin}`);
      if (na === undefined || nb === undefined || na === nb) continue;
      const rmax = w.loose.rmax ?? LOOSE_RMAX_DEFAULT;
      const dyn = (t: number) => 1 / looseContactR(w.id, t, rmax);
      this.elems.push({ k: 'R', owner: `__w${w.id}`, a: na - 1, b: nb - 1, g: dyn(0), dyn });
    }
    for (const spec of opts.meters ?? []) {
      const na = this.nets.pinNet.get(`${spec.a.comp}:${spec.a.pin}`), nb = this.nets.pinNet.get(`${spec.b.comp}:${spec.b.pin}`);
      if (na === undefined || nb === undefined || na === nb) continue;
      const e: RE = { k: 'R', owner: `__m${spec.id}`, a: na - 1, b: nb - 1, g: 1 / Math.max(spec.r, 1e-6) };
      this.elems.push(e);
      this.meterElems.push({ e, spec });
    }
    for (const e of this.elems) {
      if (e.k !== 'ES') continue;
      const outs = e.o;
      e.motor = this.elems.find((m): m is BLE => m.k === 'BL' && [m.u, m.v, m.w].some((nn) => nn >= 0 && outs.includes(nn))) ?? null;
    }
    for (const e of this.elems) { const l = this.byOwner.get(e.owner); if (l) l.push(e); else this.byOwner.set(e.owner, [e]); }
    this.vsrcs = this.elems.filter((q): q is VE => q.k === 'V');
    this.size = this.nodeN + br;
    this.x = new Float64Array(this.size);
  }

  // ------------------------------------------------ helpers
  private v(x: Float64Array, n: number): number { return n < 0 ? 0 : x[n]; }

  /** Source values used for discontinuity detection (BE restart). */
  private srcSnapshot(t: number): number[] {
    const out: number[] = [];
    for (const e of this.elems) if (e.k === 'V') out.push(sourceValue(e, t));
    return out;
  }

  // ------------------------------------------------ stamping
  private stamp(A: Float64Array, z: Float64Array, mode: Mode, t: number, dt: number, scale: number, gminX: number, trap: boolean): void {
    const n = this.size, N = this.nodeN;
    const G = (i: number, j: number, g: number) => { if (i >= 0 && j >= 0) A[i * n + j] += g; };
    const J = (i: number, val: number) => { if (i >= 0) z[i] += val; };
    const cond = (a: number, b: number, g: number) => { G(a, a, g); G(b, b, g); G(a, b, -g); G(b, a, -g); };
    const gm = this.gmin + gminX;
    for (let i = 0; i < N; i++) A[i * n + i] += gm;
    this.limited = false;

    for (const e of this.elems) {
      switch (e.k) {
        case 'T': if (e.g > 0) { cond(e.a, e.ref, e.g); J(e.a, e.g * e.vs); J(e.ref, -e.g * e.vs); } break;
        case 'R': cond(e.a, e.b, e.dyn && mode === 'tran' ? e.dyn(t) : e.inter && mode === 'tran' && (t * e.inter) % 1 >= 0.5 ? 1e-9 : e.g); break;
        case 'I': { const i = e.i * scale; J(e.a, i); J(e.b, -i); break; }
        case 'V': {
          const r = N + e.br;
          G(e.a, r, 1); G(e.b, r, -1); G(r, e.a, 1); G(r, e.b, -1);
          z[r] += (mode === 'tran' ? sourceValue(e, t) : sourceValue(e, 0)) * scale;
          break;
        }
        case 'C': {
          const r = N + e.br;
          if (mode === 'ic') {
            G(e.a, r, 1); G(e.b, r, -1); G(r, e.a, 1); G(r, e.b, -1);
            A[r * n + r] -= e.esr; // v_ab = v0 + ESR * i
            z[r] += e.v0 * scale;
          } else {
            A[r * n + r] += 1; // unused branch row: x_br = 0
            if (mode === 'tran') {
              const g0 = (trap ? 2 : 1) * e.c / dt;
              const k = 1 / (1 + g0 * e.esr); // series ESR: i = g0/(1+g0 R) * v - ih/(1+g0 R)
              cond(e.a, e.b, g0 * k);
              const ih = (g0 * e.vPrev + (trap ? e.iPrev : 0)) * k;
              J(e.a, ih); J(e.b, -ih);
            }
          }
          break;
        }
        case 'L': {
          const r = N + e.br;
          G(e.a, r, 1); G(e.b, r, -1); G(r, e.a, 1); G(r, e.b, -1);
          if (mode === 'ic') {
            // open circuit at 0 A: row becomes i = 0
            for (let c = 0; c < n; c++) A[r * n + c] = 0;
            A[r * n + r] = 1;
          } else if (mode === 'tran' && e.ik > 0) {
            // saturating: v = d(lambda)/dt with lambda(i) linearised at the Newton iterate i0 (differential inductance L_d)
            const i0 = this.x[r];
            const ld = ldSat(e.l, e.ik, i0), k = (trap ? 2 : 1) / dt;
            A[r * n + r] -= k * ld;
            z[r] += k * (lamSat(e.l, e.ik, i0) - ld * i0 - lamSat(e.l, e.ik, e.iPrev)) - (trap ? e.vPrev : 0);
          } else if (mode === 'tran') {
            const k = (trap ? 2 : 1) * e.l / dt;
            A[r * n + r] -= k;
            z[r] += -k * e.iPrev - (trap ? e.vPrev : 0);
          } // dc: short circuit (v = 0), row already v_a - v_b = 0
          break;
        }
        case 'MO': {
          const ri = N + e.br, rw = N + e.br2;
          G(e.a, ri, 1); G(e.b, ri, -1); G(ri, e.a, 1); G(ri, e.b, -1);
          if (mode === 'ic') {
            for (let c = 0; c < n; c++) { A[ri * n + c] = 0; A[rw * n + c] = 0; }
            A[ri * n + ri] = 1; A[rw * n + rw] = 1;
            break;
          }
          const kL = mode === 'tran' ? e.l / dt : 0, kJ = mode === 'tran' ? e.j / dt : 0;
          A[ri * n + ri] -= e.r + kL; A[ri * n + rw] -= e.ke; z[ri] += -kL * e.iPrev;
          const w = this.x[rw];
          const th = e.tl > 0 ? Math.tanh(w / WT) : 0;
          const fp = e.tl > 0 ? (e.tl * (1 - th * th)) / WT : 0;
          A[rw * n + rw] += kJ + e.bf + fp; A[rw * n + ri] -= e.ke;
          z[rw] += kJ * e.wPrev - e.tl * th + fp * w;
          break;
        }
        case 'ST': {
          const rA = N + e.br, rB = N + e.br2, rw = N + e.br3;
          G(e.a1, rA, 1); G(e.b1, rA, -1); G(rA, e.a1, 1); G(rA, e.b1, -1);
          G(e.a2, rB, 1); G(e.b2, rB, -1); G(rB, e.a2, 1); G(rB, e.b2, -1);
          if (mode === 'ic') {
            for (let c = 0; c < n; c++) { A[rA * n + c] = 0; A[rB * n + c] = 0; A[rw * n + c] = 0; }
            A[rA * n + rA] = 1; A[rB * n + rB] = 1; A[rw * n + rw] = 1;
            break;
          }
          const tr = mode === 'tran';
          const kL = tr ? e.l / dt : 0, kJ = tr ? e.jt / dt : 0;
          const thc = e.th + (tr ? 0.5 * e.wPrev * dt : 0);
          const sA = Math.sin(e.nr * thc), cB = Math.cos(e.nr * thc);
          A[rA * n + rA] -= e.r + kL; A[rA * n + rw] += e.ke * sA; z[rA] += -kL * e.iAPrev;
          A[rB * n + rB] -= e.r + kL; A[rB * n + rw] -= e.ke * cB; z[rB] += -kL * e.iBPrev;
          const w = this.x[rw];
          const th = e.tl > 0 ? Math.tanh(w / WS) : 0;
          const fp = e.tl > 0 ? (e.tl * (1 - th * th)) / WS : 0;
          A[rw * n + rw] += kJ + e.bf + fp; A[rw * n + rA] += e.ke * sA; A[rw * n + rB] -= e.ke * cB;
          z[rw] += kJ * e.wPrev - e.tl * th + fp * w;
          break;
        }
        case 'BL': {
          const rI = [N + e.br, N + e.br + 1, N + e.br + 2], rw = N + e.br + 3, rn = N + e.br + 4;
          const nd = [e.u, e.v, e.w];
          for (let p = 0; p < 3; p++) { G(nd[p], rI[p], 1); G(rI[p], nd[p], 1); }
          if (mode === 'ic') {
            for (const r of [...rI, rw, rn]) { for (let c = 0; c < n; c++) A[r * n + c] = 0; A[r * n + r] = 1; }
            break;
          }
          const tr = mode === 'tran';
          const kL = tr ? e.l / dt : 0, kJ = tr ? e.j / dt : 0;
          const sh = bldcShapes(e.pp * (e.th + (tr ? 0.5 * e.wPrev * dt : 0)));
          for (let p = 0; p < 3; p++) {
            const r = rI[p];
            if (e.open === p + 1) { for (let c = 0; c < n; c++) A[r * n + c] = 0; A[r * n + r] = 1; continue; }
            A[r * n + rn] -= 1; A[r * n + r] -= e.r + kL; A[r * n + rw] -= e.ke * sh[p]; z[r] += -kL * e.iPrev[p];
            A[rw * n + r] -= e.ke * sh[p];
            A[rn * n + r] += 1;
          }
          const w = this.x[rw];
          const th = e.tl > 0 ? Math.tanh(w / WT) : 0;
          const fp = e.tl > 0 ? (e.tl * (1 - th * th)) / WT : 0;
          A[rw * n + rw] += kJ + e.bf + fp;
          z[rw] += kJ * e.wPrev - e.tl * th + fp * w;
          if (e.open) A[rn * n + rI[e.open - 1]] += 1; // keep the neutral row well-posed (open phase current is 0)
          break;
        }
        case 'ES': {
          const D = e.duty;
          for (let p = 0; p < 3; p++) {
            const o = e.o[p], m = e.mode[p];
            if (m === 1) cond(o, e.gnd, 1 / ESC_RON);
            else if (m === 2) {
              const g = 1 / ESC_RON;
              // i_in (leaving node o) = g*(Vo - (1-D)*Vg - D*Vc); leaving Vcc: -D*i_in; leaving gnd: -(1-D)*i_in
              G(o, o, g); G(o, e.gnd, -g * (1 - D)); G(o, e.vcc, -g * D);
              G(e.vcc, o, -D * g); G(e.vcc, e.gnd, D * (1 - D) * g); G(e.vcc, e.vcc, D * D * g);
              G(e.gnd, o, -(1 - D) * g); G(e.gnd, e.gnd, (1 - D) * (1 - D) * g); G(e.gnd, e.vcc, (1 - D) * D * g);
            }
          }
          break;
        }
        case 'SO': {
          const ri = N + e.br, rx = N + e.br + 1, rv = N + e.br + 2;
          G(e.a, ri, 1); G(e.b, ri, -1); G(ri, e.a, 1); G(ri, e.b, -1);
          if (mode === 'ic') {
            for (let c = 0; c < n; c++) A[ri * n + c] = 0;
            A[ri * n + ri] = 1;
          }
          const tr = mode === 'tran';
          const hold = !tr || e.jam;
          if (mode !== 'ic') {
            const k = tr ? 1 / dt : 0;
            const i0 = this.x[ri], x0 = this.x[rx];
            A[ri * n + ri] -= e.r + (e.l0 + e.g * x0) * k; A[ri * n + rx] -= e.g * i0 * k;
            z[ri] += -(e.g * x0 * i0 + (e.l0 + e.g * e.xPrev) * e.iPrev) * k;
          }
          if (hold) { A[rx * n + rx] = 1; z[rx] = e.xPrev; A[rv * n + rv] = 1; }
          else {
            const i0 = this.x[ri];
            A[rx * n + rx] = 1 / dt; A[rx * n + rv] = -1; z[rx] = e.xPrev / dt;
            A[rv * n + rv] = e.m / dt + e.bd; A[rv * n + ri] = -e.g * i0; A[rv * n + rx] = e.ks;
            z[rv] = (e.m * e.vPrev) / dt - 0.5 * e.g * i0 * i0 - e.f0;
          }
          break;
        }
        case 'RY': {
          const ri = N + e.br;
          G(e.a, ri, 1); G(e.b, ri, -1); G(ri, e.a, 1); G(ri, e.b, -1);
          if (mode === 'ic') { for (let c = 0; c < n; c++) A[ri * n + c] = 0; A[ri * n + ri] = 1; }
          else { const kL = mode === 'tran' ? e.l / dt : 0; A[ri * n + ri] -= e.r + kL; z[ri] += -kL * e.iPrev; }
          if (mode === 'tran') {
            // armed contact arcs: smooth voltage clamp across the open contact (Newton-linearised like a diode)
            for (let q = 0; q < 2; q++) {
              if (!e.ar[q]) continue;
              const c = q === 0 ? e.no : e.nc;
              const v = this.v(this.x, c.a) - this.v(this.x, c.b);
              const m = arcEval(this.arcVoltage(e, q, t), v);
              cond(c.a, c.b, m.g);
              const ieq = m.i - m.g * v;
              J(c.a, -ieq); J(c.b, ieq);
            }
          }
          break;
        }
        case 'TR': {
          const r1 = N + e.br, r2 = N + e.br2;
          G(e.p1, r1, 1); G(e.p2, r1, -1); G(r1, e.p1, 1); G(r1, e.p2, -1);
          G(e.s1, r2, 1); G(e.s2, r2, -1); G(r2, e.s1, 1); G(r2, e.s2, -1);
          if (mode === 'ic') {
            for (let c = 0; c < n; c++) { A[r1 * n + c] = 0; A[r2 * n + c] = 0; }
            A[r1 * n + r1] = 1; A[r2 * n + r2] = 1;
          } else {
            const k = mode === 'tran' ? 1 / dt : 0;
            A[r1 * n + r1] -= e.r1 + e.l1 * k; A[r1 * n + r2] -= e.m * k; z[r1] += -(e.l1 * e.i1Prev + e.m * e.i2Prev) * k;
            A[r2 * n + r1] -= e.m * k; A[r2 * n + r2] -= e.r2 + e.l2 * k; z[r2] += -(e.m * e.i1Prev + e.l2 * e.i2Prev) * k;
          }
          break;
        }
        case 'W': {
          const v = this.v(this.x, e.a) - this.v(this.x, e.b);
          const p = e.p * this.wScale;
          const i0 = p / Math.max(v, 0.5), g = v > 0.5 ? -p / (v * v) : 0;
          cond(e.a, e.b, g);
          const ieq = i0 - g * v;
          J(e.a, -ieq); J(e.b, ieq);
          break;
        }
        case 'D': this.stampDiode(e, A, z, n); break;
        case 'Q': this.stampBjt(e, A, z, n); break;
        case 'M': this.stampMos(e, A, z, n); break;
      }
    }
  }

  private stampDiode(e: DE, A: Float64Array, z: Float64Array, n: number): void {
    const nvt = e.n * VT;
    const vcrit = vcritOf(e.is, nvt);
    let vd = this.v(this.x, e.a) - this.v(this.x, e.b);
    const lim = pnjlim(vd, e.vLast, nvt, vcrit);
    if (lim !== vd) { this.limited = true; vd = lim; }
    e.vLast = vd;
    let i = e.is * (expl(vd / nvt) - 1);
    let g = (e.is / nvt) * expl(vd / nvt);
    if (e.role === 'rev') { i = 0; g = 0; } // reverse-only breakdown path: no forward branch
    if (e.role === 'zener' || e.role === 'rev') {
      const vr = -(vd + e.vz);
      const ex = expl(vr / VT);
      i -= IBV * ex;
      g += (IBV / VT) * ex;
    }
    g += this.gmin;
    i += this.gmin * vd;
    const ieq = i - g * vd;
    const G = (p: number, q: number, v: number) => { if (p >= 0 && q >= 0) A[p * n + q] += v; };
    G(e.a, e.a, g); G(e.b, e.b, g); G(e.a, e.b, -g); G(e.b, e.a, -g);
    if (e.a >= 0) z[e.a] -= ieq;
    if (e.b >= 0) z[e.b] += ieq;
  }

  private bjtEval(e: QE, vbe: number, vbc: number) {
    const ife = e.is * (expl(vbe / VT) - 1), gife = (e.is / VT) * expl(vbe / VT);
    const ir = e.is * (expl(vbc / VT) - 1), gir = (e.is / VT) * expl(vbc / VT);
    const ic = ife - ir - ir / e.brv;
    const ib = ife / e.bf + ir / e.brv;
    return {
      ic, ib,
      gcbe: gife, gcbc: -gir - gir / e.brv,
      gbbe: gife / e.bf, gbbc: gir / e.brv,
    };
  }

  private stampBjt(e: QE, A: Float64Array, z: Float64Array, n: number): void {
    const p = e.p;
    const vb = this.v(this.x, e.b), ve = this.v(this.x, e.e), vc = this.v(this.x, e.c);
    let vbe = p * (vb - ve), vbc = p * (vb - vc);
    const crit = vcritOf(e.is, VT);
    const l1 = pnjlim(vbe, e.vbeLast, VT, crit), l2 = pnjlim(vbc, e.vbcLast, VT, crit);
    if (l1 !== vbe || l2 !== vbc) this.limited = true;
    vbe = l1; vbc = l2; e.vbeLast = vbe; e.vbcLast = vbc;
    const m = this.bjtEval(e, vbe, vbc);
    // Terminal currents into device (actual orientation): C: p*ic, B: p*ib, E: -(C+B)
    const Ic0 = p * m.ic, Ib0 = p * m.ib;
    // d(I)/d(V_node): vbe = p(vb-ve), vbc = p(vb-vc); I = p*f(vbe,vbc) -> dI/dVb = a+b, dVe = -a, dVc = -b
    const rowC = { b: m.gcbe + m.gcbc, e: -m.gcbe, c: -m.gcbc };
    const rowB = { b: m.gbbe + m.gbbc, e: -m.gbbe, c: -m.gbbc };
    const rowE = { b: -(rowC.b + rowB.b), e: -(rowC.e + rowB.e), c: -(rowC.c + rowB.c) };
    const nodes = { b: e.b, e: e.e, c: e.c };
    // anchored at limited junction voltages: use Vb0=vbe*p.. choose Ve0=0 reference consistently
    const V0 = { e: 0, b: p * vbe, c: p * (vbe - vbc) };
    const stampRow = (row: number, coef: { b: number; e: number; c: number }, I0: number) => {
      if (row < 0) return;
      let sum = 0;
      for (const key of ['b', 'e', 'c'] as const) {
        const col = nodes[key];
        sum += coef[key] * V0[key];
        if (col >= 0) A[row * n + col] += coef[key];
      }
      z[row] -= I0 - sum;
    };
    stampRow(e.c, rowC, Ic0);
    stampRow(e.b, rowB, Ib0);
    stampRow(e.e, rowE, -(Ic0 + Ib0));
  }

  private mosEval(e: ME, vg: number, vd: number, vs: number) {
    const p = e.p;
    let vgs = p * (vg - vs), vds = p * (vd - vs);
    let swapped = false;
    if (vds < 0) { swapped = true; vgs = p * (vg - vd); vds = p * (vs - vd); }
    const { i, gm, gds } = level1(vgs, vds, e.vth, e.kk, e.lam);
    // current into drain pin and derivatives wrt (vg, vd, vs)
    if (!swapped) return { id: p * i, dg: gm, dd: gds, ds: -(gm + gds) };
    return { id: -p * i, dg: -gm, dd: gm + gds, ds: -gds };
  }

  private stampMos(e: ME, A: Float64Array, z: Float64Array, n: number): void {
    const vg = this.v(this.x, e.g), vd = this.v(this.x, e.d), vs = this.v(this.x, e.s);
    const m = this.mosEval(e, vg, vd, vs);
    const ieq = m.id - (m.dg * vg + m.dd * vd + m.ds * vs);
    const add = (row: number, sgn: number) => {
      if (row < 0) return;
      if (e.g >= 0) A[row * n + e.g] += sgn * m.dg;
      if (e.d >= 0) A[row * n + e.d] += sgn * m.dd;
      if (e.s >= 0) A[row * n + e.s] += sgn * m.ds;
      z[row] -= sgn * ieq;
    };
    add(e.d, 1);
    add(e.s, -1);
  }

  // ------------------------------------------------ Newton
  private newton(mode: Mode, t: number, dt: number, scale: number, gminX: number, trap: boolean, maxIter = 100): boolean {
    const n = this.size;
    if (n === 0) return true;
    for (let it = 0; it < maxIter; it++) {
      const A = new Float64Array(n * n), z = new Float64Array(n);
      this.stamp(A, z, mode, t, dt, scale, gminX, trap);
      const xn = solveDense(A, z, n);
      if (!xn) throw new SimError('singular', 'Matris tekil: gerilim kaynakları/bobinler arasında döngü ya da ideal kısa devre olabilir.');
      let ok = true;
      for (let i = 0; i < n; i++) {
        if (!Number.isFinite(xn[i])) return false;
        const tol = (i < this.nodeN ? 1e-7 : 1e-11) + 1e-6 * Math.max(Math.abs(xn[i]), Math.abs(this.x[i]));
        if (Math.abs(xn[i] - this.x[i]) > tol) { ok = false; break; }
      }
      this.x = xn;
      if (ok && !this.limited) return true;
    }
    return false;
  }

  private resetNonlinear(): void {
    for (const e of this.elems) {
      if (e.k === 'D') e.vLast = 0;
      if (e.k === 'Q') { e.vbeLast = 0; e.vbcLast = 0; }
    }
  }

  private solveOP(mode: Mode): void {
    const attempt = (): boolean => {
      this.x.fill(0); this.resetNonlinear();
      return this.newton(mode, 0, 1, 1, 0, false);
    };
    // constant-power loads have several operating points: ramp the load power from 0 (continuation) so the stable one is found
    if (this.elems.some((e) => e.k === 'W')) {
      this.x.fill(0); this.resetNonlinear();
      let ok = true;
      for (let k = 0; k <= 20 && ok; k++) { this.wScale = k / 20; ok = this.newton(mode, 0, 1, 1, 0, false, 150); }
      this.wScale = 1;
      if (ok) return;
    } else if (attempt()) return;
    // source stepping
    this.x.fill(0); this.resetNonlinear();
    let okSS = true;
    for (let s = 1; s <= 20; s++) {
      if (!this.newton(mode, 0, 1, s / 20, 0, false, 150)) { okSS = false; break; }
    }
    if (okSS) return;
    // gmin stepping
    this.x.fill(0); this.resetNonlinear();
    for (let g = 1e-2; g >= 1e-13; g /= 10) {
      if (!this.newton(mode, 0, 1, 1, g, false, 150)) throw new SimError('noconverge', 'DC çözüm yakınsamadı (gmin stepping başarısız).');
    }
    if (!this.newton(mode, 0, 1, 1, 0, false, 150)) throw new SimError('noconverge', 'DC çözüm yakınsamadı.');
  }

  // ------------------------------------------------ public API
  /** DC operating point (sources at t=0, caps open, inductors shorted). */
  solveDC(): void {
    this.solveOP('dc');
    this.settleRelays('dc');
    this.t = 0;
    this.captureStates(true);
  }

  /** Prepare transient state at t = 0. */
  init(): void {
    this.stepCount = 0;
    if (this.initMode === 'ic') {
      this.solveOP('ic');
      for (const e of this.elems) {
        if (e.k === 'C') { e.vPrev = e.esr > 0 ? e.v0 : this.v(this.x, e.a) - this.v(this.x, e.b); e.iPrev = 0; }
        if (e.k === 'L') { e.vPrev = this.v(this.x, e.a) - this.v(this.x, e.b); e.iPrev = 0; }
        if (e.k === 'ES') this.escStep(e);
      }
    } else {
      this.solveOP('dc');
      this.settleRelays('dc');
      this.captureStates(true);
    }
    this.t = 0;
    this.lastSrc = this.srcSnapshot(0);
  }

  /** DC analysis: relays take their final position immediately (no delay) and the circuit is re-solved. */
  private settleRelays(mode: Mode): void {
    for (let k = 0; k < 3; k++) {
      let changed = false;
      for (const e of this.elems) if (e.k === 'RY' && this.relayStep(e, 0, true)) changed = true;
      if (!changed) return;
      this.solveOP(mode);
    }
  }

  /** arc voltage of contact q (0 = NO, 1 = NC) at time t: ignition value + gap growth since the arc started */
  private arcVoltage(e: RYE, q: number, t: number): number { return ARC_V0 + ARC_DVDT * Math.max(t - e.arT0[q], 0); }

  /** mechanical state of contact q at time t: conductive?, and its conductance (bounce segments, constriction resistance) */
  private contactState(e: RYE, q: 0 | 1, t: number): { closed: boolean; g: number } {
    const steady = e.force ? (q === 0 ? e.force === 'closed' : e.force === 'open') : q === 0 ? e.on : !e.on;
    if (!steady) return { closed: false, g: 1 / R_OFF };
    const seg = e.seg[q], bs = e.bs[q];
    if (e.force || bs < 0 || seg.length === 0) return { closed: true, g: 1 / RY_ON };
    const B = seg[seg.length - 1], s = t - bs;
    if (s >= B - RY_EPS) return { closed: true, g: 1 / RY_ON };
    let k = 0;
    while (k < seg.length && seg[k] <= s + RY_EPS) k++;
    if (k % 2 === 1) return { closed: false, g: 1 / R_OFF }; // bounce: contact re-opened
    return { closed: true, g: 1 / (RY_ON + RY_BOUNCE_R0 * Math.max(1 - s / B, 0)) };
  }

  private applyRelay(e: RYE, t = this.t): void {
    for (const q of [0, 1] as const) {
      const st = this.contactState(e, q, t);
      (q === 0 ? e.no : e.nc).g = st.g;
      e.cl[q] = st.closed;
    }
  }

  /** time of the next bounce segment edge after the current time (Infinity if none): steps are split there */
  private nextBounceEdge(): number {
    let best = Infinity;
    for (const e of this.elems) {
      if (e.k !== 'RY' || e.force) continue;
      for (const q of [0, 1] as const) {
        if (e.bs[q] < 0) continue;
        for (const off of e.seg[q]) { const tt = e.bs[q] + off; if (tt > this.t + RY_EPS && tt < best) best = tt; }
      }
    }
    return best;
  }

  /** returns true when the armature position changed; a transition at a real time (not instant/DC) starts the bounce of the making contact */
  private relayStep(e: RYE, dt: number, instant: boolean, tNow = this.t): boolean {
    if (e.force) return false;
    const i = Math.abs(this.x[this.nodeN + e.br]);
    let changed = false;
    if (!e.on) {
      if (i >= e.ipull) { e.timer += dt; if (instant || e.timer >= e.top) { e.on = true; e.timer = 0; changed = true; } } else e.timer = 0;
    } else if (i <= e.idrop) { e.timer += dt; if (instant || e.timer >= e.trel) { e.on = false; e.timer = 0; changed = true; } } else e.timer = 0;
    if (changed) {
      const mk = e.on ? 0 : 1;
      e.bs = [-1, -1]; e.seg = [[], []];
      if (!instant && e.bounce > 0 && e.nb > 0) {
        e.bs[mk] = tNow;
        e.seg[mk] = bounceSequence((e.seed ^ Math.imul(++e.ev, 0x9e3779b9)) >>> 0, e.bounce, e.nb);
      }
      this.applyRelay(e, tNow);
    }
    return changed;
  }

  /** Relay bookkeeping after an accepted transient step that ended at tNew: arcs, coil thresholds, bounce, arc ignition. */
  private relayAdvance(e: RYE, dt: number, tNew: number): void {
    const V = (n: number) => this.v(this.x, n);
    // 1. arcs that were conducting during this step: energy, wear counters, extinction
    for (const q of [0, 1] as const) {
      if (!e.ar[q]) continue;
      const c = q === 0 ? e.no : e.nc;
      const v = V(c.a) - V(c.b);
      const i = Math.abs(arcEval(this.arcVoltage(e, q, tNew), v).i);
      const en = Math.abs(v) * i * dt;
      e.arcEnergy += en;
      if (i >= ARC_IMIN) e.arStruck[q] = true;
      if (i < ARC_IFLOOR || tNew - e.arT0[q] > ARC_TMAX) { if (e.arStruck[q]) e.arcN++; e.ar[q] = false; }
    }
    // 2. contact currents at the end of the step (state used by the step), then coil logic
    const iC: [number, number] = [Math.abs((V(e.no.a) - V(e.no.b)) * e.no.g), Math.abs((V(e.nc.a) - V(e.nc.b)) * e.nc.g)];
    const was: [boolean, boolean] = [e.cl[0], e.cl[1]];
    this.relayStep(e, dt, false, tNew);
    // 3. new contact states at tNew; opening edges may ignite an arc, re-openings inside a bounce window are counted
    for (const q of [0, 1] as const) {
      const st = this.contactState(e, q, tNew);
      if (was[q] && !st.closed) {
        const steady = q === 0 ? e.on : !e.on;
        if (steady && e.bs[q] >= 0) e.bounces++;
        if (e.arcOn && !e.force && iC[q] > ARC_IMIN && !e.ar[q]) { e.ar[q] = true; e.arT0[q] = tNew; e.arStruck[q] = false; }
      }
      if (e.bs[q] >= 0 && e.seg[q].length && tNew >= e.bs[q] + e.seg[q][e.seg[q].length - 1] - RY_EPS) e.bs[q] = -1;
    }
    this.applyRelay(e, tNew);
  }

  private captureStates(dc: boolean): void {
    for (const e of this.elems) {
      if (e.k === 'C') { e.vPrev = this.v(this.x, e.a) - this.v(this.x, e.b); e.iPrev = 0; }
      if (e.k === 'L') { e.iPrev = this.x[this.nodeN + e.br]; e.vPrev = dc ? 0 : this.v(this.x, e.a) - this.v(this.x, e.b); }
      if (e.k === 'MO') { e.iPrev = this.x[this.nodeN + e.br]; e.wPrev = this.x[this.nodeN + e.br2]; }
      if (e.k === 'TR') { e.i1Prev = this.x[this.nodeN + e.br]; e.i2Prev = this.x[this.nodeN + e.br2]; }
      if (e.k === 'ST') { e.iAPrev = this.x[this.nodeN + e.br]; e.iBPrev = this.x[this.nodeN + e.br2]; e.wPrev = this.x[this.nodeN + e.br3]; }
      if (e.k === 'SV') { e.vSigPrev = this.v(this.x, e.sig) - this.v(this.x, e.gnd); e.high = e.vSigPrev > SV_VTH; }
      if (e.k === 'RY') e.iPrev = this.x[this.nodeN + e.br];
      if (e.k === 'BL') { for (let p = 0; p < 3; p++) e.iPrev[p] = this.x[this.nodeN + e.br + p]; e.wPrev = this.x[this.nodeN + e.br + 3]; }
      if (e.k === 'SO') e.iPrev = this.x[this.nodeN + e.br];
    }
    for (const e of this.elems) if (e.k === 'ES') this.escStep(e);
  }

  /** ESC control after an accepted step: throttle -> duty, rotor angle of the attached motor -> six-step sector. */
  private escStep(e: ESE): void {
    const vcc = this.v(this.x, e.vcc) - this.v(this.x, e.gnd), vs = this.v(this.x, e.sig) - this.v(this.x, e.gnd);
    const thr = Math.min(Math.max(vs / ESC_VTHR, 0), 1);
    const on = vcc >= e.vmin && vs >= ESC_VDEAD && !!e.motor;
    e.duty = on ? thr : 0;
    if (!on) { e.mode = [0, 0, 0]; return; }
    const th = e.motor!.pp * e.motor!.th + e.adv;
    const TP = 2 * Math.PI;
    const f = ((((th - Math.PI / 6) % TP) + TP) % TP);
    const k = Math.min(Math.floor(f / (Math.PI / 3)), 5);
    e.sector = k;
    const m: [number, number, number] = [0, 0, 0];
    m[SIX_STEP[k][0]] = 2; m[SIX_STEP[k][1]] = 1;
    e.mode = m;
  }

  /** Servo behaviour after an accepted step ending at tNew: pulse-width capture, slewing, supply-load update. */
  private servoStep(e: SVE, dt: number, tNew: number): void {
    const vcc = this.v(this.x, e.vcc) - this.v(this.x, e.gnd), vs = this.v(this.x, e.sig) - this.v(this.x, e.gnd);
    const powered = vcc >= SV_VMIN;
    const hi = vs > SV_VTH;
    if (hi !== e.high) {
      // interpolate the threshold crossing between the previous and the new sample
      const f = vs !== e.vSigPrev ? Math.min(Math.max((SV_VTH - e.vSigPrev) / (vs - e.vSigPrev), 0), 1) : 1;
      const tEdge = tNew - dt + dt * f;
      if (hi) e.tRise = tEdge;
      else if (e.tRise >= 0) {
        const wd = tEdge - e.tRise;
        if (powered && wd >= 0.3e-3 && wd <= 3e-3) { e.pulse = wd; e.target = Math.min(Math.max(((wd - 1e-3) / 1e-3) * 180, 0), 180); }
        e.tRise = -1;
      }
      e.high = hi;
    }
    e.vSigPrev = vs;
    const d = e.target - e.angle;
    if (powered && !e.blocked) { const m = e.speed * dt; e.angle += Math.min(Math.max(d, -m), m); }
    e.moving = powered && Math.abs(e.target - e.angle) > 1e-3;
    e.load.g = (e.moving ? (e.blocked ? e.is : e.im) : e.ii) / SV_VNOM;
  }

  private snapshot() {
    return {
      x: Float64Array.from(this.x),
      s: this.elems.map((e) => (e.k === 'C' || e.k === 'L' ? [e.vPrev, e.iPrev] : e.k === 'D' ? [e.vLast] : e.k === 'Q' ? [e.vbeLast, e.vbcLast] : e.k === 'MO' ? [e.iPrev, e.wPrev] : e.k === 'ST' ? [e.iAPrev, e.iBPrev, e.wPrev, e.th] : e.k === 'SV' ? [e.angle, e.target, e.high ? 1 : 0, e.tRise, e.vSigPrev, e.pulse, e.moving ? 1 : 0, e.load.g] : e.k === 'TR' ? [e.i1Prev, e.i2Prev] : e.k === 'RY' ? [e.iPrev, e.on ? 1 : 0, e.timer] : e.k === 'BL' ? [...e.iPrev, e.wPrev, e.th] : e.k === 'SO' ? [e.iPrev, e.xPrev, e.vPrev] : e.k === 'ES' ? [e.duty, ...e.mode, e.sector] : [])),
    };
  }
  private restore(sn: ReturnType<Sim['snapshot']>): void {
    this.x = Float64Array.from(sn.x);
    this.elems.forEach((e, i) => {
      const s = sn.s[i];
      if (e.k === 'C' || e.k === 'L') { e.vPrev = s[0]; e.iPrev = s[1]; }
      else if (e.k === 'D') e.vLast = s[0];
      else if (e.k === 'Q') { e.vbeLast = s[0]; e.vbcLast = s[1]; }
      else if (e.k === 'MO') { e.iPrev = s[0]; e.wPrev = s[1]; }
      else if (e.k === 'ST') { e.iAPrev = s[0]; e.iBPrev = s[1]; e.wPrev = s[2]; e.th = s[3]; }
      else if (e.k === 'SV') { e.angle = s[0]; e.target = s[1]; e.high = s[2] === 1; e.tRise = s[3]; e.vSigPrev = s[4]; e.pulse = s[5]; e.moving = s[6] === 1; e.load.g = s[7]; }
      else if (e.k === 'TR') { e.i1Prev = s[0]; e.i2Prev = s[1]; }
      else if (e.k === 'RY') { e.iPrev = s[0]; e.on = s[1] === 1; e.timer = s[2]; this.applyRelay(e); }
      else if (e.k === 'BL') { e.iPrev = [s[0], s[1], s[2]]; e.wPrev = s[3]; e.th = s[4]; }
      else if (e.k === 'SO') { e.iPrev = s[0]; e.xPrev = s[1]; e.vPrev = s[2]; }
      else if (e.k === 'ES') { e.duty = s[0]; e.mode = [s[1], s[2], s[3]]; e.sector = s[4]; }
    });
  }

  private tryStep(dt: number): boolean {
    const tNew = this.t + dt;
    const src = this.srcSnapshot(tNew);
    let jump = false;
    for (let i = 0; i < src.length; i++) {
      const e = this.vsrcs[i];
      const span = Math.abs(e.amp) + Math.abs(e.v) + 1e-9;
      if (Math.abs(src[i] - (this.lastSrc[i] ?? src[i])) > 0.1 * span) { jump = true; break; }
    }
    const trap = this.method === 'trap' && this.stepCount > 0 && !jump;
    if (!this.newton('tran', tNew, dt, 1, 0, trap)) return false;
    for (const e of this.elems) {
      if (e.k === 'C') {
        const v = this.v(this.x, e.a) - this.v(this.x, e.b);
        const geq = (trap ? 2 : 1) * e.c / dt;
        const i = (geq * (v - e.vPrev) - (trap ? e.iPrev : 0)) / (1 + geq * e.esr);
        e.vPrev = v - i * e.esr; e.iPrev = i;
      } else if (e.k === 'L') {
        e.vPrev = this.v(this.x, e.a) - this.v(this.x, e.b);
        e.iPrev = this.x[this.nodeN + e.br];
      } else if (e.k === 'MO') {
        e.iPrev = this.x[this.nodeN + e.br]; e.wPrev = this.x[this.nodeN + e.br2];
      } else if (e.k === 'ST') {
        e.iAPrev = this.x[this.nodeN + e.br]; e.iBPrev = this.x[this.nodeN + e.br2];
        const w = this.x[this.nodeN + e.br3];
        e.th += w * dt; e.wPrev = w;
      } else if (e.k === 'SV') {
        this.servoStep(e, dt, tNew);
      } else if (e.k === 'TR') {
        e.i1Prev = this.x[this.nodeN + e.br]; e.i2Prev = this.x[this.nodeN + e.br2];
      } else if (e.k === 'RY') {
        e.iPrev = this.x[this.nodeN + e.br];
        this.relayAdvance(e, dt, tNew);
      } else if (e.k === 'BL') {
        for (let p = 0; p < 3; p++) e.iPrev[p] = this.x[this.nodeN + e.br + p];
        const w = this.x[this.nodeN + e.br + 3];
        e.th += w * dt; e.wPrev = w;
      } else if (e.k === 'SO') {
        const ri = this.nodeN + e.br;
        let xs = this.x[ri + 1], vs = this.x[ri + 2];
        if (e.jam) { xs = e.xPrev; vs = 0; }
        else {
          if (xs < 0) { xs = 0; if (vs < 0) vs = 0; }
          if (xs > e.xmax) { xs = e.xmax; if (vs > 0) vs = 0; }
        }
        this.x[ri + 1] = xs; this.x[ri + 2] = vs;
        e.iPrev = this.x[ri]; e.xPrev = xs; e.vPrev = vs;
      }
    }
    for (const e of this.elems) if (e.k === 'ES') this.escStep(e);
    this.t = tNew;
    this.lastSrc = src;
    this.stepCount++;
    return true;
  }

  /** Advance the transient solution by dt (halves the step if Newton fails). */
  step(dt: number, depth = 0): void {
    // relay contact bounce edges are discontinuities: end a step exactly on the next edge, then continue
    const tEnd = this.t + dt, edge = this.nextBounceEdge();
    if (edge < tEnd - RY_EPS) { this.step(edge - this.t, depth); this.step(tEnd - this.t, depth); return; }
    const sn = this.snapshot();
    if (this.tryStep(dt)) return;
    this.restore(sn);
    if (depth >= 6) throw new SimError('noconverge', `Geçici analiz t=${this.t.toExponential(3)} s anında yakınsamadı.`);
    this.step(dt / 2, depth + 1);
    this.step(dt / 2, depth + 1);
  }

  /** Carry node voltages and reactive-element state over from a previous Sim of an edited circuit. */
  adopt(old: Sim): void {
    this.t = old.t; // relay contact state depends on absolute time
    for (const [pin, net] of this.nets.pinNet) {
      const on = old.nets.pinNet.get(pin);
      if (on !== undefined && net > 0) this.x[net - 1] = old.nodeVoltage(on);
    }
    const oldMech = new Map<string, Elem>();
    for (const e of old.elems) if (e.k === 'MO' || e.k === 'TR' || e.k === 'RY' || e.k === 'ST' || e.k === 'SV' || e.k === 'BL' || e.k === 'SO' || e.k === 'ES') oldMech.set(e.owner, e);
    for (const e of this.elems) {
      const o = oldMech.get(e.owner);
      if (!o || o.k !== e.k) continue;
      if (e.k === 'ST' && o.k === 'ST') {
        e.iAPrev = o.iAPrev; e.iBPrev = o.iBPrev; e.wPrev = o.wPrev; e.th = o.th;
        this.x[this.nodeN + e.br] = o.iAPrev; this.x[this.nodeN + e.br2] = o.iBPrev; this.x[this.nodeN + e.br3] = o.wPrev;
      }
      if (e.k === 'SV' && o.k === 'SV') { e.angle = o.angle; e.target = o.target; e.high = o.high; e.tRise = o.tRise; e.vSigPrev = o.vSigPrev; e.pulse = o.pulse; e.moving = o.moving; e.load.g = o.load.g; }
      if (e.k === 'MO' && o.k === 'MO') { e.iPrev = o.iPrev; e.wPrev = o.wPrev; this.x[this.nodeN + e.br] = o.iPrev; this.x[this.nodeN + e.br2] = o.wPrev; }
      if (e.k === 'BL' && o.k === 'BL') {
        e.iPrev = [...o.iPrev]; e.wPrev = o.wPrev; e.th = o.th;
        for (let p = 0; p < 3; p++) this.x[this.nodeN + e.br + p] = o.iPrev[p];
        this.x[this.nodeN + e.br + 3] = o.wPrev;
      }
      if (e.k === 'SO' && o.k === 'SO') {
        e.iPrev = o.iPrev; e.xPrev = o.xPrev; e.vPrev = o.vPrev;
        this.x[this.nodeN + e.br] = o.iPrev; this.x[this.nodeN + e.br + 1] = o.xPrev; this.x[this.nodeN + e.br + 2] = o.vPrev;
      }
      if (e.k === 'ES' && o.k === 'ES') { e.duty = o.duty; e.mode = [...o.mode]; e.sector = o.sector; }
      if (e.k === 'TR' && o.k === 'TR') { e.i1Prev = o.i1Prev; e.i2Prev = o.i2Prev; this.x[this.nodeN + e.br] = o.i1Prev; this.x[this.nodeN + e.br2] = o.i2Prev; }
      if (e.k === 'RY' && o.k === 'RY') {
        e.iPrev = o.iPrev; e.on = o.on; e.timer = o.timer; this.x[this.nodeN + e.br] = o.iPrev;
        e.bs = [...o.bs]; e.seg = [[...o.seg[0]], [...o.seg[1]]]; e.ar = [...o.ar]; e.arT0 = [...o.arT0]; e.arStruck = [...o.arStruck]; e.ev = o.ev;
        e.arcN = o.arcN; e.arcEnergy = o.arcEnergy; e.bounces = o.bounces;
        this.applyRelay(e);
      }
    }
    const prev = new Map<string, CE | LE>();
    for (const e of old.elems) if (e.k === 'C' || e.k === 'L') prev.set(e.owner, e);
    for (const e of this.elems) {
      if (e.k !== 'C' && e.k !== 'L') continue;
      const o = prev.get(e.owner);
      if (!o || o.k !== e.k) continue;
      e.vPrev = o.vPrev; e.iPrev = o.iPrev;
      if (e.k === 'L') this.x[this.nodeN + e.br] = o.iPrev;
    }
    this.t = old.t;
    this.stepCount = 0;
    this.lastSrc = this.srcSnapshot(this.t);
  }

  /**
   * Small-signal AC solution at frequency f (Hz), linearised around the CURRENT solution (call solveDC() first).
   * Independent sources are AC-dead (V = short, I = open) except the stimulus. Device models are the same generic
   * ones as in DC (no junction capacitances): results are valid where those are negligible.
   */
  acAt(f: number, stim: AcStim): { re: Float64Array; im: Float64Array } {
    const n = this.size, N = this.nodeN, w = 2 * Math.PI * f;
    const Ar = new Float64Array(n * n), Ai = new Float64Array(n * n), zr = new Float64Array(n), zi = new Float64Array(n);
    const G = (i: number, j: number, re: number, im = 0) => { if (i >= 0 && j >= 0) { Ar[i * n + j] += re; Ai[i * n + j] += im; } };
    const cond = (a: number, b: number, re: number, im = 0) => { G(a, a, re, im); G(b, b, re, im); G(a, b, -re, -im); G(b, a, -re, -im); };
    for (let i = 0; i < N; i++) Ar[i * n + i] += this.gmin;
    const x = this.x;
    const vv = (k: number) => this.v(x, k);
    for (const e of this.elems) {
      switch (e.k) {
        case 'R': cond(e.a, e.b, e.g); break;
        case 'T': if (e.g > 0) cond(e.a, e.ref, e.g); break;
        case 'I': if (stim.isrc === e.owner) { if (e.a >= 0) zr[e.a] += 1; if (e.b >= 0) zr[e.b] -= 1; } break;
        case 'V': {
          const r = N + e.br;
          G(e.a, r, 1); G(e.b, r, -1); G(r, e.a, 1); G(r, e.b, -1);
          if (stim.vsrc === e.owner) zr[r] += 1;
          break;
        }
        case 'C': { const r = N + e.br; const q = w * e.c * e.esr; cond(e.a, e.b, w * e.c * q / (1 + q * q), w * e.c / (1 + q * q)); Ar[r * n + r] += 1; break; }
        case 'L': {
          const r = N + e.br;
          G(e.a, r, 1); G(e.b, r, -1); G(r, e.a, 1); G(r, e.b, -1);
          Ai[r * n + r] -= w * (e.ik > 0 ? ldSat(e.l, e.ik, x[r]) : e.l); // L_d at the DC operating point
          break;
        }
        case 'D': {
          const nvt = e.n * VT, vd = vv(e.a) - vv(e.b);
          let g = e.role === 'rev' ? 0 : (e.is / nvt) * expl(vd / nvt);
          if (e.role === 'zener' || e.role === 'rev') g += (IBV / VT) * expl(-(vd + e.vz) / VT);
          cond(e.a, e.b, g + this.gmin);
          break;
        }
        case 'Q': {
          const p = e.p;
          const vb = vv(e.b), ve = vv(e.e), vc = vv(e.c);
          const m = this.bjtEval(e, p * (vb - ve), p * (vb - vc));
          const rowC = { b: m.gcbe + m.gcbc, e: -m.gcbe, c: -m.gcbc };
          const rowB = { b: m.gbbe + m.gbbc, e: -m.gbbe, c: -m.gbbc };
          const rowE = { b: -(rowC.b + rowB.b), e: -(rowC.e + rowB.e), c: -(rowC.c + rowB.c) };
          for (const [row, coef] of [[e.c, rowC], [e.b, rowB], [e.e, rowE]] as const) { G(row, e.b, coef.b); G(row, e.e, coef.e); G(row, e.c, coef.c); }
          break;
        }
        case 'M': {
          const m = this.mosEval(e, vv(e.g), vv(e.d), vv(e.s));
          for (const [row, sg] of [[e.d, 1], [e.s, -1]] as const) { G(row, e.g, sg * m.dg); G(row, e.d, sg * m.dd); G(row, e.s, sg * m.ds); }
          break;
        }
        case 'MO': {
          const ri = N + e.br, rw = N + e.br2;
          G(e.a, ri, 1); G(e.b, ri, -1); G(ri, e.a, 1); G(ri, e.b, -1);
          Ar[ri * n + ri] -= e.r; Ai[ri * n + ri] -= w * e.l; Ar[ri * n + rw] -= e.ke;
          const om = x[rw];
          const th = e.tl > 0 ? Math.tanh(om / WT) : 0;
          const fp = e.tl > 0 ? (e.tl * (1 - th * th)) / WT : 0;
          Ar[rw * n + rw] += e.bf + fp; Ai[rw * n + rw] += w * e.j; Ar[rw * n + ri] -= e.ke;
          break;
        }
        case 'ST': {
          // small-signal at the current (frozen) rotor angle and w = 0 operating point
          const rA = N + e.br, rB = N + e.br2, rw = N + e.br3;
          G(e.a1, rA, 1); G(e.b1, rA, -1); G(rA, e.a1, 1); G(rA, e.b1, -1);
          G(e.a2, rB, 1); G(e.b2, rB, -1); G(rB, e.a2, 1); G(rB, e.b2, -1);
          const sA = Math.sin(e.nr * e.th), cB = Math.cos(e.nr * e.th);
          Ar[rA * n + rA] -= e.r; Ai[rA * n + rA] -= w * e.l; Ar[rA * n + rw] += e.ke * sA;
          Ar[rB * n + rB] -= e.r; Ai[rB * n + rB] -= w * e.l; Ar[rB * n + rw] -= e.ke * cB;
          Ar[rw * n + rw] += e.bf; Ai[rw * n + rw] += w * e.jt; Ar[rw * n + rA] += e.ke * sA; Ar[rw * n + rB] -= e.ke * cB;
          break;
        }
        case 'BL': {
          // small-signal at the current (frozen) rotor angle and w = 0 operating point, like the stepper
          const rI = [N + e.br, N + e.br + 1, N + e.br + 2], rw = N + e.br + 3, rn = N + e.br + 4;
          const nd = [e.u, e.v, e.w];
          const sh = bldcShapes(e.pp * e.th);
          for (let p = 0; p < 3; p++) {
            const r = rI[p];
            G(nd[p], r, 1);
            if (e.open === p + 1) { Ar[r * n + r] += 1; Ar[rn * n + r] += 1; continue; }
            G(r, nd[p], 1);
            Ar[r * n + rn] -= 1; Ar[r * n + r] -= e.r; Ai[r * n + r] -= w * e.l; Ar[r * n + rw] -= e.ke * sh[p];
            Ar[rw * n + r] -= e.ke * sh[p]; Ar[rn * n + r] += 1;
          }
          Ar[rw * n + rw] += e.bf; Ai[rw * n + rw] += w * e.j;
          break;
        }
        case 'ES': {
          const D = e.duty;
          for (let p = 0; p < 3; p++) {
            const o = e.o[p], m = e.mode[p];
            if (m === 1) cond(o, e.gnd, 1 / ESC_RON);
            else if (m === 2) {
              const g = 1 / ESC_RON;
              G(o, o, g); G(o, e.gnd, -g * (1 - D)); G(o, e.vcc, -g * D);
              G(e.vcc, o, -D * g); G(e.vcc, e.gnd, D * (1 - D) * g); G(e.vcc, e.vcc, D * D * g);
              G(e.gnd, o, -(1 - D) * g); G(e.gnd, e.gnd, (1 - D) * (1 - D) * g); G(e.gnd, e.vcc, (1 - D) * D * g);
            }
          }
          break;
        }
        case 'SO': {
          // coil R + jwL(x) at the frozen plunger position; mechanical coupling is neglected in small signal
          const ri = N + e.br, rx = N + e.br + 1, rv = N + e.br + 2;
          G(e.a, ri, 1); G(e.b, ri, -1); G(ri, e.a, 1); G(ri, e.b, -1);
          Ar[ri * n + ri] -= e.r; Ai[ri * n + ri] -= w * (e.l0 + e.g * x[rx]);
          Ar[rx * n + rx] += 1; Ar[rv * n + rv] += 1;
          break;
        }
        case 'RY': {
          const ri = N + e.br;
          G(e.a, ri, 1); G(e.b, ri, -1); G(ri, e.a, 1); G(ri, e.b, -1);
          Ar[ri * n + ri] -= e.r; Ai[ri * n + ri] -= w * e.l;
          break;
        }
        case 'TR': {
          const r1 = N + e.br, r2 = N + e.br2;
          G(e.p1, r1, 1); G(e.p2, r1, -1); G(r1, e.p1, 1); G(r1, e.p2, -1);
          G(e.s1, r2, 1); G(e.s2, r2, -1); G(r2, e.s1, 1); G(r2, e.s2, -1);
          Ar[r1 * n + r1] -= e.r1; Ai[r1 * n + r1] -= w * e.l1; Ai[r1 * n + r2] -= w * e.m;
          Ai[r2 * n + r1] -= w * e.m; Ar[r2 * n + r2] -= e.r2; Ai[r2 * n + r2] -= w * e.l2;
          break;
        }
        case 'W': { const v = vv(e.a) - vv(e.b); if (v > 0.5) cond(e.a, e.b, -e.p / (v * v)); break; }
      }
    }
    if (stim.port) {
      if (stim.port.a > 0) zr[stim.port.a - 1] += 1;
      if (stim.port.b > 0) zr[stim.port.b - 1] -= 1;
    }
    const sol = solveComplex(Ar, Ai, zr, zi, n);
    if (!sol) throw new SimError('singular', 'AC matrisi tekil: devrede kaynak döngüsü veya bağlantısız düğüm olabilir.');
    return sol;
  }

  /** MCU pin electrical drive: out high/low through rOut, pullup through rPullup, input = high impedance */
  setPinDrive(owner: string, pin: string, drive: { mode: 'in' | 'out' | 'pullup'; high: boolean } | null, spec: { vcc: number; rOutHigh: number; rOutLow: number; rPullup: number }): void {
    const e = (this.byOwner.get(owner) ?? []).find((x): x is TE => x.k === 'T' && x.kind === 'gpio' && x.pin === pin);
    if (!e) return;
    if (!drive || drive.mode === 'in' || this.deadPins.has(`${owner}:${pin}`)) { e.g = 0; e.vs = 0; return; }
    if (drive.mode === 'pullup') { e.g = 1 / spec.rPullup; e.vs = spec.vcc; return; }
    e.vs = drive.high ? spec.vcc : 0;
    e.g = 1 / (drive.high ? spec.rOutHigh : spec.rOutLow);
  }

  killPin(owner: string, pin: string): void {
    this.deadPins.add(`${owner}:${pin}`);
    const e = (this.byOwner.get(owner) ?? []).find((x): x is TE => x.k === 'T' && x.kind === 'gpio' && x.pin === pin);
    if (e) { e.g = 0; e.vs = 0; }
  }

  /** current through each virtual meter, positive from probe a to probe b (same order as opts.meters, skipping invalid ones) */
  meterCurrents(): { id: string; i: number }[] {
    return this.meterElems.map(({ e, spec }) => ({ id: spec.id, i: (this.v(this.x, e.a) - this.v(this.x, e.b)) * e.g }));
  }

  /** blow a meter fuse: the instrument becomes an open circuit */
  openMeter(id: string): void {
    const m = this.meterElems.find((q) => q.spec.id === id);
    if (m) m.e.g = 1e-9;
  }

  /** voltage of an MCU pin relative to the board ground */
  pinVoltage(owner: string, pin: string): number {
    const e = (this.byOwner.get(owner) ?? []).find((x): x is TE => x.k === 'T' && x.pin === pin);
    if (e) return this.v(this.x, e.a) - this.v(this.x, e.ref);
    return 0;
  }

  private gNow(e: RE): number { if (e.dyn) return e.dyn(this.t); return e.inter && (this.t * e.inter) % 1 >= 0.5 ? 1e-9 : e.g; }

  nodeVoltage(net: number): number { return net === 0 ? 0 : this.x[net - 1]; }
  netOf(comp: string, pin: string): number { return this.nets.pinNet.get(`${comp}:${pin}`)!; }

  netVoltages(): number[] {
    return Array.from({ length: this.nets.netCount }, (_, i) => this.nodeVoltage(i));
  }

  /** Per-component operating values at the current solution. */
  results(): Record<string, CompResult> {
    const out: Record<string, CompResult> = {};
    const x = this.x;
    const N = this.nodeN;
    for (const c of this.circuit.components) {
      const def = getDef(c.type);
      const es = this.byOwner.get(c.id) ?? [];
      const V = (n: number) => this.v(x, n);
      let r: CompResult = { v: 0, i: 0, p: 0, vals: {} };
      const flt = this.faults[c.id];
      if (flt && (flt.kind === 'open' || flt.kind === 'short') && def.model !== 'ground' && def.model !== 'none') {
        const [pa, pb] = mainPins(def.model);
        const v = this.nodeVoltage(this.netOf(c.id, pa)) - this.nodeVoltage(this.netOf(c.id, pb));
        const e = es.find((q) => q.k === 'R') as RE | undefined;
        const i = e ? v * e.g : 0;
        out[c.id] = { v, i, p: v * i, vals: {} };
        continue;
      }
      switch (def.model) {
        case 'resistor': case 'switch': {
          const e = es[0] as RE; const g = this.gNow(e); const v = V(e.a) - V(e.b); const i = v * g;
          r = { v, i, p: v * i, vals: {} }; break;
        }
        case 'pot': {
          const a = es[0] as RE, b = es[1] as RE;
          const i1 = (V(a.a) - V(a.b)) * a.g, i2 = (V(b.a) - V(b.b)) * b.g;
          r = { v: V(a.a) - V(b.b), i: i1, p: (V(a.a) - V(a.b)) * i1 + (V(b.a) - V(b.b)) * i2, vals: { iAW: i1, iWB: i2, iW: i1 - i2 } }; break;
        }
        case 'capacitor': {
          const e = es[0] as CE; const v = V(e.a) - V(e.b);
          const rev = es.find((q): q is DE => q.k === 'D'); // reverse-conduction path (reverseVoltage fault)
          const iRev = rev ? -IBV * expl(-(v + rev.vz) / VT) : 0;
          const i = e.iPrev + iRev;
          r = { v, i, p: v * i, vals: { q: e.c * (v - e.esr * e.iPrev), energy: 0.5 * e.c * v * v, ...(rev ? { iRev } : {}) } }; break;
        }
        case 'inductor': {
          const e = es[0] as LE; const v = V(e.a) - V(e.b); const i = x[N + e.br];
          r = e.ik > 0
            ? { v, i, p: v * i, vals: { energy: enSat(e.l, e.ik, i), inductance: ldSat(e.l, e.ik, i) } }
            : { v, i, p: v * i, vals: { energy: 0.5 * e.l * i * i, inductance: e.l } };
          break;
        }
        case 'vsource': {
          const e = es[0] as VE; const v = V(e.a) - V(e.b); const i = x[N + e.br];
          r = { v, i: -i, p: v * i, vals: { eSet: sourceValue(e, this.t) } }; break; // i: delivered current (out of + pin)
        }
        case 'isource': {
          const e = es[0] as IE; const v = V(e.a) - V(e.b);
          r = { v, i: e.i, p: -v * e.i, vals: {} }; break;
        }
        case 'diode': case 'led': case 'zener': {
          const e = es[0] as DE; const v = V(e.a) - V(e.b);
          const nvt = e.n * VT;
          let i = e.is * (expl(v / nvt) - 1) + this.gmin * v;
          if (e.role === 'zener') i -= IBV * expl(-(v + e.vz) / VT);
          r = { v, i, p: v * i, vals: {} }; break;
        }
        case 'npn': case 'pnp': {
          const e = es[0] as QE; const p = e.p;
          const vb = V(e.b), ve = V(e.e), vc = V(e.c);
          const m = this.bjtEval(e, p * (vb - ve), p * (vb - vc));
          const ic = p * m.ic, ib = p * m.ib;
          r = { v: vc - ve, i: ic, p: (vc - ve) * ic + (vb - ve) * ib, vals: { vbe: vb - ve, vce: vc - ve, ic, ib, ie: -(ic + ib), beta: ib !== 0 ? ic / ib : 0 } };
          break;
        }
        case 'nmos': case 'pmos': {
          const e = es[0] as ME; const body = es[1] as DE;
          const vg = V(e.g), vd = V(e.d), vs = V(e.s);
          const m = this.mosEval(e, vg, vd, vs);
          const vbd = V(body.a) - V(body.b);
          const ibody = body.is * (expl(vbd / (body.n * VT)) - 1); // anode->cathode
          const idTotal = m.id + (e.p === 1 ? -ibody : ibody);
          r = { v: vd - vs, i: idTotal, p: (vd - vs) * idTotal, vals: { vgs: vg - vs, vds: vd - vs, id: idTotal } };
          break;
        }
        case 'bridge': {
          const ds = es as DE[];
          const cur = (e: DE) => { const v = V(e.a) - V(e.b); return e.is * (expl(v / (e.n * VT)) - 1) + this.gmin * v; };
          const iOut = cur(ds[0]) + cur(ds[1]);
          r = { v: V(ds[0].b) - V(ds[2].a), i: iOut, p: ds.reduce((a, e) => a + (V(e.a) - V(e.b)) * cur(e), 0), vals: {} };
          break;
        }
        case 'mcu': {
          const vals: Record<string, number> = {};
          let p = 0;
          let first: { v: number; i: number } | null = null;
          for (const e of es) {
            if (e.k !== 'T') continue;
            const v = this.v(x, e.a) - this.v(x, e.ref);
            const i = e.g * (e.vs - v);
            vals[`v_${e.pin}`] = v; vals[`i_${e.pin}`] = i;
            p += -v * i;
            if (e.kind === 'supply' && !first) first = { v, i };
          }
          r = { v: first?.v ?? 0, i: first?.i ?? 0, p, vals };
          break;
        }
        case 'motor': {
          const e = es[0] as MO; const v = V(e.a) - V(e.b); const i = x[N + e.br], w = x[N + e.br2];
          r = { v, i, p: v * i, vals: { omega: w, rpm: (w * 60) / (2 * Math.PI), torque: e.ke * i, pmech: e.ke * i * w, emf: e.ke * w, pcu: i * i * e.r } };
          break;
        }
        case 'stepper': {
          const e = es[0] as STE;
          const vA = V(e.a1) - V(e.b1), vB = V(e.a2) - V(e.b2), iA = x[N + e.br], iB = x[N + e.br2], w = x[N + e.br3];
          const sA = Math.sin(e.nr * e.th), cB = Math.cos(e.nr * e.th);
          const stepDeg = 360 / (e.nr * 4);
          const deg = (e.th * 180) / Math.PI;
          r = {
            v: vA, i: iA, p: vA * iA + vB * iB,
            vals: { angle: deg, steps: deg / stepDeg, omega: w, rpm: (w * 60) / (2 * Math.PI), iA, iB, vB, torque: e.ke * (-iA * sA + iB * cB), emfA: -e.ke * w * sA, emfB: e.ke * w * cB, pcu: (iA * iA + iB * iB) * e.r },
          };
          break;
        }
        case 'bldc': {
          const e = es[0] as BLE;
          const iU = x[N + e.br], iV = x[N + e.br + 1], iW = x[N + e.br + 2], w = x[N + e.br + 3], vn = x[N + e.br + 4];
          const vU = V(e.u), vV = V(e.v), vW = V(e.w);
          const sh = bldcShapes(e.pp * e.th);
          const torque = e.ke * (sh[0] * iU + sh[1] * iV + sh[2] * iW);
          const teDeg = ((((e.pp * e.th * 180) / Math.PI) % 360) + 360) % 360;
          r = {
            v: vU - vV, i: iU, p: vU * iU + vV * iV + vW * iW,
            vals: { omega: w, rpm: (w * 60) / (2 * Math.PI), angle: (e.th * 180) / Math.PI, thetaE: teDeg, iU, iV, iW, vn, torque, pmech: torque * w, emfU: e.ke * w * sh[0], emfV: e.ke * w * sh[1], emfW: e.ke * w * sh[2], pcu: (iU * iU + iV * iV + iW * iW) * e.r },
          };
          break;
        }
        case 'bldc_esc': {
          const e = es.find((q): q is ESE => q.k === 'ES')!;
          const vcc = V(e.vcc) - V(e.gnd), D = e.duty;
          const iPh = [0, 0, 0];
          let iSup = vcc * e.load.g;
          for (let p = 0; p < 3; p++) {
            const m = e.mode[p], vo = V(e.o[p]);
            if (m === 1) iPh[p] = -(vo - V(e.gnd)) / ESC_RON;
            else if (m === 2) { iPh[p] = -(vo - ((1 - D) * V(e.gnd) + D * V(e.vcc))) / ESC_RON; iSup += D * iPh[p]; }
          }
          r = { v: vcc, i: iSup, p: vcc * iSup, vals: { duty: D, throttle: V(e.sig) - V(e.gnd), sector: e.sector, iU: iPh[0], iV: iPh[1], iW: iPh[2], vU: V(e.o[0]), vV: V(e.o[1]), vW: V(e.o[2]), active: e.mode.some((q) => q !== 0) ? 1 : 0 } };
          break;
        }
        case 'solenoid': {
          const e = es[0] as SOE;
          const v = V(e.a) - V(e.b), i = x[N + e.br], xp = x[N + e.br + 1], vel = x[N + e.br + 2];
          const lnow = e.l0 + e.g * xp;
          r = { v, i, p: v * i, vals: { position: xp * 1000, pos: Math.min(Math.max(xp / e.xmax, 0), 1), speed: vel, force: 0.5 * i * i * e.g, inductance: lnow, flux: lnow * i, pcu: i * i * e.r, backEmf: i * e.g * vel } };
          break;
        }
        case 'servo': {
          const e = es[0] as SVE;
          const v = V(e.vcc) - V(e.gnd), i = v * e.load.g;
          r = { v, i, p: v * i, vals: { angle: e.angle, target: e.target, pulse: e.pulse * 1000, moving: e.moving ? 1 : 0, vsig: V(e.sig) - V(e.gnd) } };
          break;
        }
        case 'relay': {
          const e = es[0] as RYE; const v = V(e.a) - V(e.b); const i = x[N + e.br];
          const on = e.force ? e.force === 'closed' : e.on;
          const vNO = V(e.no.a) - V(e.no.b), vNC = V(e.nc.a) - V(e.nc.b);
          const iNO = vNO * e.no.g + (e.ar[0] ? arcEval(this.arcVoltage(e, 0, this.t), vNO).i : 0);
          const iNC = vNC * e.nc.g + (e.ar[1] ? arcEval(this.arcVoltage(e, 1, this.t), vNC).i : 0);
          r = { v, i, p: v * i, vals: { energized: on ? 1 : 0, icontact: Math.max(Math.abs(iNO), Math.abs(iNC)), ino: iNO, inc: iNC, noClosed: e.cl[0] ? 1 : 0, ncClosed: e.cl[1] ? 1 : 0, vno: vNO, vnc: vNC, arc: e.ar[0] || e.ar[1] ? 1 : 0, arcCount: e.arcN, arcEnergy: e.arcEnergy, bounces: e.bounces } };
          break;
        }
        case 'transformer': {
          const e = es[0] as TRE; const v1 = V(e.p1) - V(e.p2), v2 = V(e.s1) - V(e.s2); const i1 = x[N + e.br], i2 = x[N + e.br2];
          r = { v: v1, i: i1, p: v1 * i1 + v2 * i2, vals: { vsec: v2, isec: -i2, pin: v1 * i1, pout: -v2 * i2 } };
          break;
        }
        case 'eload': {
          const e = es[0]; const a = e.k === 'R' || e.k === 'W' ? e.a : e.k === 'I' ? e.b : 0;
          const bb = e.k === 'R' || e.k === 'W' ? e.b : e.k === 'I' ? e.a : 0;
          const v = V(a) - V(bb);
          const i = e.k === 'R' ? v * e.g : e.k === 'W' ? e.p / Math.max(v, 0.5) : e.k === 'I' ? e.i : 0;
          r = { v, i, p: v * i, vals: {} };
          break;
        }
        case 'none': case 'ground': case 'busdev': break;
      }
      out[c.id] = r;
    }
    return out;
  }
}

export interface TransientResult {
  t: number[];
  /** voltage per net index over time */
  netV: number[][];
  netNames: string[];
  comps: Record<string, { v: number[]; i: number[]; p: number[] }>;
  pinNet: Map<string, number>;
}

export function runTransient(circuit: Circuit, o: { stop: number; dt: number } & SimOptions): TransientResult {
  const sim = new Sim(circuit, o);
  sim.init();
  const res: TransientResult = { t: [], netV: sim.nets.names.map(() => []), netNames: sim.nets.names, comps: {}, pinNet: sim.nets.pinNet };
  for (const c of circuit.components) res.comps[c.id] = { v: [], i: [], p: [] };
  const record = () => {
    res.t.push(sim.t);
    sim.netVoltages().forEach((v, i) => res.netV[i].push(v));
    const r = sim.results();
    for (const id in r) { res.comps[id].v.push(r[id].v); res.comps[id].i.push(r[id].i); res.comps[id].p.push(r[id].p); }
  };
  record();
  const steps = Math.round(o.stop / o.dt);
  for (let s = 0; s < steps; s++) { sim.step(o.dt); record(); }
  return res;
}

export function solveDCOnce(circuit: Circuit): { sim: Sim; results: Record<string, CompResult> } {
  const sim = new Sim(circuit);
  sim.solveDC();
  return { sim, results: sim.results() };
}
