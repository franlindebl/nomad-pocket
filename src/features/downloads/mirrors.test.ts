import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  contentRangeTotal,
  parseMetalinkIntegrity,
  parseMetalinkPieces,
  parseMetalinkUrls,
  planSources,
  probeThroughput,
  type ProbeFetch,
} from './mirrors.ts';

test('parseMetalinkUrls keeps https mirrors of the file, by priority', () => {
  const xml = `<metalink><file name="w.zim">
    <url>https://kiwix.org</url>
    <url location="dk" priority="3">https://mirrors.dotsrc.org/kiwix/zim/w.zim</url>
    <url location="fr" priority="1">https://mirror.download.kiwix.org/zim/w.zim</url>
    <url location="xx" priority="2">http://insecure.example/zim/w.zim</url>
    <url location="nl" priority="2">https://ftp.nluug.nl/pub/kiwix/zim/w.zim</url>
  </file></metalink>`;
  assert.deepEqual(parseMetalinkUrls(xml, 'w.zim'), [
    'https://mirror.download.kiwix.org/zim/w.zim',
    'https://ftp.nluug.nl/pub/kiwix/zim/w.zim',
    'https://mirrors.dotsrc.org/kiwix/zim/w.zim',
  ]);
});

// Trimmed from https://download.kiwix.org/zim/devdocs/devdocs_en_bash_2026-10.zim.meta4
const META4 = `<?xml version="1.0" encoding="UTF-8"?>
<metalink xmlns="urn:ietf:params:xml:ns:metalink">
  <generator>MirrorBrain/2.19.0</generator>
  <file name="devdocs_en_bash_2026-10.zim">
    <size>572117</size>

    <!-- <mtime>1791195689</mtime> -->
    <!-- <size>1</size> -->
    <hash type="md5">16955e8143f5972926ac4460f927ba86</hash>
    <hash type="sha-1">1e9361e0816b853e3e30b79a3324dfadb3349a1e</hash>
    <hash type="sha-256">EA4AFB04DDF90F31363829EF9FA2485405DC05BD1FC62B4626245FE70C24735D</hash>
    <pieces length="4194304" type="sha-1">
      <hash>1e9361e0816b853e3e30b79a3324dfadb3349a1e</hash>
    </pieces>
    <url location="fr" priority="1">https://mirror.download.kiwix.org/zim/devdocs/devdocs_en_bash_2026-10.zim</url>
  </file>
</metalink>`;

test('parseMetalinkIntegrity reads the size and the whole-file sha-256', () => {
  assert.deepEqual(parseMetalinkIntegrity(META4, 'devdocs_en_bash_2026-10.zim'), {
    size: 572117,
    sha256: 'ea4afb04ddf90f31363829ef9fa2485405dc05bd1fc62b4626245fe70c24735d',
  });
  // Another file's metalink, or none at all: nothing to check.
  assert.deepEqual(parseMetalinkIntegrity(META4, 'devdocs_en_bash_2026-09.zim'), {});
  assert.deepEqual(parseMetalinkIntegrity('<html>404</html>', 'w.zim'), {});
  assert.deepEqual(parseMetalinkIntegrity('<metalink><file name="w.zim"><size>12</size></file></metalink>', 'w.zim'), { size: 12 });
});

test('parseMetalinkPieces reads the sha-1 of every piece, only when they cover the file', () => {
  assert.deepEqual(parseMetalinkPieces(META4, 'devdocs_en_bash_2026-10.zim', 572117), {
    length: 4194304,
    sha1: ['1e9361e0816b853e3e30b79a3324dfadb3349a1e'],
  });
  // 2 pieces promised for a size that needs 3: no piece checks.
  const two = `<metalink><file name="w.zim"><pieces length="4" type="sha-1"><hash>${'a'.repeat(40)}</hash><hash>${'b'.repeat(40)}</hash></pieces></file></metalink>`;
  assert.equal(parseMetalinkPieces(two, 'w.zim', 9), undefined);
  assert.equal(parseMetalinkPieces(two, 'w.zim', 8)?.sha1.length, 2);
  assert.equal(parseMetalinkPieces(two.replace('sha-1', 'md5'), 'w.zim', 8), undefined);
  assert.equal(parseMetalinkPieces('<html>404</html>', 'w.zim'), undefined);
});

