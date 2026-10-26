// npm postinstall: fetches the prebuilt iOS native libraries (libkiwix for nomad-zim, Valhalla
// for nomad-route). Only a Mac builds iOS, so any other host (Linux CI, an Android contributor on
// Linux or Windows) skips them here, before needing bash, which Windows' cmd.exe lacks.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPTS = ['../modules/nomad-zim/scripts/fetch-ios-libs.sh', '../modules/nomad-route/scripts/fetch-ios-libs.sh'];

if (process.platform !== 'darwin') {
  console.log('[postinstall] not macOS: skipping the iOS native libraries (libkiwix, Valhalla)');
} else {
  for (const script of SCRIPTS) {
    const { status, error } = spawnSync('bash', [fileURLToPath(new URL(script, import.meta.url))], { stdio: 'inherit' });
    if (error) throw error;
    if (status !== 0) process.exit(status ?? 1);
  }
}
