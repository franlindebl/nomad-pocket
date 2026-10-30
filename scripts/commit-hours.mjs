// Commit rules for this repo, run by the git hooks in .githooks/:
// - Mon–Fri commits are dated between 22:00 and 02:00 (weekends are free). post-commit moves a commit made outside
//   that window into it: the day from 02:00 to 22:00 is squeezed six to one into the night that follows (10:00 → 23:20),
//   the mapping the history was rewritten with on 2026-10-30, so commits keep their order and rhythm.
// - No claude.ai session links in messages: commit-msg strips them.
// - pre-push refuses commits that break either rule (made with hooks off, or replayed by a rebase).
// git-ai (the git wrapper on the owner's Mac) writes its authorship note to refs/notes/ai after `git commit` returns,
// so onto the commit post-commit has just replaced: each amend is logged and the note copied over later (carryNotes).
// Usage: commit-hours.mjs fix [--force] | strip <msg-file> | check <remote> (pre-push stdin)
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const NOTES_REF = 'refs/notes/ai';
const AMENDS_LOG = 'commit-hours-amends';
const SESSION_LINK = /claude\.ai\/code\/session_|^Claude-Session:/im;

/** Whether a wall-clock time is allowed: any time on Saturday or Sunday, else 22:00–01:59. */
export function allowedWallClock(day, hour) {
  return day === 0 || day === 6 || hour >= 22 || hour < 2;
}

/** Same check for an epoch (seconds) in a git offset ('+0100'), as git shows the date. */
export function allowedAt(epoch, offset) {
  const sign = offset.startsWith('-') ? -1 : 1;
  const minutes = sign * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(3, 5)));
  const d = new Date((epoch + minutes * 60) * 1000);
  return allowedWallClock(d.getUTCDay(), d.getUTCHours());
}

/** Moves an epoch outside the window into the night that follows it, in the process time zone. */
export function intoWindow(epoch) {
  const t = new Date(epoch * 1000);
  if (allowedWallClock(t.getDay(), t.getHours())) return epoch;
  // Outside the window is 02:00–21:59 of a weekday, so that day started at 02:00 of the same date.
  const start = new Date(t.getFullYear(), t.getMonth(), t.getDate(), 2).getTime() / 1000;
  const night = new Date(t.getFullYear(), t.getMonth(), t.getDate(), 22).getTime() / 1000;
  return Math.floor(night + (epoch - start) / 6);
}

/** Git date ('<epoch> +hhmm') of an epoch in the process time zone. */
export function gitDate(epoch) {
  const off = -new Date(epoch * 1000).getTimezoneOffset();
  const abs = Math.abs(off);
  const hhmm = String(Math.floor(abs / 60)).padStart(2, '0') + String(abs % 60).padStart(2, '0');
  return `${epoch} ${off < 0 ? '-' : '+'}${hhmm}`;
}

/**
 * New author and committer epochs for a commit ([epoch, offset] each; parent = latest parent committer epoch),
 * or null when both already comply. A moved date lands after the parent: 21:59 maps to 01:19, so a commit at
 * 22:05 that follows one moved there goes to 01:19:30, not before it.
 */
export function fixedDates({ author, committer, parent }) {
  const move = ([epoch, offset]) => {
    if (allowedAt(epoch, offset)) return epoch;
    const moved = intoWindow(epoch);
    return moved > parent ? moved : parent + 30;
  };
  const a = move(author);
  const c = Math.max(move(committer), a);
  return a === author[0] && c === committer[0] ? null : { author: a, committer: c };
}

export function stripSessionLinks(message) {
  const lines = message.split('\n').filter((l) => !SESSION_LINK.test(l));
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  return lines.join('\n') + '\n';
}

export const hasSessionLink = (message) => SESSION_LINK.test(message);

