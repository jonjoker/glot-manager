import type { ReactNode } from 'react';
import { useGlotContext } from './context.tsx';
import { EditableText } from './editable.tsx';
import type { UsageMeta } from './types.ts';

export interface TProps extends UsageMeta {
  /** The translation key. */
  id: string;
  /**
   * The text to show — your already-translated string, or a literal default.
   * Used as the fallback when no message is found for `id` (so the UI degrades
   * to readable source text, never a raw key).
   */
  children?: ReactNode;
  className?: string;
  title?: string;
}

/**
 * Render a translatable string. In normal use it renders the resolved text (or
 * `children`) with zero overhead; when an admin turns on edit mode it becomes a
 * highlighted, click-to-edit label.
 *
 * @example
 * ```tsx
 * <T id="home.hero.title">Welcome to Acme</T>
 * <T id="nav.pricing">{t('nav.pricing')}</T>
 * ```
 */
export function T(props: TProps): ReactNode {
  const ctx = useGlotContext();
  const { id, children, ...meta } = props;
  const content = ctx.resolve(id, children);

  if (!ctx.interactive || !id) {
    return <>{content}</>;
  }
  return (
    <EditableText translationKey={id} {...meta}>
      {content}
    </EditableText>
  );
}
