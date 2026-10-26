import assert from 'node:assert/strict';
import { test } from 'node:test';

import { downloadErrorKind } from './errors.ts';

test('downloadErrorKind reads the usual failures', () => {
  assert.equal(downloadErrorKind('NOT_ENOUGH_STORAGE').kind, 'storage');
  assert.equal(
    downloadErrorKind("Call to function 'FileSystemDownloadTask.start' has been rejected. → Caused by: javax.net.ssl.SSLHandshakeException: java.security.cert.CertPathValidatorException: Trust anchor for certification path not found.").kind,
    'secure',
  );
  assert.equal(downloadErrorKind('La conexión segura ha fallado debido a un error de TLS.').kind, 'secure');
  assert.deepEqual(downloadErrorKind('HTTP 404'), { kind: 'server', status: 404 });
  assert.deepEqual(downloadErrorKind('Unexpected status code: 503'), { kind: 'server', status: 503 });
  assert.equal(downloadErrorKind('java.net.UnknownHostException: Unable to resolve host "github.com"').kind, 'offline');
  assert.equal(downloadErrorKind('The Internet connection appears to be offline.').kind, 'offline');
  assert.equal(downloadErrorKind('ad.tar.part00: 12 bytes, expected 2000000').kind, 'other');
  assert.equal(downloadErrorKind(null).kind, 'other');
});
