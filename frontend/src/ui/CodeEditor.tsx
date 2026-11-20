import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting, defaultHighlightStyle, indentOnInput, bracketMatching } from '@codemirror/language';
import { cpp } from '@codemirror/lang-cpp';
import { autocompletion, closeBrackets, completionKeymap, type CompletionContext } from '@codemirror/autocomplete';
import { lintGutter, setDiagnostics, type Diagnostic as CmDiagnostic } from '@codemirror/lint';
import { oneDark } from '@codemirror/theme-one-dark';
import type { Diagnostic } from '../core/mcu/types';

/** Arduino API surface offered by autocomplete (what the sketch interpreter / real cores provide). */
const API: [string, string, string][] = [
  ['pinMode', 'function', '(pin, INPUT|OUTPUT|INPUT_PULLUP)'], ['digitalWrite', 'function', '(pin, HIGH|LOW)'], ['digitalRead', 'function', '(pin) → int'],
  ['analogRead', 'function', '(pin) → ADC değeri'], ['analogWrite', 'function', '(pin, 0..255) PWM'], ['analogReadResolution', 'function', '(bits)'],
  ['delay', 'function', '(ms)'], ['delayMicroseconds', 'function', '(µs)'], ['millis', 'function', '() → ms'], ['micros', 'function', '() → µs'],
  ['tone', 'function', '(pin, frekans[, süre])'], ['noTone', 'function', '(pin)'], ['map', 'function', '(x, inMin, inMax, outMin, outMax)'], ['constrain', 'function', '(x, a, b)'],
  ['min', 'function', '(a, b)'], ['max', 'function', '(a, b)'], ['abs', 'function', '(x)'], ['pow', 'function', '(x, y)'], ['sqrt', 'function', '(x)'],
  ['sin', 'function', '(rad)'], ['cos', 'function', '(rad)'], ['random', 'function', '([min,] max)'], ['randomSeed', 'function', '(seed)'],
  ['bitRead', 'function', '(x, n)'], ['bitWrite', 'function', '(x, n, b)'], ['bitSet', 'function', '(x, n)'], ['bitClear', 'function', '(x, n)'],
  ['Serial.begin', 'method', '(baud)'], ['Serial.print', 'method', '(değer[, taban])'], ['Serial.println', 'method', '(değer[, taban])'], ['Serial.write', 'method', '(bayt)'],
  ['Serial.available', 'method', '() → int'], ['Serial.read', 'method', '() → int'],
  ['HIGH', 'constant', ''], ['LOW', 'constant', ''], ['INPUT', 'constant', ''], ['OUTPUT', 'constant', ''], ['INPUT_PULLUP', 'constant', ''], ['LED_BUILTIN', 'constant', ''],
  ['A0', 'constant', ''], ['A1', 'constant', ''], ['A2', 'constant', ''], ['PI', 'constant', ''],
  ['void setup', 'keyword', '() { }'], ['void loop', 'keyword', '() { }'], ['int', 'keyword', ''], ['float', 'keyword', ''], ['bool', 'keyword', ''], ['byte', 'keyword', ''],
  ['unsigned long', 'keyword', ''], ['const', 'keyword', ''], ['if', 'keyword', ''], ['else', 'keyword', ''], ['for', 'keyword', ''], ['while', 'keyword', ''], ['switch', 'keyword', ''], ['return', 'keyword', ''],
];

function complete(ctx: CompletionContext) {
  const w = ctx.matchBefore(/[A-Za-z_][A-Za-z0-9_.]*/);
  if (!w || (w.from === w.to && !ctx.explicit)) return null;
  return { from: w.from, options: API.map(([label, type, detail]) => ({ label, type, detail })), validFor: /^[A-Za-z0-9_.]*$/ };
}

export function CodeEditor({ value, onChange, diagnostics, readOnly }: { value: string; onChange: (v: string) => void; diagnostics: Diagnostic[]; readOnly?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const cb = useRef(onChange);
  cb.current = onChange;

  useEffect(() => {
    if (!host.current) return;
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(), highlightActiveLine(), highlightActiveLineGutter(), history(), indentOnInput(), bracketMatching(), closeBrackets(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }), cpp(), oneDark, lintGutter(),
          autocompletion({ override: [complete] }),
          keymap.of([...defaultKeymap, ...historyKeymap, ...completionKeymap, indentWithTab]),
          EditorState.readOnly.of(!!readOnly),
          EditorView.updateListener.of((u) => { if (u.docChanged) cb.current(u.state.doc.toString()); }),
          EditorView.theme({ '&': { height: '100%', fontSize: '12px' }, '.cm-scroller': { fontFamily: 'ui-monospace, Consolas, monospace' } }),
        ],
      }),
    });
    view.current = v;
    return () => { v.destroy(); view.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly]);

  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const doc = v.state.doc;
    const ds: CmDiagnostic[] = diagnostics.filter((d) => d.line >= 1 && d.line <= doc.lines).map((d) => {
      const line = doc.line(d.line);
      return { from: line.from, to: Math.max(line.to, line.from + 1), severity: d.severity, message: d.message };
    });
    v.dispatch(setDiagnostics(v.state, ds));
  }, [diagnostics, value]);

  return <div ref={host} className="h-full w-full overflow-hidden" />;
}
