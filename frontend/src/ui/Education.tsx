import { useMemo, useState } from 'react';
import { useLab } from '../store/lab';
import { LESSONS } from '../education/content';
import { LEVEL_LABEL, TRACK_LABEL, type Lesson, type Question, type Track } from '../education/types';
import { badges, stats, useProgress, PASS_RATIO } from '../education/progress';
import { EXAMPLES } from '../examples/examples';
import { buildNets } from '../core/circuit/nets';
import { getDef } from '../library/components';
import { formatSI } from '../core/units';
import { PageShell } from './Pages';

const card = 'rounded-lg border border-zinc-800 bg-zinc-900';
const btn = 'px-3 py-1.5 rounded text-sm border border-zinc-700 bg-zinc-800 hover:bg-zinc-700';
const primary = 'px-3 py-1.5 rounded text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white';
const TRACKS = Object.keys(TRACK_LABEL) as Track[];

function LessonCard({ l }: { l: Lesson }) {
  const open = useLab((s) => s.openLesson);
  const p = useProgress((s) => s.lessons[l.id]);
  return (
    <button onClick={() => open(l.id)} className={`${card} p-3 text-left hover:border-emerald-600 transition-colors`}>
      <div className="flex justify-between gap-2"><b className="text-sm">{l.title}</b>{p?.done ? <span className="text-emerald-400 text-xs shrink-0">✔ tamamlandı</span> : p?.opened ? <span className="text-amber-300 text-xs shrink-0">devam</span> : null}</div>
      <p className="text-xs text-zinc-400 mt-1 line-clamp-2">{l.summary}</p>
      <div className="flex gap-2 mt-2 text-[10px] text-zinc-500 flex-wrap">
        <span>{LEVEL_LABEL[l.level]}</span><span>{l.minutes} dk</span>
        {l.challenge && <span className={p?.challenge ? 'text-emerald-400' : ''}>görev{p?.challenge ? ' ✔' : ''}</span>}
        {l.faultHunt && <span className={p?.hunt ? 'text-emerald-400' : ''}>arıza avı{p?.hunt ? ' ✔' : ''}</span>}
        {p?.quiz && <span>test {p.quiz.score}/{p.quiz.total}</span>}
      </div>
    </button>
  );
}

function ExamplesGrid() {
  const s = useLab();
  return (
    <div className="grid md:grid-cols-2 gap-3">
      {EXAMPLES.map((e) => (
        <div key={e.id} className={`${card} p-4`}>
          <div className="flex justify-between"><b>{s.lang === 'tr' ? e.title : e.titleEn}</b><span className="text-xs text-zinc-500">{e.level === 'baslangic' ? 'Başlangıç' : e.level === 'orta' ? 'Orta' : e.level === 'mcu' ? 'Mikrodenetleyici' : 'Arıza senaryosu'}</span></div>
          <p className="text-sm text-zinc-400 mt-1">{e.summary}</p>
          <ol className="list-decimal ml-5 mt-2 text-xs text-zinc-300 space-y-0.5">{e.steps.map((x) => <li key={x}>{x}</li>)}</ol>
          <div className="text-xs mt-2 text-emerald-300/90">Beklenen: {e.expected}</div>
          <button className={`${btn} mt-3`} onClick={() => { s.loadCircuit(e.build(), e.title); if (e.speed) s.setSpeed(e.speed); s.go('lab'); }}>Laboratuvarda aç</button>
        </div>
      ))}
    </div>
  );
}

function Achievements() {
  const prog = useProgress();
  const bs = badges(prog.lessons, prog.notebook.length);
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {bs.map((b) => (
        <div key={b.id} className={`${card} p-3 ${b.earned ? 'border-emerald-700' : 'opacity-60'}`}>
          <div className="font-semibold text-sm">{b.earned ? '🏅' : '🔒'} {b.label}</div>
          <div className="text-xs text-zinc-400 mt-1">{b.desc}</div>
        </div>
      ))}
    </div>
  );
}

