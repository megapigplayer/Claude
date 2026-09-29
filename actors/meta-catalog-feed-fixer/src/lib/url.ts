/**
 * URL repair for link / image_link / additional_image_link (pure).
 *
 * Meta needs absolute http(s) URLs. Repairs are syntactic only: wrapper quotes, "&amp;", a missing "//",
 * uppercase scheme, protocol-relative ("//cdn...") and scheme-less hosts ("www.shop.com/p") get https,
 * relative paths are resolved against an explicit base URL, unsafe characters are percent-encoded.
 * Nothing is ever fetched: a URL that parses is not proven to exist.
 */

export type UrlFailCode = 'UNSUPPORTED_SCHEME' | 'RELATIVE_URL' | 'INVALID_URL';

export type UrlResult =
  | {
      ok: true;
      value: string;
      /** What was repaired (empty when the input was already fine). */
      notes: string[];
      /** true when a decision was assumed (https for a scheme-less host, base URL for a relative path). */
      assumed: boolean;
    }
  | { ok: false; code: UrlFailCode; message: string };

const FILE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'tif', 'tiff', 'html', 'htm', 'php', 'asp', 'aspx', 'pdf', 'css', 'js', 'json', 'xml', 'txt', 'mp4', 'mov']);
const HOST_LIKE = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d{1,5})?(?:[/?#].*)?$/i;

export interface UrlOptions {
  /** Absolute http(s) URL that relative links are resolved against (defaults.baseUrl). */
  baseUrl?: string | undefined;
}

export function normalizeUrl(raw: string, options: UrlOptions = {}): UrlResult {
  const notes: string[] = [];
  let assumed = false;
  let s = raw.trim();

  const wrapped = /^(?:"([^"]*)"|'([^']*)'|<([^<>]*)>)$/.exec(s);
  if (wrapped) {
    s = (wrapped[1] ?? wrapped[2] ?? wrapped[3] ?? '').trim();
    notes.push('wrapping quotes/brackets removed');
  }
  if (s === '') return { ok: false, code: 'INVALID_URL', message: 'URL is empty' };
  if (s.includes('&amp;')) {
    s = s.replace(/&amp;/g, '&');
    notes.push('"&amp;" decoded to "&"');
  }

  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):(?!\d+(?:\/|$))/.exec(s);
  let candidate: string;
  if (scheme) {
    const name = (scheme[1] as string).toLowerCase();
    if (name !== 'http' && name !== 'https') {
      return { ok: false, code: 'UNSUPPORTED_SCHEME', message: `"${raw}" uses the scheme "${name}:"; only http and https URLs are accepted` };
    }
    let rest = s.slice((scheme[1] as string).length + 1);
    if (/^\\\\/.test(rest)) {
      rest = rest.replace(/\\/g, '/');
      notes.push('backslashes replaced by slashes');
    }
    const slashes = /^\/*/.exec(rest)?.[0].length ?? 0;
    if (slashes === 2) {
      candidate = `${name}:${rest}`;
    } else if (slashes === 1 || slashes === 0) {
      candidate = `${name}://${rest.replace(/^\/+/, '')}`;
      notes.push('"://" restored after the scheme');
    } else {
      return { ok: false, code: 'INVALID_URL', message: `"${raw}" has too many slashes after the scheme` };
    }
    if (name !== scheme[1]) notes.push('scheme written in lower case');
  } else if (s.startsWith('//')) {
    candidate = `https:${s}`;
    notes.push('protocol-relative URL: https assumed');
    assumed = true;
  } else {
    const hostPart = s.split(/[/?#]/, 1)[0] as string;
    const lastLabel = hostPart.replace(/:\d+$/, '').split('.').pop()?.toLowerCase() ?? '';
    if (HOST_LIKE.test(s) && !FILE_EXTENSIONS.has(lastLabel)) {
      candidate = `https://${s}`;
      notes.push('no scheme: https assumed');
      assumed = true;
    } else if (options.baseUrl) {
      try {
        candidate = new URL(s, options.baseUrl).href;
        notes.push('relative URL resolved against defaults.baseUrl');
        assumed = true;
      } catch {
        return { ok: false, code: 'RELATIVE_URL', message: `"${raw}" is a relative URL and defaults.baseUrl could not resolve it` };
      }
    } else {
      return { ok: false, code: 'RELATIVE_URL', message: `"${raw}" is a relative URL; set defaults.baseUrl (e.g. https://shop.example.com) or write the absolute URL` };
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, code: 'INVALID_URL', message: `"${raw}" is not a valid URL` };
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.hostname === '') {
    return { ok: false, code: 'INVALID_URL', message: `"${raw}" is not a valid http(s) URL` };
  }
  // eslint-disable-next-line no-control-regex
  if (/[\s"<>\\^`{|}\u0000-\u001f]|[^\u0000-\u007f]/.test(candidate)) {
    const href = parsed.href;
    if (href !== candidate) {
      notes.push('spaces / special / non-ASCII characters percent-encoded');
      candidate = href;
    }
  }
  return { ok: true, value: candidate, notes, assumed };
}

/** Splits a multi-URL cell (additional_image_link) on separators that are followed by the start of another URL. */
export function splitUrlList(value: string): string[] {
  const parts = value.split(/[,;|\s]+(?=(?:https?:)?\/\/)/i).map((p) => p.trim()).filter((p) => p !== '');
  return parts;
}
