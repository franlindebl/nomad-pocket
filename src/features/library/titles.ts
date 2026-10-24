/** The WebView reports the file name as title for pages without <title>: ignore those. */
export function pageTitle(title: string | undefined, path: string | undefined): string {
  const t = (title ?? '').trim();
  if (!t) return '';
  const file = (path ?? '').split('/').pop() ?? '';
  if (t === path || t === file || /\.(html?|php)$/i.test(t)) return '';
  return t;
}
