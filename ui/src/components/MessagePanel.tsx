import { useEffect, useRef, useState } from 'react';
import type { Lang } from '../i18n';
import { useBoard, useT } from '../store';
import { Icon, type IconName } from './Icon';

type Text = Record<Lang, string>;

// Starting points the user edits before sending, so "…" gets filled in.
const IDEAS: { label: Text; text: Text }[] = [
  { label: { ar: 'خطة جديدة', en: 'New plan' }, text: { ar: 'خطط لـ …', en: 'Plan …' } },
  { label: { ar: 'كمّل الشغل', en: 'Carry on' }, text: { ar: 'كمّل الخطوات المعتمدة', en: 'Continue with the approved steps' } },
  { label: { ar: 'مرحلة إضافية', en: 'Another phase' }, text: { ar: 'أضف مرحلة لـ … مع خطواتها', en: 'Add a phase for … with its steps' } },
  { label: { ar: 'تأكد من الشغل', en: 'Check the work' }, text: { ar: 'راجع آخر خطوة خلصت وتأكد إنها شغّالة', en: 'Review the last finished step and make sure it works' } },
  { label: { ar: 'حدّث اللوحة', en: 'Update the board' }, text: { ar: 'حدّث لوحة كلاود لآخر نسخة', en: 'Update Claude Board to the latest version' } },
];

// What each button on a card does, so nothing on the board needs a typed command.
const BUTTONS: { icon: IconName; label: Text; does: Text }[] = [
  { icon: 'play', label: { ar: 'ابدأ', en: 'Start' }, does: { ar: 'يبدأ كلاود هذي الخطوة', en: 'Claude starts this step' } },
  { icon: 'help', label: { ar: '؟', en: '?' }, does: { ar: 'يشرح لك وش الخطوة وليش', en: 'Explains the step and why' } },
  { icon: 'list', label: { ar: '#', en: '#' }, does: { ar: 'اختر عدة خطوات بالترتيب ثم «ابدأ بالترتيب»', en: 'Pick several steps in order, then "Start in order"' } },
  { icon: 'info', label: { ar: 'اضغط البطاقة', en: 'Click a card' }, does: { ar: 'تقسيم، رفض، إعادة، ملاحظة، تعديلات', en: 'Split, reject, retry, note, changes' } },
];

/** Write to Claude from the board: the message wakes an idle session, no chat needed. */
export function MessagePanel({ onClose }: { onClose: () => void }) {
  const t = useT();
  const lang = useBoard((s) => s.lang);
  const act = useBoard((s) => s.act);
  const live = useBoard((s) => s.live());
  const [v, setV] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);
  // selection to apply once React has put a filled-in idea into the box
  const sel = useRef<[number, number]>(undefined);
  useEffect(() => {
    if (!sel.current || !box.current) return;
    box.current.focus();
    box.current.setSelectionRange(...sel.current);
    sel.current = undefined;
  }, [v]);

  const send = async () => {
    const x = v.trim();
    if (x && (await act({ type: 'note', x }))) setV('');
  };
  const fill = (text: string) => {
    // select the "…" so the user types straight over it
    const at = text.indexOf('…');
    sel.current = at >= 0 ? [at, at + 1] : [text.length, text.length];
    setV(text);
  };

  return (
    <aside className="scroll-thin absolute inset-y-0 start-0 z-20 flex w-[min(380px,100vw)] flex-col overflow-y-auto border-e border-line bg-panel shadow-[var(--shadow)]">
      <div className="sticky top-0 z-10 flex items-center gap-2 bg-panel px-4 py-3">
        <Icon name="chat" size={16} />
        <span className="font-semibold">{t('msg.title')}</span>
        <button type="button" onClick={onClose} className="ms-auto grid size-8 place-items-center rounded-lg text-muted hover:bg-panel2" aria-label={t('act.close')}>
          <Icon name="x" size={16} />
        </button>
      </div>

      <section className="border-t border-line px-4 py-3">
        <textarea
          ref={box}
          rows={4}
          dir="auto"
          value={v}
          autoFocus
          placeholder={t('msg.placeholder')}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              send();
            }
          }}
          maxLength={500}
          className="w-full resize-y rounded-lg border border-line bg-bg px-3 py-2 text-[14px] leading-relaxed outline-none placeholder:text-muted focus:border-ok"
        />
        <button
          type="button"
          onClick={send}
          disabled={!v.trim()}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-done px-3 py-2 text-[14px] font-semibold text-[var(--bg)] transition hover:brightness-110 disabled:opacity-40"
        >
          <Icon name="send" size={15} />
          {t('act.send')}
        </button>
        <p className={`mt-2 text-[12px] leading-relaxed ${live ? 'text-muted' : 'text-todo'}`}>{t(live ? 'msg.live' : 'msg.later')}</p>
      </section>

      <section className="border-t border-line px-3 py-3">
        <h3 className="mb-2 px-1 text-[12px] font-semibold text-muted">{t('msg.ideas')}</h3>
        <ul className="flex flex-wrap gap-1.5">
          {IDEAS.map((idea) => (
            <li key={idea.label.en}>
              <button
                type="button"
                onClick={() => fill(idea.text[lang])}
                title={idea.text[lang]}
                className="rounded-full border border-line px-3 py-1.5 text-[13px] transition hover:border-ok hover:text-ok"
              >
                {idea.label[lang]}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="border-t border-line px-3 py-3">
        <h3 className="mb-2 px-1 text-[12px] font-semibold text-muted">{t('msg.help')}</h3>
        <ul className="space-y-1.5">
          {BUTTONS.map((b) => (
            <li key={b.label.en} className="flex items-center gap-2.5 rounded-lg px-1 py-1 text-[13px]">
              <span className="flex min-w-24 shrink-0 items-center gap-1.5 rounded-md bg-panel2 px-2 py-1 text-[12px] font-medium">
                <Icon name={b.icon} size={13} className="text-ok" />
                {b.label[lang]}
              </span>
              <span className="text-muted">{b.does[lang]}</span>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
