/**
 * The WebView reports the file name as title for pages without <title> (e.g.
 * "index.html"), and libzim the path for untitled entries ("files/Water (3).pdf"):
 * ignore those. Article titles that merely equal their path ("Madrid") are kept.
 */
export function pageTitle(title: string | undefined, path: string | undefined): string {
  const t = (title ?? '').trim();
  if (!t) return '';
  const file = (path ?? '').split('/').pop() ?? '';
  if (/\.(html?|php)$/i.test(t)) return '';
  if ((t === file || t === path) && /\.[a-z0-9]{2,4}$/i.test(file)) return '';
  return t;
}
