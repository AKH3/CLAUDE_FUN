import type { Lang } from '../i18n';
import { useBoard, useT } from '../store';
import { Icon } from './Icon';

interface Cmd {
  label: Record<Lang, string>;
  text: Record<Lang, string> | string;
  /** needs the claude-board-setup skill */
  skill?: boolean;
}

const INSTALL_URL = 'https://github.com/AKH3/CLAUDE_FUN/archive/refs/heads/main.tar.gz';
// PowerShell blocks the .ps1 shims by default, so Windows users get the .cmd ones
const win = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent);
const exe = (name: string) => (win ? `${name}.cmd` : name);

const CLAUDE: Cmd[] = [
  { label: { ar: 'خطة جديدة', en: 'New plan' }, text: { ar: 'خطط لبناء …', en: 'Plan how to build …' } },
  { label: { ar: 'كمّل الشغل', en: 'Carry on' }, text: { ar: 'كمّل الخطوات المعتمدة', en: 'Continue with the approved steps' } },
  { label: { ar: 'وين وصلنا؟', en: 'Where are we?' }, text: { ar: 'لخّص لي حالة اللوحة في سطرين', en: 'Summarise the board in two lines' } },
  { label: { ar: 'اشرح خطوة', en: 'Explain a step' }, text: { ar: 'اشرح الخطوة S2.3 باختصار وما فائدتها', en: 'Briefly explain step S2.3 and why it matters' } },
  { label: { ar: 'قسّم خطوة', en: 'Split a step' }, text: { ar: 'قسّم الخطوة S2.3 إلى خطوات أصغر', en: 'Split step S2.3 into smaller steps' } },
  { label: { ar: 'أضف مرحلة', en: 'Add a phase' }, text: { ar: 'أضف مرحلة لـ … مع خطواتها', en: 'Add a phase for … with its steps' } },
  { label: { ar: 'جاوب الأسئلة', en: 'Answer questions' }, text: { ar: 'جاوب على أسئلة ❔ المعلّقة في اللوحة', en: 'Answer the pending ❔ questions on the board' } },
  { label: { ar: 'حدّث الأداة', en: 'Update the tool' }, text: { ar: 'حدّث لوحة كلاود', en: 'Update Claude Board' }, skill: true },
  { label: { ar: 'ثبّت في مشروع', en: 'Install in a project' }, text: { ar: 'ثبّت لوحة كلاود في هذا المجلد', en: 'Install Claude Board in this folder' }, skill: true },
  { label: { ar: 'أزل من المشروع', en: 'Remove from project' }, text: { ar: 'أزل لوحة كلاود من هذا المشروع', en: 'Remove Claude Board from this project' }, skill: true },
  { label: { ar: 'تحديث على فرع', en: 'Change on a branch' }, text: { ar: 'اشتغل على فرع جديد، وارفعه وافتح PR', en: 'Work on a new branch, push it and open a PR' } },
];

const TERMINAL: Cmd[] = [
  { label: { ar: 'افتح اللوحة', en: 'Open the board' }, text: exe('claude-fun') },
  { label: { ar: 'ملخص سريع', en: 'Quick summary' }, text: `${exe('claude-fun')} status` },
  { label: { ar: 'رقم النسخة', en: 'Version' }, text: `${exe('claude-fun')} --version` },
  { label: { ar: 'حدّث الأداة', en: 'Update the tool' }, text: `${exe('npm')} i -g --prefer-online ${INSTALL_URL}` },
  { label: { ar: 'كمّل آخر محادثة', en: 'Resume last chat' }, text: 'claude --continue' },
  { label: { ar: 'جهّز مشروعاً', en: 'Set up a project' }, text: `${exe('claude-fun')} init` },
  { label: { ar: 'جرّب بدون مشروع', en: 'Try without a project' }, text: `${exe('claude-fun')} demo --simulate` },
];

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // older browsers / blocked clipboard: fall back to a hidden textarea
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

function Group({ title, icon, cmds }: { title: string; icon: 'send' | 'terminal'; cmds: Cmd[] }) {
  const lang = useBoard((s) => s.lang);
  const toast = useBoard((s) => s.toast);
  const t = useT();
  return (
    <section className="border-t border-line px-3 py-3">
      <h3 className="mb-2 flex items-center gap-1.5 px-1 text-[12px] font-semibold text-muted">
        <Icon name={icon} size={13} />
        {title}
      </h3>
      <ul className="space-y-1">
        {cmds.map((c) => {
          const text = typeof c.text === 'string' ? c.text : c.text[lang];
          return (
            <li key={c.label.en}>
              <button
                type="button"
                onClick={async () => (await copy(text)) && toast('done', `${t('cmd.copied')} · ${c.label[lang]}`)}
                className="group w-full rounded-lg border border-transparent px-2 py-1.5 text-start transition hover:border-line hover:bg-panel2"
              >
                <span className="flex items-center gap-1.5 text-[11.5px] text-muted">
                  {c.label[lang]}
                  {c.skill && <span className="rounded bg-gold/15 px-1 text-[10px] text-gold">skill</span>}
                  <Icon name="copy" size={12} className="ms-auto opacity-0 transition group-hover:opacity-100" />
                </span>
                {typeof c.text === 'string' ? (
                  <code dir="ltr" className="mt-0.5 block text-start font-mono text-[12px] break-all text-ok">
                    {text}
                  </code>
                ) : (
                  <span dir="auto" className="mt-0.5 block text-[13.5px] font-medium">
                    {text}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Copy-ready phrases for Claude and terminal commands. */
export function CommandsPanel({ onClose }: { onClose: () => void }) {
  const t = useT();
  return (
    <aside className="scroll-thin absolute inset-y-0 start-0 z-20 flex w-[min(360px,100vw)] flex-col overflow-y-auto border-e border-line bg-panel shadow-[var(--shadow)]">
      <div className="sticky top-0 z-10 flex items-center gap-2 bg-panel px-4 py-3">
        <Icon name="terminal" size={16} />
        <span className="font-semibold">{t('cmd.title')}</span>
        <button type="button" onClick={onClose} className="ms-auto grid size-8 place-items-center rounded-lg text-muted hover:bg-panel2" aria-label={t('act.close')}>
          <Icon name="x" size={16} />
        </button>
      </div>
      <p className="border-t border-line px-4 py-3 text-[12px] leading-relaxed text-muted">{t('cmd.hint')}</p>
      <Group title={t('cmd.claude')} icon="send" cmds={CLAUDE} />
      <Group title={t('cmd.terminal')} icon="terminal" cmds={TERMINAL} />
    </aside>
  );
}
