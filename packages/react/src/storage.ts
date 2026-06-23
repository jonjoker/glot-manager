/** Safe localStorage access (no-ops during SSR or when storage is blocked). */

export function readFlag(key: string): boolean | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(key);
    if (value === null) return null;
    return value === '1' || value === 'true';
  } catch {
    return null;
  }
}

export function writeFlag(key: string, value: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value ? '1' : '0');
  } catch {
    // ignore (private mode, quota, etc.)
  }
}
