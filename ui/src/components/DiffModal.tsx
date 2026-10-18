import { useEffect, useMemo, useState } from 'react';
import { useBoard, useT } from '../store';
import { Icon } from './Icon';

interface FileDiff {
  file: string;
  ins: number;
  del: number;
  lines: string[];
}

export function parseDiff(text: string): FileDiff[] {
  const out: FileDiff[] = [];
  let cur: FileDiff | undefined;
  for (const line of text.split('\n')) {
    const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (m) {
      cur = { file: m[2], ins: 0, del: 0, lines: [] };
      out.push(cur);
      continue;
    }
    if (!cur || /^(index |--- |\+\+\+ |new file mode|deleted file mode|similarity|rename )/.test(line)) continue;
    if (line.startsWith('+')) cur.ins++;
    else if (line.startsWith('-')) cur.del++;
    cur.lines.push(line);
  }
  return out;
}

const lineClass = (l: string) =>
  l.startsWith('@@')
    ? 'bg-ok/10 text-ok'
    : l.startsWith('+')
      ? 'bg-done/12 text-done'
      : l.startsWith('-')
        ? 'bg-fail/12 text-fail'
        : l.startsWith('\\')
          ? 'text-muted italic'
          : 'text-text/85';

export function DiffModal() {
  const t = useT();
  const target = useBoard((s) => s.diff);
  const close = useBoard((s) => s.closeDiff);
  const state = useBoard((s) => s.state);
  const [text, setText] = useState<string | undefined>();
  const [active, setActive] = useState<string | undefined>();

  useEffect(() => {
    if (!target) return;
    setText(undefined);
    setActive(target.file);
    fetch(`api/diff/${encodeURIComponent(target.id)}`)
      .then((r) => (r.ok ? r.text() : ''))
      .then(setText)
      .catch(() => setText(''));
  }, [target]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const files = useMemo(() => parseDiff(text ?? ''), [text]);
  if (!target) return null;
  const step = state?.steps.find((x) => x.id === target.id);
  const shown = active ? files.filter((f) => f.file === active) : files;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-3 backdrop-blur-sm" onMouseDown={close}>
      <div className="flex h-[min(86vh,900px)] w-[min(1200px,100%)] flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-[var(--shadow)]" onMouseDown={(e) => e.stopPropagation()}>
        <header className="flex items-center gap-3 border-b border-line px-4 py-3">
          <Icon name="diff" size={16} />
          <span className="font-semibold">{t('diff.title')}</span>
          <span className="font-mono text-[12px] text-muted" dir="ltr">
            {target.id}
          </span>
          <span dir="auto" className="truncate text-[13px] text-muted">
            {step?.t}
          </span>
          <button type="button" onClick={close} className="ms-auto grid size-8 place-items-center rounded-lg text-muted hover:bg-panel2 hover:text-text" aria-label={t('act.close')}>
            <Icon name="x" size={16} />
          </button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col md:flex-row" dir="ltr">
          <nav className="scroll-thin max-h-40 shrink-0 overflow-auto border-b border-line p-2 md:max-h-none md:w-64 md:border-r md:border-b-0">
            <button type="button" onClick={() => setActive(undefined)} className={`mb-1 w-full rounded-md px-2 py-1.5 text-start text-[12.5px] ${!active ? 'bg-panel2' : 'hover:bg-panel2'}`}>
              {t('diff.all')} ({files.length})
            </button>
            {files.map((f) => (
              <button
                key={f.file}
                type="button"
                onClick={() => setActive(f.file)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-start font-mono text-[12px] ${active === f.file ? 'bg-panel2' : 'hover:bg-panel2'}`}
              >
                <span className="flex-1 truncate">{f.file}</span>
                <span className="text-done">+{f.ins}</span>
                <span className="text-fail">−{f.del}</span>
              </button>
            ))}
          </nav>
          <div className="scroll-thin min-h-0 flex-1 overflow-auto bg-bg">
            {text === undefined ? (
              <div className="p-6 text-muted">…</div>
            ) : !files.length ? (
              <div className="p-6 text-muted">{t('diff.empty')}</div>
            ) : (
              shown.map((f) => (
                <section key={f.file} className="border-b border-line">
                  <div className="sticky top-0 bg-panel2 px-3 py-1.5 font-mono text-[12px] font-semibold">{f.file}</div>
                  <pre className="font-mono text-[12px] leading-[1.55]">
                    {f.lines.map((l, i) => (
                      <div key={i} className={`px-3 whitespace-pre-wrap ${lineClass(l)}`}>
                        {l || ' '}
                      </div>
                    ))}
                  </pre>
                </section>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