export function Academy() {
  const [tab, setTab] = useState<'lessons' | 'examples' | 'badges'>('lessons');
  const go = useLab((s) => s.go);
  const prog = useProgress();
  const st = stats(prog.lessons);
  return (
    <PageShell title="Eğitim Akademisi">
      <div className={`${card} p-4 mb-4 flex flex-wrap gap-6 items-center`}>
        <div><div className="text-xs text-zinc-500">Seviye</div><div className="text-2xl font-bold">{st.level}</div></div>
        <div><div className="text-xs text-zinc-500">Puan</div><div className="text-2xl font-bold">{st.points}</div></div>
        <div className="flex-1 min-w-48"><div className="text-xs text-zinc-500 mb-1">Tamamlanan {st.doneCount}/{st.total}</div><div className="h-2 rounded bg-zinc-800"><div className="h-2 rounded bg-emerald-600" style={{ width: `${(st.doneCount / Math.max(st.total, 1)) * 100}%` }} /></div></div>
        <button className={btn} onClick={() => go('notebook')}>📓 Deney defteri ({prog.notebook.length})</button>
      </div>
      <div className="flex gap-1 mb-4">
        {([['lessons', 'Dersler'], ['examples', 'Hazır devreler'], ['badges', 'Başarılar']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 rounded text-sm ${tab === k ? 'bg-emerald-700' : 'bg-zinc-800 text-zinc-300'}`}>{label}</button>
        ))}
      </div>
      {tab === 'lessons' && TRACKS.map((t) => {
        const ls = LESSONS.filter((l) => l.track === t);
        if (!ls.length) return null;
        return (
          <div key={t} className="mb-6">
            <h2 className="font-semibold mb-2">{TRACK_LABEL[t]} <span className="text-xs text-zinc-500 font-normal">({ls.filter((l) => prog.lessons[l.id]?.done).length}/{ls.length})</span></h2>
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">{ls.map((l) => <LessonCard key={l.id} l={l} />)}</div>
          </div>
        );
      })}
      {tab === 'examples' && <ExamplesGrid />}
      {tab === 'badges' && <Achievements />}
      <div className="text-xs text-zinc-600 mt-6">Derslerdeki tüm “beklenen sonuç” değerleri otomatik testlerle çözücüye karşı doğrulanır. İlerleme bu tarayıcıda (yerel depolama) saklanır.</div>
    </PageShell>
  );
}

function Quiz({ l }: { l: Lesson }) {
  const setQuiz = useProgress((s) => s.setQuiz);
  const prev = useProgress((s) => s.lessons[l.id]?.quiz);
  const [ans, setAns] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const check = (q: Question): boolean => {
    const a = ans[q.id];
    if (a === undefined || a === '') return false;
    if (q.options) return Number(a) === q.answer;
    const v = Number(a.replace(',', '.'));
    return Number.isFinite(v) && Math.abs(v - q.answer) <= (q.tol ?? 0.03) * Math.abs(q.answer) + 1e-9;
  };
  const score = l.quiz.filter(check).length;
  return (
    <div className="space-y-3">
      {l.quiz.map((q, i) => (
        <div key={q.id} className="text-sm">
          <div className="font-medium">{i + 1}. {q.q}</div>
          {q.options ? (
            <div className="mt-1 space-y-1">
              {q.options.map((o, k) => (
                <label key={k} className={`flex gap-2 items-start text-xs px-2 py-1 rounded ${done ? (k === q.answer ? 'bg-emerald-900/50' : String(k) === ans[q.id] ? 'bg-red-900/40' : '') : 'hover:bg-zinc-800'}`}>
                  <input type="radio" name={q.id} disabled={done} checked={ans[q.id] === String(k)} onChange={() => setAns({ ...ans, [q.id]: String(k) })} />{o}
                </label>
              ))}
            </div>
          ) : (
            <div className="mt-1 flex items-center gap-2"><input disabled={done} value={ans[q.id] ?? ''} onChange={(e) => setAns({ ...ans, [q.id]: e.target.value })} className="w-32 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-sm" placeholder="sayı" /><span className="text-xs text-zinc-500">{q.unit}</span></div>
          )}
          {done && <div className={`text-xs mt-1 ${check(q) ? 'text-emerald-300' : 'text-red-300'}`}>{check(q) ? '✔ Doğru. ' : `✖ Yanlış${q.options ? '' : ` (doğru ≈ ${q.answer} ${q.unit ?? ''})`}. `}{q.explain}</div>}
        </div>
      ))}
      {!done ? <button className={primary} onClick={() => { setDone(true); setQuiz(l.id, score, l.quiz.length); }}>Testi bitir</button>
        : <div className="flex gap-3 items-center"><b className={score / l.quiz.length >= PASS_RATIO ? 'text-emerald-400' : 'text-amber-300'}>Sonuç: {score}/{l.quiz.length}{score / l.quiz.length >= PASS_RATIO ? ' — geçti' : ` — geçmek için %${PASS_RATIO * 100}`}</b><button className={btn} onClick={() => { setDone(false); setAns({}); }}>Tekrar çöz</button></div>}
      {prev && <div className="text-xs text-zinc-500">En iyi sonucun: {prev.score}/{prev.total}</div>}
    </div>
  );
}

export function LessonPage() {
  const id = useLab((s) => s.lessonId);
  const s = useLab();
  const prog = useProgress((st) => st.lessons[id ?? '']);
  const l = LESSONS.find((x) => x.id === id);
  const circuit = useMemo(() => (l ? l.build() : null), [l]);
  if (!l || !circuit) return <PageShell title="Ders"><div className="text-zinc-500">Ders bulunamadı.</div><button className={btn} onClick={() => s.go('academy')}>Akademiye dön</button></PageShell>;
  const nets = buildNets(circuit);
  const members = new Map<number, string[]>();
  for (const [pin, n] of nets.pinNet) { const [cid, p] = pin.split(':'); members.set(n, [...(members.get(n) ?? []), `${circuit.components.find((c) => c.id === cid)?.ref}.${p}`]); }
  const bom = new Map<string, string[]>();
  for (const c of circuit.components) if (getDef(c.type).model !== 'ground') bom.set(c.type, [...(bom.get(c.type) ?? []), c.ref]);
  const section = (title: string, body: React.ReactNode) => <section className={`${card} p-4 mb-4`}><h2 className="font-semibold mb-2">{title}</h2>{body}</section>;
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-6">
        <button className={btn} onClick={() => s.go('academy')}>← Akademi</button>
        <h1 className="text-2xl font-bold mt-3">{l.title}</h1>
        <div className="text-xs text-zinc-500 mt-1">{TRACK_LABEL[l.track]} · {LEVEL_LABEL[l.level]} · {l.minutes} dk {prog?.done && <span className="text-emerald-400">· ✔ tamamlandı</span>}</div>
        <p className="text-zinc-300 mt-3">{l.summary}</p>
        {l.prerequisites?.length ? <div className="text-xs text-zinc-500 mt-1">Önce: {l.prerequisites.map((p) => LESSONS.find((x) => x.id === p)?.title ?? p).join(', ')}</div> : null}
        <div className="flex gap-2 flex-wrap my-4">
          <button className={primary} onClick={() => { useProgress.getState().open(l.id); s.startLesson(l.id, 'lab'); }}>🔬 Laboratuvarda aç</button>
          {l.challenge && <button className={btn} onClick={() => { useProgress.getState().open(l.id); s.startLesson(l.id, 'challenge'); }}>🎯 Görev: {l.challenge.title}</button>}
          {l.faultHunt && <button className={btn} onClick={() => { useProgress.getState().open(l.id); s.startLesson(l.id, 'hunt'); }}>🔎 Arıza avı: {l.faultHunt.title}</button>}
        </div>
        {l.safety && <div className="rounded border border-amber-800 bg-amber-950/40 text-amber-200 text-sm p-3 mb-4">⚠ <b>Güvenlik:</b> {l.safety}</div>}
        {section('Hedefler', <ul className="list-disc ml-5 text-sm space-y-1">{l.objectives.map((o) => <li key={o}>{o}</li>)}</ul>)}
        {section('Çalışma prensibi', <div className="space-y-2 text-sm">
          {l.theory.map((b, i) => b.t === 'p' ? <p key={i}>{b.text}</p>
            : b.t === 'formula' ? <div key={i} className="rounded bg-zinc-950 border border-zinc-800 px-3 py-2 font-mono text-emerald-300">{b.text}{b.note && <span className="text-zinc-500 font-sans text-xs ml-3">{b.note}</span>}</div>
            : b.t === 'list' ? <ul key={i} className="list-disc ml-5">{b.items.map((x) => <li key={x}>{x}</li>)}</ul>
            : <div key={i} className="rounded border border-amber-800 bg-amber-950/30 text-amber-200 px-3 py-2">⚠ {b.text}</div>)}
        </div>)}
        {section('Hesaplamalar', <div className="space-y-3 text-sm">{l.calc.map((c) => <div key={c.title}><b>{c.title}</b><div className="font-mono text-emerald-300 text-xs mt-1">{c.formula}</div><div className="text-zinc-300 text-xs mt-0.5">{c.working}</div></div>)}</div>)}
        {section('Devre: bileşen listesi ve bağlantılar', <div className="grid md:grid-cols-2 gap-4 text-xs">
          <div><div className="text-zinc-500 mb-1">Bileşen listesi (BOM)</div><table className="w-full"><tbody>{[...bom.entries()].map(([t, refs]) => <tr key={t} className="border-t border-zinc-800"><td className="py-0.5 pr-2">{refs.join(', ')}</td><td className="text-zinc-300">{getDef(t).name}</td></tr>)}</tbody></table></div>
          <div><div className="text-zinc-500 mb-1">Bağlantı tablosu (düğümler)</div><table className="w-full"><tbody>{nets.names.map((n, i) => <tr key={n} className="border-t border-zinc-800"><td className="py-0.5 pr-2 font-semibold">{n}</td><td className="text-zinc-300">{(members.get(i) ?? []).join(' · ')}</td></tr>)}</tbody></table></div>
          <div className="md:col-span-2 text-zinc-600">2D şematik çizimi planlanıyor; 3D bağlantı için “Laboratuvarda aç”.</div>
        </div>)}
        {l.code && section('Kod', <pre className="bg-zinc-950 border border-zinc-800 rounded p-3 text-xs font-mono overflow-x-auto text-emerald-200">{l.code}</pre>)}
        {section('Deney adımları', <ol className="list-decimal ml-5 text-sm space-y-1">{l.steps.map((x) => <li key={x}>{x}</li>)}</ol>)}
        {section('Beklenen sonuçlar', <div><table className="w-full text-sm"><tbody>{l.expects.map((e) => <tr key={e.label} className="border-t border-zinc-800"><td className="py-1 pr-2">{e.label}</td><td className="text-emerald-300 whitespace-nowrap">≈ {formatSI(e.value, e.unit)}</td></tr>)}</tbody></table><div className="text-xs text-zinc-500 mt-2">Bu değerler otomatik testlerle çözücüye karşı doğrulanmıştır; laboratuvardaki Ders panelinden kendi devrenle karşılaştırabilirsin.</div></div>)}
        {section('Sık yapılan hatalar', <ul className="list-disc ml-5 text-sm space-y-1">{l.mistakes.map((x) => <li key={x}>{x}</li>)}</ul>)}
        {section('Arıza deneyleri', <div className="space-y-2 text-sm">{l.faults.map((f) => <div key={f.title}><b>{f.title}</b><div className="text-zinc-400 text-xs">Nasıl: {f.how}</div><div className="text-zinc-300 text-xs">Gözlem: {f.symptom}</div></div>)}</div>)}
        {l.challenge && section(`Görev: ${l.challenge.title}`, <div className="text-sm space-y-2"><p>{l.challenge.goal}</p><div className="text-xs text-zinc-500">Ölçütler: {l.challenge.checks.map((c) => c.label).join(' · ')}</div>{prog?.challenge ? <div className="text-emerald-400">✔ Çözüldü</div> : <button className={btn} onClick={() => s.startLesson(l.id, 'challenge')}>Görevi laboratuvarda aç</button>}</div>)}
        {l.faultHunt && section(`Arıza avı: ${l.faultHunt.title}`, <div className="text-sm space-y-2"><p>{l.faultHunt.symptom}</p>{prog?.hunt ? <div className="text-emerald-400">✔ Çözüldü</div> : <button className={btn} onClick={() => s.startLesson(l.id, 'hunt')}>Arıza avını laboratuvarda aç</button>}</div>)}
        {section('Öğrenme testi', <Quiz key={l.id} l={l} />)}
      </div>
    </div>
  );
}

export function Notebook() {
  const prog = useProgress();
  const go = useLab((s) => s.go);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const exportMd = () => {
    const md = prog.notebook.map((n) => `## ${n.title}\n*${new Date(n.at).toLocaleString('tr-TR')}${n.lesson ? ` — ${LESSONS.find((l) => l.id === n.lesson)?.title ?? n.lesson}` : ''}*\n\n${n.note}\n\n${n.data.map((d) => `- ${d}`).join('\n')}\n`).join('\n');
    const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
    const a = document.createElement('a'); a.href = url; a.download = 'deney-defteri.md'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <PageShell title="Deney defteri">
      <div className={`${card} p-3 mb-4 space-y-2`}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Başlık" className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-sm" />
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Gözlem, sonuç, yorum…" rows={3} className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-sm" />
        <div className="flex gap-2"><button className={primary} disabled={!title.trim()} onClick={() => { prog.addNote({ title: title.trim(), note, data: [] }); setTitle(''); setNote(''); }}>Kaydet</button><button className={btn} onClick={exportMd} disabled={!prog.notebook.length}>Markdown olarak dışa aktar</button><button className={btn} onClick={() => go('academy')}>Akademi</button></div>
        <div className="text-xs text-zinc-500">Laboratuvardaki Ders panelinden ölçümlerini otomatik olarak buraya ekleyebilirsin.</div>
      </div>
      {!prog.notebook.length && <div className="text-zinc-500 text-sm">Kayıt yok.</div>}
      <div className="space-y-2">
        {prog.notebook.map((n) => (
          <div key={n.id} className={`${card} p-3 text-sm`}>
            <div className="flex justify-between"><b>{n.title}</b><button className="text-xs text-zinc-500 hover:text-red-400" onClick={() => prog.deleteNote(n.id)}>sil</button></div>
            <div className="text-[11px] text-zinc-500">{new Date(n.at).toLocaleString('tr-TR')}{n.lesson ? ` · ${LESSONS.find((l) => l.id === n.lesson)?.title ?? n.lesson}` : ''}</div>
            {n.note && <p className="mt-1 text-zinc-300 whitespace-pre-wrap">{n.note}</p>}
            {n.data.length > 0 && <ul className="mt-1 text-xs font-mono text-emerald-300">{n.data.map((d, i) => <li key={i}>{d}</li>)}</ul>}
          </div>
        ))}
      </div>
    </PageShell>
  );
}
