import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { useLab } from '../store/lab';
import { answer, buildContext, QUICK_QUESTIONS, UNSUPPORTED_HELP } from '../core/assistant/answer';
import { askLlm, aiServerStatus, describeContext, type ChatMsg } from '../core/assistant/llm';
import type { Answer, Block } from '../core/assistant/types';
import { setFirmwareHelper } from './assistantActions';

const btn = 'px-2 py-1 rounded text-xs border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40';

export interface AiSettings { enabled: boolean; key: string; model: string; includeCircuit: boolean }
const KEY = 'electrolab.ai';
export const loadAi = (): AiSettings => {
  try { const p = JSON.parse(localStorage.getItem(KEY) ?? 'null'); if (p) return { enabled: !!p.enabled, key: p.key ?? '', model: p.model ?? '', includeCircuit: p.includeCircuit !== false }; } catch { /* storage unavailable */ }
  return { enabled: false, key: '', model: '', includeCircuit: true };
};
export const saveAi = (s: AiSettings) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ } };

interface Entry { id: number; role: 'user' | 'assistant'; text?: string; answer?: Answer; ai?: boolean; error?: boolean }
interface ChatState { items: Entry[]; busy: boolean; push: (e: Omit<Entry, 'id'>) => void; setBusy: (b: boolean) => void; clear: () => void }
export const useChat = create<ChatState>((set, get) => ({
  items: [], busy: false,
  push: (e) => set({ items: [...get().items, { ...e, id: (get().items.at(-1)?.id ?? 0) + 1 }] }),
  setBusy: (busy) => set({ busy }),
  clear: () => set({ items: [] }),
}));

function BlockView({ b }: { b: Block }) {
  const s = useLab();
  switch (b.t) {
    case 'p': return <p className="text-sm text-zinc-200">{b.text}</p>;
    case 'warn': return <div className="rounded border border-amber-800 bg-amber-950/30 text-amber-200 text-xs px-2 py-1">⚠ {b.text}</div>;
    case 'list': return <ul className="list-disc ml-5 text-sm text-zinc-300 space-y-0.5">{b.items.map((x, i) => <li key={i}>{x}</li>)}</ul>;
    case 'table': return (
      <table className="w-full text-xs"><thead><tr className="text-left text-zinc-500">{b.head.map((h) => <th key={h} className="pr-3">{h}</th>)}</tr></thead>
        <tbody>{b.rows.map((r, i) => <tr key={i} className="border-t border-zinc-800">{r.map((c, j) => <td key={j} className="pr-3 py-0.5">{c}</td>)}</tr>)}</tbody></table>
    );
    case 'calc': return (
      <div className="rounded border border-zinc-700 bg-zinc-950 p-2 text-xs space-y-1">
        <div className="font-semibold text-emerald-300">🧮 {b.calc.title}</div>
        {b.calc.steps.map((x, i) => <div key={i} className="font-mono text-zinc-300">{i + 1}. {x}</div>)}
        <div className="text-emerald-300"><b>Sonuç:</b> {b.calc.result}</div>
        <div className="text-zinc-500">Kaynak: {b.calc.sources.join(' · ')}</div>
      </div>
    );
    case 'finding': return (
      <div onClick={() => b.f.comps[0] && s.select({ kind: 'comp', id: b.f.comps[0] })} className={`rounded border px-2 py-1 text-xs cursor-pointer ${b.f.severity === 'error' ? 'border-red-800 bg-red-950/30 text-red-200' : b.f.severity === 'warning' ? 'border-amber-800 bg-amber-950/20 text-amber-200' : 'border-zinc-700 text-zinc-300'}`}>
        <b>{b.f.severity === 'error' ? '✖' : b.f.severity === 'warning' ? '⚠' : 'ℹ'} {b.f.title}</b>
        <div>{b.f.detail}</div>
        {b.f.fix && <div className="text-emerald-300 mt-0.5">→ {b.f.fix}</div>}
      </div>
    );
    case 'code': return (
      <div className="space-y-1">
        <pre className="bg-zinc-950 border border-zinc-800 rounded p-2 text-[11px] font-mono text-emerald-200 overflow-x-auto">{b.code}</pre>
        {b.comp && <button className={btn} onClick={() => { setFirmwareHelper(b.comp!, b.code); }}>⬆ Karta firmware olarak ekle (Kod sekmesi)</button>}
      </div>
    );
  }
}

