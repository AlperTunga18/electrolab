import { describe, expect, it } from 'vitest';
import { LESSONS } from './content';
import { EvalCtx, evalChallenge, evalExpect } from './engine';
import { createRuntime } from '../core/mcu/factory';
import { getDef } from '../library/components';

const ids = new Set(LESSONS.map((l) => l.id));

describe('curriculum', () => {
  it('has unique ids and valid prerequisites', () => {
    expect(ids.size).toBe(LESSONS.length);
    for (const l of LESSONS) for (const p of l.prerequisites ?? []) expect(ids.has(p), `${l.id} -> ${p}`).toBe(true);
  });
  it('covers every track with enough lessons', () => {
    expect(LESSONS.length).toBeGreaterThanOrEqual(30);
    for (const t of ['temel', 'analog', 'dijital', 'guc', 'ariza'] as const) expect(LESSONS.filter((l) => l.track === t).length, t).toBeGreaterThanOrEqual(3);
    expect(LESSONS.filter((l) => l.challenge).length).toBeGreaterThanOrEqual(10);
    expect(LESSONS.filter((l) => l.faultHunt).length).toBeGreaterThanOrEqual(8);
  });

  for (const l of LESSONS) {
    describe(l.id, () => {
      it('has complete teaching material', () => {
        expect(l.title.length).toBeGreaterThan(3);
        expect(l.objectives.length).toBeGreaterThanOrEqual(2);
        expect(l.theory.length).toBeGreaterThanOrEqual(2);
        expect(l.calc.length).toBeGreaterThanOrEqual(1);
        expect(l.steps.length).toBeGreaterThanOrEqual(3);
        expect(l.expects.length).toBeGreaterThanOrEqual(1);
        expect(l.mistakes.length).toBeGreaterThanOrEqual(2);
        expect(l.faults.length).toBeGreaterThanOrEqual(1);
        expect(l.quiz.length).toBeGreaterThanOrEqual(3);
        expect(l.minutes).toBeGreaterThan(0);
      });

      it('lab circuit solves and every expected result matches the solver', () => {
        const c = l.build();
        expect(c.components.length).toBeGreaterThan(0);
        const ctx = new EvalCtx(c);
        for (const e of l.expects) {
          const r = evalExpect(ctx, e);
          expect(r.ok, `${e.label}: got ${r.got}, want ${e.value} ±`).toBe(true);
        }
      });

      it('quiz is well formed and numeric answers are reproduced by the solver', () => {
        const ctx = new EvalCtx(l.build());
        const qids = new Set<string>();
        for (const q of l.quiz) {
          expect(qids.has(q.id)).toBe(false); qids.add(q.id);
          if (q.options) {
            expect(q.options.length).toBeGreaterThanOrEqual(3);
            expect(Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length, q.id).toBe(true);
          }
          expect(q.explain.length).toBeGreaterThan(10);
          if (q.verify) {
            const got = ctx.value(q.verify.probe, q.verify.tran);
            expect(Math.abs(got - q.answer), `${q.id}: got ${got}`).toBeLessThanOrEqual(1e-9 + (q.tol ?? 0.03) * Math.abs(q.answer));
          }
        }
      });

      if (l.challenge) {
        const ch = l.challenge;
        it('challenge: start does not already pass, the reference solution does', () => {
          const start = evalChallenge(ch.start(), ch.checks);
          expect(start.ok, 'start circuit must not already satisfy the goal').toBe(false);
          const sol = evalChallenge(ch.solution(), ch.checks);
          expect(sol.results.filter((r) => !r.ok).map((r) => `${r.label}: ${r.got} ${r.error ?? ''}`)).toEqual([]);
          expect(ch.hints.length).toBeGreaterThanOrEqual(1);
        });
      }

      if (l.faultHunt) {
        const fh = l.faultHunt;
        it('fault hunt: hidden fault changes the telltale measurement and answer is consistent', () => {
          const c = fh.circuit();
          expect(c.components.some((x) => x.id === fh.answer.comp)).toBe(true);
          expect(fh.hidden[fh.answer.comp]?.kind).toBe(fh.answer.kind);
          const healthy = new EvalCtx(c).value(fh.telltale);
          const faulty = new EvalCtx(c, fh.hidden).value(fh.telltale);
          expect(Math.abs(faulty - healthy), `healthy ${healthy} vs faulty ${faulty}`).toBeGreaterThan(0.05 * Math.max(Math.abs(healthy), 1e-3));
          expect(fh.hints.length).toBeGreaterThanOrEqual(2);
          expect(fh.circuit().faults ?? {}).toEqual({});
        });
      }

      if (l.code !== undefined || l.track === 'dijital') {
        it('MCU lessons carry firmware that compiles on its board', () => {
          const c = l.build();
          const mcus = c.components.filter((x) => getDef(x.type).mcu);
          if (mcus.length === 0) return;
          for (const m of mcus) {
            const fw = c.firmware?.[m.id];
            expect(fw, `${m.ref} has no firmware`).toBeTruthy();
            const rt = createRuntime(fw!.kind, getDef(m.type).mcu!)!;
            const res = rt.load(fw!.source);
            expect(res.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
          }
        });
      }
    });
  }
});
