import { useState } from 'react';
import { useLab } from '../store/lab';
import { LESSONS } from '../education/content';
import { EvalCtx, evalChallenge, evalExpect, type CheckResult, type ExpectResult } from '../education/engine';
import { LEVEL_LABEL } from '../education/types';
import { useProgress } from '../education/progress';
import { FAULT_LABEL } from '../core/sim/faults';
import { formatSI } from '../core/units';
import type { FaultKind } from '../core/circuit/types';

const btn = 'px-2.5 py-1 rounded text-xs border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40';
const sel = 'w-full bg-zinc-950 border border-zinc-700 rounded px-1 py-0.5 text-sm';

export function LessonPanel() {
  const s = useLab();
  const prog = useProgress();
  const al = s.activeLesson;
  const l = LESSONS.find((x) => x.id === al?.id);
  const [done, setDone] = useState<Record<number, boolean>>({});
  const [exp, setExp] = useState<ExpectResult[] | null>(null);
  const [chk, setChk] = useState<{ results: CheckResult[]; ok: boolean; error?: string } | null>(null);
  const [hints, setHints] = useState(0);
  const [guessComp, setGuessComp] = useState('');
  const [guessKind, setGuessKind] = useState<FaultKind | ''>('');
  const [verdict, setVerdict] = useState<'ok' | 'bad' | null>(null);
  const [tries, setTries] = useState(0);
  const [msg, setMsg] = useState('');
  if (!al || !l) return <div className="p-3 text-sm text-zinc-500">Aktif ders yok. Akademi’den bir ders açın.</div>;
  const mode = al.mode;
  const challenge = mode === 'challenge' ? l.challenge : undefined;
  const hunt = mode === 'hunt' ? l.faultHunt : undefined;
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 2500); };

  const measure = () => {
    try {
      const ctx = new EvalCtx(s.circuit);
      setExp(l.expects.map((e) => evalExpect(ctx, e)));
    } catch (e) { setExp(null); flash(e instanceof Error ? e.message : String(e)); }
  };
  const check = () => {
    if (!challenge) return;
    const r = evalChallenge(s.circuit, challenge.checks);
    setChk(r);
    if (r.ok) prog.setChallenge(l.id);
  };
  const submit = () => {
    if (!hunt || !guessComp || !guessKind) return;
    setTries(tries + 1);
    if (guessComp === hunt.answer.comp && guessKind === hunt.answer.kind) { setVerdict('ok'); prog.setHunt(l.id); } else setVerdict('bad');
  };
  const addNote = () => {
    const data: string[] = [];
    if (exp) exp.forEach((e) => data.push(`${e.label}: ölçülen ${formatSI(e.got, e.unit)} (beklenen ${formatSI(e.want, e.unit)}) ${e.ok ? '✔' : '✖'}`));
    else if (s.live) s.live.netNames.forEach((n, i) => data.push(`${n}: ${formatSI(s.live!.netV[i], 'V')}`));
    prog.addNote({ lesson: l.id, title: `${l.title} — ${mode === 'lab' ? 'deney' : mode === 'challenge' ? 'görev' : 'arıza avı'}`, note: '', data });
    flash('Deney defterine eklendi');
  };

  return (
    <div className="p-3 space-y-3 text-sm overflow-y-auto h-full">
      <div>
        <div className="font-semibold">{l.title}</div>
        <div className="text-[11px] text-zinc-500">{LEVEL_LABEL[l.level]} · {mode === 'lab' ? 'deney' : mode === 'challenge' ? 'görev' : 'arıza avı'}</div>
        <div className="flex gap-1 mt-1 flex-wrap">
          <button className={btn} onClick={() => s.openLesson(l.id)}>Ders sayfası</button>
          <button className={btn} onClick={s.endLesson}>Dersi kapat</button>
        </div>
      </div>

      {mode === 'lab' && (
        <>
          <div>
            <div className="text-xs text-zinc-500 uppercase tracking-wide mb-1">Adımlar</div>
            <ul className="space-y-1">{l.steps.map((x, i) => <li key={i} className="flex gap-2 text-xs"><input type="checkbox" checked={!!done[i]} onChange={(e) => setDone({ ...done, [i]: e.target.checked })} className="mt-0.5" /><span className={done[i] ? 'line-through text-zinc-600' : ''}>{x}</span></li>)}</ul>
          </div>
          <div>
            <div className="flex items-center justify-between"><div className="text-xs text-zinc-500 uppercase tracking-wide">Beklenen sonuçlar</div><button className={btn} onClick={measure}>Ölç ve karşılaştır</button></div>
            <table className="w-full text-xs mt-1"><tbody>
              {l.expects.map((e, i) => { const r = exp?.[i]; return (
                <tr key={e.label} className="border-t border-zinc-800"><td className="py-1 pr-1">{e.label}</td><td className="text-zinc-400 whitespace-nowrap">≈ {formatSI(e.value, e.unit)}</td><td className={`pl-1 whitespace-nowrap ${r ? (r.ok ? 'text-emerald-400' : 'text-red-400') : 'text-zinc-600'}`}>{r ? `${r.ok ? '✔' : '✖'} ${formatSI(r.got, e.unit)}` : '—'}</td></tr>
              ); })}
            </tbody></table>
            <div className="text-[11px] text-zinc-600 mt-1">Ölçüm, devrenin şu anki halinin DC/geçici çözümüdür (Çalıştır gerekmez).</div>
          </div>
        </>
      )}

      {challenge && (
        <div className="space-y-2">
          <div className="rounded border border-sky-800 bg-sky-950/30 p-2 text-xs">🎯 {challenge.goal}</div>
          <button className={btn} onClick={check}>Kontrol et</button>
          {chk && (
            <div className="space-y-1">
              {chk.results.map((r) => <div key={r.label} className={`text-xs ${r.ok ? 'text-emerald-400' : 'text-red-300'}`}>{r.ok ? '✔' : '✖'} {r.label}{r.got !== null ? ` — şu an ${formatSI(r.got, r.unit)} (hedef ${r.range})` : r.error ? ` — ${r.error}` : ''}</div>)}
              {chk.ok && <div className="rounded border border-emerald-700 bg-emerald-950/40 p-2 text-xs text-emerald-300">Görev tamamlandı! +30 puan.</div>}
            </div>
          )}
          <div className="space-y-1">
            {challenge.hints.slice(0, hints).map((h, i) => <div key={i} className="text-xs text-amber-200">💡 {h}</div>)}
            {hints < challenge.hints.length && <button className={btn} onClick={() => setHints(hints + 1)}>İpucu göster ({hints}/{challenge.hints.length})</button>}
          </div>
        </div>
      )}

      {hunt && (
        <div className="space-y-2">
          <div className="rounded border border-red-900 bg-red-950/30 p-2 text-xs">🔎 {hunt.symptom}</div>
          <div className="text-xs text-zinc-400">Çalıştır / DC çöz ile ölçüm yapın (Ölçümler sekmesi). Arıza bir parçada gizli. Bulduğunda cevabını gönder.</div>
          <label className="block text-xs text-zinc-400">Arızalı parça<select className={sel} value={guessComp} onChange={(e) => setGuessComp(e.target.value)}><option value="">seç…</option>{s.circuit.components.filter((c) => c.type !== 'ground').map((c) => <option key={c.id} value={c.id}>{c.ref}</option>)}</select></label>
          <label className="block text-xs text-zinc-400">Arıza türü<select className={sel} value={guessKind} onChange={(e) => setGuessKind(e.target.value as FaultKind)}><option value="">seç…</option>{(Object.keys(FAULT_LABEL) as FaultKind[]).map((k) => <option key={k} value={k}>{FAULT_LABEL[k]}</option>)}</select></label>
          <button className={btn} disabled={!guessComp || !guessKind || verdict === 'ok'} onClick={submit}>Cevabı gönder</button>
          {verdict === 'ok' && <div className="rounded border border-emerald-700 bg-emerald-950/40 p-2 text-xs text-emerald-300">Doğru! {hunt.explain} (+30 puan; {tries} denemede)</div>}
          {verdict === 'bad' && <div className="text-xs text-red-300">Yanlış, tekrar ölç ve dene. ({tries} deneme)</div>}
          <div className="space-y-1">
            {hunt.hints.slice(0, hints).map((h, i) => <div key={i} className="text-xs text-amber-200">💡 {h}</div>)}
            {hints < hunt.hints.length && <button className={btn} onClick={() => setHints(hints + 1)}>İpucu göster ({hints}/{hunt.hints.length})</button>}
          </div>
        </div>
      )}

      <div className="flex gap-2 items-center"><button className={btn} onClick={addNote}>📓 Deney defterine ekle</button>{msg && <span className="text-xs text-emerald-400">{msg}</span>}</div>
    </div>
  );
}
