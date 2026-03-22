/**
 * Fetch wrapper that routes filesystem paths through Electron IPC
 * instead of HTTP fetch (which would hit the Vite dev server).
 * Supports Range requests for partial reads (used by potree octree loader).
 */

function isFilesystemPath(p: string): boolean {
  return (
    p.startsWith('/home/') ||
    p.startsWith('/tmp/') ||
    p.startsWith('/Users/') ||
    /^[A-Z]:\\/.test(p)
  );
}

/**
 * Parse a Range header like "bytes=100-999" into {start, end}.
 */
function parseRangeHeader(
  headers?: HeadersInit,
): { start: number; end: number } | null {
  if (!headers) return null;

  let rangeValue: string | undefined;
  if (headers instanceof Headers) {
    rangeValue = headers.get('Range') ?? undefined;
  } else if (Array.isArray(headers)) {
    const entry = headers.find(
      ([k]) => k.toLowerCase() === 'range',
    );
    rangeValue = entry?.[1];
  } else {
    // Record<string, string>
    for (const [k, v] of Object.entries(headers)) {
      if (k.toLowerCase() === 'range') {
        rangeValue = v;
        break;
      }
    }
  }

  if (!rangeValue) return null;

  const match = rangeValue.match(/bytes=(\d+)-(\d+)/);
  if (!match) return null;

  return { start: parseInt(match[1], 10), end: parseInt(match[2], 10) };
}

/**
 * Fetch a resource, using Electron IPC for absolute filesystem paths.
 * Falls back to regular fetch for URL routes.
 */
export async function electronFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;

  if (isFilesystemPath(url) && window.electron) {
    const range = parseRangeHeader(init?.headers);

    if (range) {
      const buffer = await window.electron.invoke<ArrayBuffer | null>(
        'read-file-range',
        { path: url, start: range.start, end: range.end },
      );

      if (!buffer) {
        return new Response(null, { status: 404, statusText: 'Not Found' });
      }

      return new Response(buffer, {
        status: 206,
        headers: { 'Content-Type': 'application/octet-stream' },
      });
    }

    const buffer = await window.electron.invoke<ArrayBuffer | null>(
      'read-file',
      { path: url },
    );

    if (!buffer) {
      return new Response(null, { status: 404, statusText: 'Not Found' });
    }

    return new Response(buffer, {
      status: 200,
      headers: { 'Content-Type': guessMimeType(url) },
    });
  }

  return fetch(input, init);
}

function guessMimeType(path: string): string {
  if (path.endsWith('.json')) return 'application/json';
  if (path.endsWith('.bin')) return 'application/octet-stream';
  return 'application/octet-stream';
}
