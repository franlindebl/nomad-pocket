import assert from 'node:assert/strict';
import { test } from 'node:test';

import { integrityProblem, isStaleResumeError, networkGate, planAfterFailure, RETRY_DELAYS_MS, safeFileName, urlHost } from './manager-core.ts';

const wifi = { type: 'WIFI', isConnected: true, isInternetReachable: true };
const cellular = { type: 'CELLULAR', isConnected: true, isInternetReachable: true };

test('networkGate holds downloads on mobile data while "Wi-Fi only" is on', () => {
  assert.equal(networkGate(wifi, true), 'go');
  assert.equal(networkGate(cellular, true), 'wifi');
  assert.equal(networkGate(cellular, true, true), 'go'); // mobile data allowed for this download
  assert.equal(networkGate(cellular, false), 'go');
  assert.equal(networkGate({ type: 'ETHERNET', isConnected: true }, true), 'go');
  assert.equal(networkGate({ type: 'UNKNOWN', isConnected: true }, true), 'go');
});

test('networkGate waits while offline or before the network is known', () => {
  assert.equal(networkGate(null, true), 'unknown');
  assert.equal(networkGate({ type: 'NONE', isConnected: false, isInternetReachable: false }, false), 'offline');
  // Android before it validated the network.
  assert.equal(networkGate({ type: 'WIFI', isConnected: true, isInternetReachable: false }, true), 'offline');
  // Offline wins over the Wi-Fi rule: the row says "waiting for a connection".
  assert.equal(networkGate({ type: 'CELLULAR', isConnected: false }, true), 'offline');
});

test('isStaleResumeError: only an unusable state or a refused range drops the bytes', () => {
  assert.ok(isStaleResumeError('Invalid resume data provided'));
  assert.ok(isStaleResumeError('Cannot restore task: DownloadPauseState has no resumeData'));
  assert.ok(isStaleResumeError('No resume data available. Was the download paused before any data was received?'));
  assert.ok(isStaleResumeError('Unable to download a file: HTTP 416'));
  assert.ok(isStaleResumeError('Unable to download a file: server returned HTTP 412'));
  assert.ok(isStaleResumeError('Unable to download a file: HTTP 404'));
  assert.ok(!isStaleResumeError('Unable to download a file: HTTP 503'));
  assert.ok(!isStaleResumeError('Unable to download a file: HTTP 429'));
  assert.ok(!isStaleResumeError('Unable to download a file: HTTP 408'));
  assert.ok(!isStaleResumeError('Unable to download a file: Unable to resolve host "download.kiwix.org": No address associated with hostname'));
  assert.ok(!isStaleResumeError('Unable to download a file: timeout'));
});

test('planAfterFailure keeps the bytes on network errors and retries with a backoff', () => {
  const offline = 'Unable to download a file: Unable to resolve host "ftp.fau.de"';
  assert.deepEqual(planAfterFailure(offline, { resumed: true, failures: 0 }), { kind: 'retry', delayMs: RETRY_DELAYS_MS[0] });
  assert.deepEqual(planAfterFailure(offline, { resumed: false, failures: 1 }), { kind: 'retry', delayMs: RETRY_DELAYS_MS[1] });
  assert.deepEqual(planAfterFailure(offline, { resumed: true, failures: RETRY_DELAYS_MS.length }), { kind: 'fail' });
  assert.equal(planAfterFailure('Unable to download a file: server returned HTTP 502', { resumed: true, failures: 0 }).kind, 'retry');
  assert.equal(planAfterFailure('Se ha perdido la conexión de red.', { resumed: true, failures: 0 }).kind, 'retry');
});

