// I/O abstractions so the extractor runs the same in the app (fetch +
// expo-file-system) and in node tests (local files).

/** Random-access reads from a (usually remote) archive. */
export interface RangeSource {
  /** Identifies the archive (URL or path), for logs and errors. */
  readonly key: string;
  getBytes(offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array>;
}

/** Positional writes into the output archive. */
export interface Sink {
  write(offset: number, data: Uint8Array): Promise<void> | void;
}

export class AbortError extends Error {
  constructor() {
    super('Aborted');
    this.name = 'AbortError';
  }
}

export function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new AbortError();
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type FetchLike = (
  url: string,
  init: { headers: Record<string, string>; signal?: AbortSignal },
) => Promise<{ status: number; ok: boolean; headers: { get(name: string): string | null }; arrayBuffer(): Promise<ArrayBuffer> }>;

export type FetchSourceOptions = {
  fetch?: FetchLike;
  headers?: Record<string, string>;
  /** Attempts per request on network errors / 5xx (default 4). */
  retries?: number;
};

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener?.('abort', () => {
      clearTimeout(t);
      reject(new AbortError());
    });
  });

/**
 * HTTP Range reads. Requires `206 Partial Content`; a server that ignores Range
 * would make us download a 130 GB planet, so a 200 is treated as an error.
 * The first ETag seen is pinned with If-Match so a file replaced mid-extract fails
 * loudly instead of mixing two builds.
 */
export class FetchSource implements RangeSource {
  readonly key: string;
  private readonly fetchFn: FetchLike;
  private readonly headers: Record<string, string>;
  private readonly retries: number;
  private etag: string | null = null;

  constructor(url: string, opts: FetchSourceOptions = {}) {
    this.key = url;
    this.fetchFn = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.headers = opts.headers ?? {};
    this.retries = opts.retries ?? 4;
  }

  async getBytes(offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array> {
    if (length === 0) return new Uint8Array(0);
    let lastError: unknown;
    for (let attempt = 0; attempt < this.retries; attempt++) {
      throwIfAborted(signal);
      try {
        const headers: Record<string, string> = { ...this.headers, Range: `bytes=${offset}-${offset + length - 1}` };
        if (this.etag) headers['If-Match'] = this.etag;
        const res = await this.fetchFn(this.key, { headers, signal });
        if (res.status === 206) {
          const etag = res.headers.get('etag');
          if (etag && !this.etag && !etag.startsWith('W/')) this.etag = etag;
          const buf = new Uint8Array(await res.arrayBuffer());
          if (buf.length !== length) throw new HttpError(206, `short read: ${buf.length} of ${length} bytes`);
          return buf;
        }
        if (res.status === 412) throw new HttpError(412, 'archive changed on the server');
        if (res.status === 200) throw new HttpError(200, 'server does not support range requests');
        if (res.status === 416) throw new HttpError(416, 'requested range not satisfiable');
        lastError = new HttpError(res.status, `HTTP ${res.status}`);
        if (res.status < 500 && res.status !== 429) throw lastError;
      } catch (e) {
        if (signal?.aborted || (e as Error)?.name === 'AbortError') throw new AbortError();
        if (e instanceof HttpError && e.status < 500 && e.status !== 429) throw e;
        lastError = e;
      }
      await sleep(500 * Math.pow(2, attempt), signal);
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}

/** In-memory archive, for tests and small fixtures. */
export class BytesSource implements RangeSource {
  readonly key: string;
  private readonly data: Uint8Array;
  /** Every request made, for assertions on coalescing. */
  readonly requests: [number, number][] = [];

  constructor(data: Uint8Array, key = 'memory') {
    this.data = data;
    this.key = key;
  }

  async getBytes(offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array> {
    throwIfAborted(signal);
    this.requests.push([offset, length]);
    if (offset + length > this.data.length) throw new HttpError(416, 'range beyond end of archive');
    return this.data.slice(offset, offset + length);
  }
}

/** Grows an in-memory buffer; for tests. */
export class MemorySink implements Sink {
  private buf = new Uint8Array(0);
  size = 0;

  write(offset: number, data: Uint8Array) {
    const end = offset + data.length;
    if (end > this.buf.length) {
      const next = new Uint8Array(Math.max(end, this.buf.length * 2));
      next.set(this.buf);
      this.buf = next;
    }
    this.buf.set(data, offset);
    this.size = Math.max(this.size, end);
  }

  bytes(): Uint8Array {
    return this.buf.slice(0, this.size);
  }
}