test('contentRangeTotal', () => {
  assert.equal(contentRangeTotal('bytes 0-0/13312345678'), 13312345678);
  assert.equal(contentRangeTotal('bytes 0-0/*'), undefined);
  assert.equal(contentRangeTotal(null), undefined);
});

/**
 * A fake network: each host answers ranges at `bps` bytes per second of fake time, in 64 KiB
 * reads, after `latency` ms. `ranges: false` answers 200 (a mirror ignoring Range).
 */
function fakeNet(hosts: Record<string, { bps: number; latency?: number; ranges?: boolean; fail?: boolean }>, size: number, metalink?: string) {
  let t = 0;
  const now = () => t;
  const asked: string[] = [];
  const fetch: ProbeFetch = async (url, init) => {
    asked.push(url);
    if (url.endsWith('.meta4'))
      return { status: metalink ? 200 : 404, ok: !!metalink, headers: { get: () => null }, body: null, text: async () => metalink ?? '' };
    const host = /^https:\/\/([^/]+)/.exec(url)![1];
    const h = hosts[host];
    if (!h || h.fail) throw new Error('Network request failed');
    const m = /bytes=(\d+)-(\d+)/.exec(init.headers?.Range ?? '')!;
    const len = Number(m[2]) - Number(m[1]) + 1;
    // Each request has its own clock: the shared one shows it after each read.
    let local = t + (h.latency ?? 0);
    let sent = 0;
    const reader = {
      read: async () => {
        if (sent >= len) return { done: true };
        const n = Math.min(65536, len - sent);
        sent += n;
        local += (n * 1000) / h.bps;
        t = local;
        return { done: false, value: new Uint8Array(n) };
      },
      cancel: async () => {},
    };
    return {
      status: h.ranges === false ? 200 : 206,
      ok: true,
      headers: { get: (k: string) => (k === 'content-range' ? `bytes ${m[1]}-${m[2]}/${size}` : null) },
      body: { getReader: () => reader },
      text: async () => '',
    };
  };
  return { fetch, now, asked };
}

const metalinkFor = (name: string, size: number, hosts: string[]) =>
  `<metalink><file name="${name}"><size>${size}</size>${hosts.map((h, i) => `<url priority="${i + 1}">https://${h}/zim/${name}</url>`).join('')}</file></metalink>`;

test('probeThroughput measures speed after the first byte, not the time to answer', async () => {
  // Quick to answer but slow, and slow to answer but fast (measurement 1 of the plan).
  const net = fakeNet({ quick: { bps: 3.5e6, latency: 50 }, accum: { bps: 23e6, latency: 900 } }, 36e9);
  const quick = await probeThroughput(net.fetch, 'https://quick/w.zim', 36e9, { now: net.now, random: () => 0.5 });
  const accum = await probeThroughput(net.fetch, 'https://accum/w.zim', 36e9, { now: net.now, random: () => 0.5 });
  assert.ok(Math.abs(quick.bps - 3.5e6) / 3.5e6 < 0.05, `quick ${quick.bps}`);
  assert.ok(Math.abs(accum.bps - 23e6) / 23e6 < 0.05, `accum ${accum.bps}`);
  assert.equal(accum.total, 36e9);
  const ignoring = fakeNet({ x: { bps: 50e6, ranges: false } }, 36e9);
  assert.equal((await probeThroughput(ignoring.fetch, 'https://x/w.zim', 36e9, { now: ignoring.now })).bps, 0);
});

