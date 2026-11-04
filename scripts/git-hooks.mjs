// npm prepare: points git at the repo's hooks (.githooks/: pre-commit runs typecheck, lint, unit tests and i18n keys; the
// others only run a personal hook of the same name from .git/hooks.local/, if any). Leaves alone a hooks path the
// contributor already has (a global secret-scanning hook, say): overriding it in this clone would silently turn that off.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const HOOKS = '.githooks';
const git = (...args) => spawnSync('git', args, { encoding: 'utf8' });

// No git, or not a checkout (an installed tarball): nothing to do.
if (git('rev-parse', '--is-inside-work-tree').status === 0) {
  const current = (git('config', 'core.hooksPath').stdout ?? '').trim();
  // A path that no longer exists (an absolute one left behind when the clone was moved or renamed) means git runs
  // no hooks at all, silently: take it over like an unset one.
  const top = (git('rev-parse', '--show-toplevel').stdout ?? '').trim();
  const stale = current && !existsSync(resolve(top, current.replace(/^~(?=\/)/, homedir())));
  if (!current || stale) {
    if (git('config', 'core.hooksPath', HOOKS).status === 0) {
      const was = stale ? ` (was ${current}, which doesn't exist)` : '';
      console.log(`[prepare] git hooks: core.hooksPath set to ${HOOKS}${was} (skip once with git commit --no-verify)`);
    }
  } else if (current !== HOOKS) {
    console.log(
      `[prepare] git hooks: core.hooksPath is already ${current}, left as is (git config core.hooksPath ${HOOKS} uses this repo's)`,
    );
  }
}
