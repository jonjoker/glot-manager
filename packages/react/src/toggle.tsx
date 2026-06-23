import type { ReactNode } from 'react';
import { useGlotContext } from './context.tsx';

export interface EditModeToggleProps {
  /** Switch label. Default `"Translation edit mode"`. */
  label?: ReactNode;
  className?: string;
}

/**
 * A ready-made switch for turning edit mode on and off. Renders nothing for
 * non-admins. Drop it anywhere in your admin UI, or build your own with
 * `useGlot().toggleEditMode`.
 */
export function EditModeToggle({
  label = 'Translation edit mode',
  className,
}: EditModeToggleProps): ReactNode {
  const ctx = useGlotContext();
  if (!ctx.isAdmin) return null;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={ctx.editMode}
      className={['glot-toggle', className].filter(Boolean).join(' ')}
      onClick={ctx.toggleEditMode}
    >
      <span className="glot-toggle-track" data-on={ctx.editMode ? 'true' : 'false'}>
        <span className="glot-toggle-thumb" />
      </span>
      <span>{label}</span>
    </button>
  );
}