test('planAfterFailure restarts from zero only when the saved state is stale', () => {
  assert.deepEqual(planAfterFailure('Unable to download a file: HTTP 416', { resumed: true, failures: 0 }), { kind: 'restart' });
  assert.deepEqual(planAfterFailure('Invalid resume data provided', { resumed: true, failures: 3 }), { kind: 'restart' });
  // A fresh download has nothing stale to drop: a 404 is shown.
  assert.deepEqual(planAfterFailure('Unable to download a file: HTTP 404', { resumed: false, failures: 0 }), { kind: 'fail' });
  // Unexplained while resuming: once more with the saved state, then from zero.
  assert.equal(planAfterFailure('The operation couldn’t be completed.', { resumed: true, failures: 0 }).kind, 'retry');
  assert.deepEqual(planAfterFailure('The operation couldn’t be completed.', { resumed: true, failures: 1 }), { kind: 'restart' });
  assert.deepEqual(planAfterFailure('The operation couldn’t be completed.', { resumed: false, failures: 0 }), { kind: 'fail' });
  // Not about the file: no point retrying by itself or dropping the bytes.
  assert.deepEqual(planAfterFailure('javax.net.ssl.SSLHandshakeException: Trust anchor for certification path not found.', { resumed: true, failures: 0 }), {
    kind: 'fail',
  });
  assert.deepEqual(planAfterFailure('ENOSPC: no space left on device', { resumed: true, failures: 0 }), { kind: 'fail' });
});

test('safeFileName keeps catalog names and never leaves the content dir', () => {
  assert.equal(safeFileName('wikipedia_es_all_maxi_2026-05.zim', 'x.zim'), 'wikipedia_es_all_maxi_2026-05.zim');
  assert.equal(safeFileName('Qwen3-1.7B-Q4_K_M.gguf', 'm.gguf'), 'Qwen3-1.7B-Q4_K_M.gguf');
  assert.equal(safeFileName('es.pmtiles.part00', 'x'), 'es.pmtiles.part00');
  // A decoded "..%2F..%2FSQLite%2Fnomad.db".
  assert.equal(safeFileName('../../SQLite/nomad.db', 'w.zim'), 'nomad.db');
  assert.equal(safeFileName('..\\..\\evil.zim', 'w.zim'), 'evil.zim');
  assert.equal(safeFileName('..', 'w.zim'), 'w.zim');
  assert.equal(safeFileName('../', 'w.zim'), 'w.zim');
  assert.equal(safeFileName('.hidden.zim', 'w.zim'), 'hidden.zim');
  assert.equal(safeFileName('a b?c*.zim', 'w.zim'), 'a_b_c_.zim');
  assert.equal(safeFileName('', '../id/../x.zim'), 'x.zim');
  assert.equal(safeFileName('', ''), 'download');
  const long = safeFileName(`${'a'.repeat(400)}.zim`, 'w.zim');
  assert.equal(long.length, 200);
  assert.ok(long.endsWith('.zim'));
});

test('integrityProblem compares size first, then the sha-256 when one is expected', () => {
  const sha = 'ea4afb04ddf90f31363829ef9fa2485405dc05bd1fc62b4626245fe70c24735d';
  assert.equal(integrityProblem({ size: 10 }, undefined), null);
  assert.equal(integrityProblem({ size: 10 }, {}), null);
  assert.equal(integrityProblem({ size: 10 }, { size: 10 }), null);
  assert.match(integrityProblem({ size: 9 }, { size: 10, sha256: sha }) ?? '', /^SIZE_MISMATCH/);
  assert.equal(integrityProblem({ size: 10, sha256: sha.toUpperCase() }, { size: 10, sha256: sha }), null);
  assert.match(integrityProblem({ size: 10, sha256: '00' }, { size: 10, sha256: sha }) ?? '', /^CHECKSUM_MISMATCH/);
});

test('urlHost', () => {
  assert.equal(urlHost('https://ftp.FAU.de/kiwix/zim/a.zim'), 'ftp.fau.de');
  assert.equal(urlHost('https://mirror.download.kiwix.org:443/zim/a.zim?x=1'), 'mirror.download.kiwix.org:443');
  assert.equal(urlHost('not a url'), '');
});
