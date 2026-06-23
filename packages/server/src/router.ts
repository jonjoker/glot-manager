/** Parsed Glot Manager route, relative to the configured `basePath`. */
export type GlotRoute =
  | { name: 'config' }
  | { name: 'entries' }
  | { name: 'entry'; key: string }
  | { name: 'translate'; key: string }
  | { name: 'usages'; key: string };

export interface MatchedRoute {
  route: GlotRoute;
  /** HTTP methods this route accepts (for 405 `Allow` headers). */
  allow: string[];
}

/**
 * Match a request URL to a Glot Manager route. Returns `null` if the path is not under
 * `basePath` (the caller should 404), or `'unknown'` if it is under `basePath`
 * but matches no route.
 */
export function matchRoute(pathname: string, basePath: string): MatchedRoute | 'unknown' | null {
  if (pathname !== basePath && !pathname.startsWith(`${basePath}/`)) {
    return null;
  }
  const rest = pathname.slice(basePath.length).replace(/^\/+/, '').replace(/\/+$/, '');
  const segments = rest.length === 0 ? [] : rest.split('/').map(decodeSegment);

  if (segments.length === 1 && segments[0] === 'config') {
    return { route: { name: 'config' }, allow: ['GET'] };
  }
  if (segments.length === 1 && segments[0] === 'entries') {
    return { route: { name: 'entries' }, allow: ['GET'] };
  }
  if (segments.length === 2 && segments[0] === 'entries') {
    return { route: { name: 'entry', key: segments[1]! }, allow: ['GET', 'PUT'] };
  }
  if (segments.length === 3 && segments[0] === 'entries' && segments[2] === 'translate') {
    return { route: { name: 'translate', key: segments[1]! }, allow: ['POST'] };
  }
  if (segments.length === 3 && segments[0] === 'entries' && segments[2] === 'usages') {
    return { route: { name: 'usages', key: segments[1]! }, allow: ['GET'] };
  }

  return 'unknown';
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
