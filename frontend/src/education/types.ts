import type { Circuit, Fault, FaultKind } from '../core/circuit/types';

/**
 * Education content schema. Every number a lesson promises ("expects", quiz answers with `verify`) is checked by the
 * solver in unit tests, so lessons cannot drift away from what the simulator really computes.
 */

export type Track = 'temel' | 'analog' | 'dijital' | 'guc' | 'ariza';
export type Level = 'baslangic' | 'orta' | 'ileri';

/** What to measure. */
export type Probe =
  | { q: 'node'; comp: string; pin: string }      // voltage of the net a pin belongs to (vs. ground)
  | { q: 'v'; comp: string }                      // voltage across the part (pin1 - pin2 convention of the solver)
  | { q: 'i'; comp: string }                      // current through the part
  | { q: 'p'; comp: string }                      // absorbed power
  | { q: 'val'; comp: string; key: string };      // device specific: vbe, vce, ic, ib, vgs, vds, id, energy ...

export type Stat = 'max' | 'min' | 'mean' | 'rms' | 'final' | 'pp' | 'freq';

export interface TranSpec { stop: number; dt: number; stat: Stat; /** ignore the first fraction of the run (settling) */ skip?: number; /** sample at this time instead of using stat */ at?: number }

/** An expected measurement: lesson promise, verified by tests against the solver. */
export interface Expect {
  label: string;
  probe: Probe;
  value: number;
  /** tolerance; default rel 3 % */
  tol?: { rel?: number; abs?: number };
  unit: string;
  /** default DC operating point; with `tran` a transient statistic */
  tran?: TranSpec;
}

/** A learner-facing pass/fail criterion of a challenge. */
export interface Check {
  label: string;
  probe: Probe;
  min?: number;
  max?: number;
  unit: string;
  tran?: TranSpec;
}

export type Block =
  | { t: 'p'; text: string }                       // paragraph
  | { t: 'formula'; text: string; note?: string }  // e.g. "V = I · R"
  | { t: 'list'; items: string[] }
  | { t: 'warn'; text: string };

export interface CalcStep { title: string; formula: string; /** worked numbers using the lesson's circuit values */ working: string }

export interface Question {
  id: string;
  q: string;
  /** multiple choice */
  options?: string[];
  /** index of the right option (choice) or the numeric answer (numeric) */
  answer: number;
  /** numeric tolerance (relative) for numeric questions */
  tol?: number;
  unit?: string;
  explain: string;
  /** for numeric questions: a probe on the lesson circuit that must reproduce `answer` */
  verify?: { probe: Probe; tran?: TranSpec };
}

export interface Challenge {
  id: string;
  title: string;
  goal: string;
  hints: string[];
  /** circuit the learner starts from */
  start: () => Circuit;
  /** pass criteria evaluated on the learner's circuit */
  checks: Check[];
  /** a known-good answer circuit; used only by tests to prove the challenge is solvable and the checks are right */
  solution: () => Circuit;
}

export interface FaultHunt {
  id: string;
  title: string;
  /** what the learner is told is wrong */
  symptom: string;
  circuit: () => Circuit;
  /** the real, hidden fault */
  hidden: Record<string, Fault>;
  hints: string[];
  answer: { comp: string; kind: FaultKind };
  explain: string;
  /** a probe whose value differs clearly between healthy and faulty circuit (verified by tests) */
  telltale: Probe;
}

export interface FirmwareFile { board: string; kind: 'sketch'; source: string; comp: string }

export interface Lesson {
  id: string;
  track: Track;
  level: Level;
  title: string;
  summary: string;
  minutes: number;
  prerequisites?: string[];
  objectives: string[];
  /** working principle */
  theory: Block[];
  /** calculations with the lesson's numbers */
  calc: CalcStep[];
  /** the lab circuit */
  build: () => Circuit;
  /** recommended simulation speed (sim s / real s) when the lesson uses time */
  speed?: number;
  /** step-by-step lab procedure */
  steps: string[];
  /** expected results, verified against the solver by tests */
  expects: Expect[];
  mistakes: string[];
  /** fault experiments the learner can inject (Inspector → Arıza laboratuvarı) */
  faults: { title: string; how: string; symptom: string }[];
  quiz: Question[];
  challenge?: Challenge;
  faultHunt?: FaultHunt;
  /** firmware for MCU lessons (also stored in the circuit's firmware map by build()) */
  code?: string;
  /** safety note for dangerous real-world analogues (mains, batteries, capacitors ...) */
  safety?: string;
}

export const TRACK_LABEL: Record<Track, string> = {
  temel: 'Elektriğin temelleri', analog: 'Analog elektronik', dijital: 'Dijital ve mikrodenetleyici', guc: 'Güç elektroniği ve ısı', ariza: 'Arıza bulma',
};
export const LEVEL_LABEL: Record<Level, string> = { baslangic: 'Başlangıç', orta: 'Orta', ileri: 'İleri' };