export function AssistantTab() {
  const s = useLab();
  const chat = useChat();
  const [q, setQ] = useState('');
  const [ai, setAi] = useState<AiSettings>(loadAi);
  const [server, setServer] = useState<{ server_key: boolean } | null>(null);
  const [showCtx, setShowCtx] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { void aiServerStatus().then(setServer); }, []);
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [chat.items.length, chat.busy]);
  const update = (p: Partial<AiSettings>) => { const n = { ...ai, ...p }; setAi(n); saveAi(n); };
  const selId = s.selection?.kind === 'comp' ? s.selection.id : undefined;
  const aiReady = ai.enabled && (!!ai.key || !!server?.server_key);

  const ask = async (question: string) => {
    const text = question.trim();
    if (!text) return;
    chat.push({ role: 'user', text });
    setQ('');
    const off = answer(text, s.circuit, { selection: selId });
    if (off) chat.push({ role: 'assistant', answer: off });
    if (aiReady && (!off || ai.enabled)) {
      chat.setBusy(true);
      try {
        const history: ChatMsg[] = chat.items.filter((e) => e.role === 'user' ? !!e.text : !!e.text && e.ai).map((e) => ({ role: e.role, content: e.text! }));
        const r = await askLlm(text, history, s.circuit, { apiKey: ai.key || undefined, model: ai.model || undefined, includeCircuit: ai.includeCircuit, selection: selId, offline: off });
        chat.push({ role: 'assistant', text: r.text, ai: true });
      } catch (e) { chat.push({ role: 'assistant', text: (e as Error).message, error: true }); }
      chat.setBusy(false);
    } else if (!off) {
      chat.push({ role: 'assistant', text: UNSUPPORTED_HELP });
    }
  };

  return (
    <div className="flex flex-col h-full text-sm">
      <div className="flex items-center gap-2 px-2 py-1 border-b border-zinc-800 flex-wrap">
        <span className="text-xs text-zinc-500">Mühendislik asistanı — çevrimdışı motor çözücü sonuçlarıyla çalışır; API anahtarı gerekmez.</span>
        <div className="flex-1" />
        <label className="text-xs text-zinc-400 flex items-center gap-1" title="Açıkken sorular, devre özetiyle birlikte yapay zekâ sağlayıcısına da gönderilir">
          <input type="checkbox" checked={ai.enabled} onChange={(e) => update({ enabled: e.target.checked })} />Yapay zekâ ({aiReady ? 'hazır' : ai.enabled ? 'anahtar yok' : 'kapalı'})
        </label>
        <button className={btn} onClick={() => setShowCtx(!showCtx)}>Gönderilecek bağlam</button>
        <button className={btn} onClick={chat.clear}>Temizle</button>
      </div>
      {ai.enabled && (
        <div className="px-2 py-1 border-b border-zinc-800 flex gap-2 items-center flex-wrap text-xs bg-zinc-950/50">
          <input type="password" value={ai.key} onChange={(e) => update({ key: e.target.value })} placeholder={server?.server_key ? 'Sunucuda anahtar var (boş bırakılabilir)' : 'API anahtarı (yalnızca bu tarayıcıda saklanır)'} className="bg-zinc-950 border border-zinc-700 rounded px-2 py-0.5 w-72" autoComplete="off" />
          <input value={ai.model} onChange={(e) => update({ model: e.target.value })} placeholder="model (boş = varsayılan)" className="bg-zinc-950 border border-zinc-700 rounded px-2 py-0.5 w-44" />
          <label className="flex items-center gap-1 text-zinc-400"><input type="checkbox" checked={ai.includeCircuit} onChange={(e) => update({ includeCircuit: e.target.checked })} />devre özetini gönder</label>
          <span className="text-amber-300">Gizlilik: istek yerel sunucunuz üzerinden sağlayıcıya gider; anahtar tarayıcı deposunda düz metin tutulur.</span>
        </div>
      )}
      {showCtx && <pre className="max-h-40 overflow-auto text-[10px] bg-zinc-950 border-b border-zinc-800 p-2 text-zinc-400 whitespace-pre-wrap">{describeContext(buildContext(s.circuit), selId)}</pre>}
      <div ref={box} className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
        {!chat.items.length && (
          <div className="text-zinc-500 text-xs space-y-2">
            <div>Devrenizi analiz eder, bağlantıları ve değerleri inceler, hesapları adım adım gösterir. Bir parça seçip “Bu bileşen neden gerekli?” diye sorabilirsiniz.</div>
            <div className="flex gap-1.5 flex-wrap">{QUICK_QUESTIONS.map((x) => <button key={x.label} className={btn} onClick={() => ask(x.q)}>{x.label}</button>)}</div>
          </div>
        )}
        {chat.items.map((e) => (
          <div key={e.id} className={e.role === 'user' ? 'text-right' : ''}>
            {e.role === 'user' ? <span className="inline-block rounded-lg bg-emerald-900/60 px-3 py-1.5 text-zinc-100 max-w-[80%] text-left">{e.text}</span> : (
              <div className={`rounded-lg border px-3 py-2 space-y-2 ${e.error ? 'border-red-800 bg-red-950/30' : 'border-zinc-800 bg-zinc-900'}`}>
                {e.answer && <><div className="font-semibold text-sm">{e.answer.title}</div>{e.answer.blocks.map((b, i) => <BlockView key={i} b={b} />)}<div className="text-[10px] text-zinc-500">Kaynaklar: {e.answer.sources.join(' · ') || '—'}</div></>}
                {e.text && <div className={`whitespace-pre-wrap ${e.error ? 'text-red-300' : 'text-zinc-200'}`}>{e.ai && <div className="text-[10px] text-sky-300 mb-1">🤖 yapay zekâ yanıtı (doğrulayın; kesin değildir)</div>}{e.text}</div>}
              </div>
            )}
          </div>
        ))}
        {chat.busy && <div className="text-xs text-zinc-500">Yapay zekâ yanıtlıyor…</div>}
      </div>
      <div className="flex gap-1 p-2 border-t border-zinc-800">
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void ask(q); }} placeholder={selId ? 'Seçili parça hakkında veya genel bir soru sorun…' : 'Bir soru sorun (örn. “R2 neden gerekli?”, “Kaç amper çeker?”)'} className="flex-1 bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm" />
        <button className="px-3 py-1.5 rounded text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40" disabled={chat.busy || !q.trim()} onClick={() => void ask(q)}>Sor</button>
      </div>
    </div>
  );
}