// --- git hooks ---

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const gitOk = (...args) => {
  try {
    execFileSync('git', args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

function replaying() {
  return ['rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'sequencer'].some((p) =>
    existsSync(git('rev-parse', '--git-path', p)),
  );
}

/** Copies git-ai notes from replaced commits to their amended versions once git-ai has written them. */
function carryNotes() {
  const log = git('rev-parse', '--git-path', AMENDS_LOG);
  if (!existsSync(log)) return;
  const hasNote = (sha) => gitOk('notes', `--ref=${NOTES_REF}`, 'list', sha);
  const now = Date.now() / 1000;
  const pending = [];
  for (const line of readFileSync(log, 'utf8').split('\n').filter(Boolean)) {
    const [replaced, amended, at] = line.split(' ');
    if (hasNote(replaced)) {
      if (!hasNote(amended)) git('notes', `--ref=${NOTES_REF}`, 'copy', replaced, amended);
    } else if (now - Number(at) < 86400) {
      pending.push(line); // git-ai may not have written it yet; a day later it never will
    }
  }
  writeFileSync(log, pending.map((l) => l + '\n').join(''));
}

/** Amends HEAD into the window (and without session links). --force also runs mid-rebase (git rebase -x). */
function fix(force) {
  // The amend runs post-commit again; mid-rebase the replayed commits are left to pre-push unless forced.
  if (process.env.NOMAD_COMMIT_HOURS_FIXING || (!force && replaying())) return;
  carryNotes();
  const [at, ao, ct, co, ...parents] = git('log', '-1', '--format=%at %ad %ct %cd %P', '--date=format:%z').split(' ');
  const parent = Math.max(0, ...parents.filter(Boolean).map((p) => Number(git('log', '-1', '--format=%ct', p))));
  const dates = fixedDates({ author: [Number(at), ao], committer: [Number(ct), co], parent });
  const message = git('log', '-1', '--format=%B');
  if (!dates && !hasSessionLink(message)) return;
  const { author, committer } = dates ?? { author: Number(at), committer: Number(ct) };
  const replaced = git('rev-parse', 'HEAD');
  execFileSync('git', ['commit', '--amend', '--no-verify', '--allow-empty', '--cleanup=verbatim', '-F', '-', `--date=${gitDate(author)}`], {
    input: stripSessionLinks(message),
    stdio: ['pipe', 'ignore', 'inherit'],
    env: { ...process.env, NOMAD_COMMIT_HOURS_FIXING: '1', GIT_COMMITTER_DATE: gitDate(committer) },
  });
  writeFileSync(git('rev-parse', '--git-path', AMENDS_LOG), `${replaced} ${git('rev-parse', 'HEAD')} ${Math.floor(Date.now() / 1000)}\n`, {
    flag: 'a',
  });
  if (dates) console.log(`commit-hours: dated ${new Date(author * 1000).toString().slice(0, 21)} (Mon–Fri commits go 22:00–02:00)`);
}

function check(remote) {
  carryNotes();
  const zero = /^0+$/;
  const known = (oid) => gitOk('cat-file', '-e', `${oid}^{commit}`);
  const bad = new Set();
  for (const line of readFileSync(0, 'utf8').split('\n')) {
    const [, local, , remoteOid] = line.split(' ');
    if (!local || zero.test(local)) continue; // a deletion
    const range = [local, '--not', `--remotes=${remote}`];
    if (remoteOid && !zero.test(remoteOid) && known(remoteOid)) range.push(remoteOid);
    for (const sha of git('rev-list', ...range)
      .split('\n')
      .filter(Boolean)) {
      const [at, ao, ct, co] = git('log', '-1', '--format=%at %ad %ct %cd', '--date=format:%z', sha).split(' ');
      const why = [];
      if (!allowedAt(Number(at), ao) || !allowedAt(Number(ct), co)) why.push('dated outside Mon–Fri 22:00–02:00');
      if (hasSessionLink(git('log', '-1', '--format=%B', sha))) why.push('has a claude.ai session link');
      if (why.length) bad.add(`  ${git('log', '-1', '--format=%h %ad %s', '--date=format:%a %d %H:%M', sha)}: ${why.join(', ')}`);
    }
  }
  if (bad.size) {
    console.error(`pre-push: ${bad.size} commit(s) break this repo's commit rules (scripts/commit-hours.mjs):\n${[...bad].join('\n')}`);
    console.error(
      `Fix them with: git rebase --committer-date-is-author-date -x 'node scripts/commit-hours.mjs fix --force' ${remote}/main`,
    );
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'fix') fix(arg === '--force');
  else if (cmd === 'strip') writeFileSync(arg, stripSessionLinks(readFileSync(arg, 'utf8')));
  else if (cmd === 'check') check(arg ?? 'origin');
  else {
    console.error('usage: commit-hours.mjs fix [--force] | strip <msg-file> | check <remote>');
    process.exit(2);
  }
}
