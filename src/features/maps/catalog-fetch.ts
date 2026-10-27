// Fetches the maps or routing catalog (a small JSON on GitHub Releases), retrying a few times.
// A fresh install has no cached copy, and a single failed request (the network still waking up,
// a GitHub hiccup) left the setup wizard saying the country's map couldn't be downloaded until
// the app was restarted. A request that hangs counts as failed, or the wizard spins forever.

const RETRY_DELAYS_MS = [2000, 5000];
const TIMEOUT_MS = 20_000;

/** The catalog's text and what `parse` made of it; throws once every attempt failed. */
export async function fetchCatalog<T>(url: string, parse: (text: string) => T | null): Promise<{ text: string; manifest: T }> {
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { headers: { 'Cache-Control': 'no-cache' }, signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const manifest = parse(text);
      if (!manifest) throw new Error('bad manifest');
      return { text, manifest };
    } catch (e) {
      if (attempt >= RETRY_DELAYS_MS.length) throw e;
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    } finally {
      clearTimeout(timer);
    }
  }
}
