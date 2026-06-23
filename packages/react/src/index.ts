/**
 * `@glot-manager/react` — the React client for Glot Manager.
 *
 * One provider, one component, one hook. The in-context editor overlay is
 * code-split and only loads for authorized admins who turn on edit mode — end
 * users download ~0 KB extra and see no markers in the DOM.
 */

export { GlotProvider, useGlotContext, type GlotContextValue } from './context.tsx';
export { T, type TProps } from './T.tsx';
export { EditableText, type EditableTextProps } from './editable.tsx';
export { EditModeToggle, type EditModeToggleProps } from './toggle.tsx';
export { useGlot, useT, type UseGlot } from './hooks.ts';
export { GlotClient, GlotApiError, type GlotClientOptions } from './client.ts';
export { getMountedUsages } from './dom-usage.ts';
export type { GlotProviderProps, Messages, UsageMeta } from './types.ts';
