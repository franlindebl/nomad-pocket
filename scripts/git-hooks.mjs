// npm prepare: points git at the repo's hooks (.githooks/pre-commit: typecheck, lint, unit tests,
// i18n keys). Leaves alone a hooks path the contributor already has (a global secret-scanning
// hook, say): overriding it in this clone would silently turn that off.
import { spawnSync } from 'node:child_process';

const HOOKS = '.githooks';
const git = (...args) => spawnSync('git', args, { encoding: 'utf8' });

// No git, or not a checkout (an installed tarball): nothing to do.
if (git('rev-parse', '--is-inside-work-tree').status === 0) {
  const current = (git('config', 'core.hooksPath').stdout ?? '').trim();
  if (!current) {
    if (git('config', 'core.hooksPath', HOOKS).status === 0) {
      console.log(`[prepare] git hooks: core.hooksPath set to ${HOOKS} (skip once with git commit --no-verify)`);
    }
  } else if (current !== HOOKS) {
    console.log(
      `[prepare] git hooks: core.hooksPath is already ${current}, left as is (git config core.hooksPath ${HOOKS} uses this repo's)`,
    );
  }
}
