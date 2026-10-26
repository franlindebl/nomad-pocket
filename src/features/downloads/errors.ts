// What a failed download's error means for the person reading the Downloads sheet: the
// raw text comes from expo-file-system, URLSession, OkHttp or our own handlers
// ("Call to function 'FileSystemDownloadTask.start' has been rejected… CertPathValidator…").
// URLSession's text is localised (a Spanish iPhone says "Se ha perdido la conexión de red").
// No `@/` imports: unit tests load this file directly.

export type DownloadErrorKind = 'storage' | 'secure' | 'offline' | 'server' | 'integrity' | 'other';

export function downloadErrorKind(error: string | null | undefined): { kind: DownloadErrorKind; status?: number } {
  const e = error ?? '';
  if (e === 'NOT_ENOUGH_STORAGE' || /no space|ENOSPC|not enough (storage|space)/i.test(e)) return { kind: 'storage' };
  // The manager's own check against the size and hash the source promised.
  if (/^(SIZE|CHECKSUM)_MISMATCH\b/.test(e)) return { kind: 'integrity' };
  // A network that intercepts TLS (corporate proxies, captive portals) or a bad clock.
  if (/certificat|CertPath|trust anchor|TLS|SSL|secure connection|conexión segura|-1200|-1202/i.test(e)) return { kind: 'secure' };
  const http = /\bHTTP[ /]?(\d{3})\b|status(?: code)?[ :=]+(\d{3})/i.exec(e);
  if (http) return { kind: 'server', status: Number(http[1] ?? http[2]) };
  if (
    /network|internet|offline|timed? ?out|UnknownHost|unable to resolve|could not connect|connection (was )?(lost|reset|refused)|-1009|-1001|-1004|-1005/i.test(e) ||
    /conexión de red|tiempo de espera|no se ha podido conectar|no se ha encontrado ningún servidor/i.test(e)
  )
    return { kind: 'offline' };
  return { kind: 'other' };
}