test('planSources ranks every Kiwix mirror by throughput, past the first four', async () => {
  const name = 'wikipedia_es_all_nopic_2026-10.zim';
  const size = 13.3e9;
  const hosts = ['lb-target', 'nluug', 'fau', 'mirrorservice', 'driftless', 'dead', 'bad-copy'];
  const net = fakeNet(
    {
      'lb-target': { bps: 0.4e6 },
      nluug: { bps: 3.5e6 },
      fau: { bps: 2.4e6 },
      mirrorservice: { bps: 4.7e6 },
      driftless: { bps: 8.7e6 }, // 5th by priority: never tried before
      dead: { bps: 1, fail: true },
      'bad-copy': { bps: 90e6 },
    },
    size,
    metalinkFor(name, size, hosts),
  );
  // One probe at a time on the fake clock (the app runs them together).
  let queue = Promise.resolve();
  const probe: typeof probeThroughput = (f, url, s) => {
    const run = queue.then(() => probeThroughput(f, url, s, { now: net.now }));
    queue = run.then(() => undefined);
    return run;
  };
  const plan = await planSources(`https://download.kiwix.org/zim/wikipedia/${name}`, { fetch: net.fetch, avoid: ['bad-copy'], probe });
  assert.deepEqual(
    plan.sources.map((s) => s.host),
    ['driftless', 'mirrorservice', 'nluug', 'fau', 'lb-target'],
  );
  assert.equal(plan.size, size);
  assert.ok(plan.ranges);
});

test('planSources: other URLs are one source; the range answer gives the size', async () => {
  const net = fakeNet({ 'github.com': { bps: 16e6 } }, 2_147_483_648);
  const plan = await planSources('https://github.com/x/releases/download/maps/es.pmtiles.part00', { fetch: net.fetch });
  assert.deepEqual(
    plan.sources.map((s) => s.url),
    ['https://github.com/x/releases/download/maps/es.pmtiles.part00'],
  );
  assert.equal(plan.size, 2_147_483_648);
  assert.ok(plan.ranges);
  assert.ok(!net.asked.some((u) => u.endsWith('.meta4')), 'only Kiwix files have a metalink');
  const noRanges = fakeNet({ 'cdn.example': { bps: 16e6, ranges: false } }, 100);
  assert.equal((await planSources('https://cdn.example/f', { fetch: noRanges.fetch })).ranges, false);
});

test('planSources reuses recent measurements: no probe when they cover every mirror', async () => {
  const name = 'knots_en_all.zim';
  const meta = metalinkFor(name, 28e6, ['a', 'b', 'c']);
  const net = fakeNet({ a: { bps: 5e6 }, b: { bps: 9e6 }, c: { bps: 1e6 } }, 28e6, meta);
  const url = `https://download.kiwix.org/zim/other/${name}`;
  const first = await planSources(url, { fetch: net.fetch });
  assert.equal(first.measured?.length, 3);
  // c failed last time: left out.
  const known = new Map([
    ['a', 5e6],
    ['b', 9e6],
    ['c', 0],
  ]);
  net.asked.length = 0;
  const again = await planSources(url, { fetch: net.fetch, known });
  assert.deepEqual(
    again.sources.map((s) => s.host),
    ['b', 'a'],
  );
  assert.equal(again.measured, undefined);
  assert.deepEqual(net.asked, [`${url}.meta4`], 'only the metalink, no probes');
  // A mirror never measured: everything is probed again.
  known.delete('a');
  net.asked.length = 0;
  await planSources(url, { fetch: net.fetch, known });
  assert.equal(net.asked.length, 4);
});

test('planSources falls back to the original URL when the metalink or every mirror fails', async () => {
  const url = 'https://download.kiwix.org/zim/w.zim';
  const noMeta = fakeNet({ 'download.kiwix.org': { bps: 1e6 } }, 1000);
  assert.deepEqual(
    (await planSources(url, { fetch: noMeta.fetch })).sources.map((s) => s.url),
    [url],
  );
  const allDead = fakeNet({ 'download.kiwix.org': { bps: 1e6 }, a: { bps: 1, fail: true } }, 1000, metalinkFor('w.zim', 1000, ['a']));
  const plan = await planSources(url, { fetch: allDead.fetch });
  assert.deepEqual(
    plan.sources.map((s) => s.url),
    [url],
  );
  assert.equal(plan.integrity.size, 1000);
});
