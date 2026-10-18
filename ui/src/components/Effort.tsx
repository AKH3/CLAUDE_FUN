import type { I18nKey } from '../i18n';
import { useT } from '../store';

const COLOR = ['', 'var(--done)', 'var(--todo)', 'var(--block)'];

/** Expected effort as 1-3 rising bars; `label` adds the word next to them. */
export function Effort({ e, label }: { e: number; label?: boolean }) {
  const t = useT();
  const name = t(`effort.${e}` as I18nKey);
  return (
    <span className="flex items-center gap-1" title={`${t('effort')}: ${name}`} role="img" aria-label={`${t('effort')}: ${name}`}>
      <span className="flex items-end gap-[2px]" dir="ltr">
        {[1, 2, 3].map((i) => (
          <span key={i} className="w-[3px] rounded-sm" style={{ height: 3 + i * 3, background: i <= e ? COLOR[e] : 'var(--line)' }} />
        ))}
      </span>
      {label && <span style={{ color: COLOR[e] }}>{name}</span>}
    </span>
  );
}
