import type { ReactNode } from 'react';
import { useGlotContext } from './context.tsx';
import type { UsageMeta } from './types.ts';

export interface EditableTextProps extends UsageMeta {
  /** The translation key this text maps to. */
  translationKey: string;
  children: ReactNode;
  className?: string;
  title?: string;
}

/**
 * Wraps already-rendered text and makes it click-to-edit when the editor is
 * active. When inactive it renders `children` verbatim — no wrapper element, no
 * data attributes, zero visual or DOM change. Usually you'll use {@link T}
 * instead, which resolves the text for you.
 */
export function EditableText(props: EditableTextProps): ReactNode {
  const ctx = useGlotContext();
  const {
    translationKey,
    children,
    className,
    title,
    usageId,
    usageLabel,
    usageRoute,
    usageSubItem,
    usageNotes,
  } = props;

  if (!ctx.interactive || !translationKey) {
    return <>{children}</>;
  }

  return (
    <span
      role="button"
      tabIndex={0}
      className={['glot-editable', className].filter(Boolean).join(' ')}
      title={title ?? translationKey}
      data-glot-key={translationKey}
      data-glot-usage-id={usageId}
      data-glot-usage-label={usageLabel}
      data-glot-usage-route={usageRoute}
      data-glot-usage-subitem={usageSubItem}
      data-glot-usage-notes={usageNotes}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        ctx.openEditor(translationKey);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
          ctx.openEditor(translationKey);
        }
      }}
    >
      {children}
    </span>
  );
}
