// Download rows vs. the bytes on disk at startup, the pure part. Restoring a phone from a backup
// brings `nomad.db` back (the downloads table) but not Documents/content/partial, which is excluded
// from backups: a segmented download would find its `.part` prefix gone and silently start again
// from zero, pulling gigabytes nobody asked for on the new phone. Such rows are marked failed
// instead (the person's Retry restarts them). Normal relaunches keep their partial files, so
// nothing changes for them. No `@/` imports: unit tests load this file directly.

/** Stored in `downloads.error`; `downloadErrorKind` reads it as 'restored'. */
export const PARTIAL_LOST_ERROR = 'PARTIAL_LOST';

export type RowFacts = {
  status: string;
  /** meta.segments is set: the download was segmented, so its `.part` prefix is created as soon as it starts. */
  segmented: boolean;
  destExists: boolean;
  /** The `.part` file exists (even empty). */
  partExists: boolean;
  /** The `.chunks` directory exists. */
  chunksExist: boolean;
};

/**
 * keep: the row stays as it is (the manager resumes or restarts it as usual).
 * lost: the bytes it claims are gone; mark it failed so nothing re-downloads without the person.
 *
 * Only evidence that cannot be a plain relaunch counts: a segmented download whose `.part` is gone,
 * or a finished file ('processing') that is neither at its destination nor still a `.part`. Single
 * transfers (under 16 MB) carry no such evidence and restart cheaply, as they always did.
 */
export function startupRowAction(f: RowFacts): 'keep' | 'lost' {
  if (f.status === 'failed') return 'keep';
  if (f.status === 'processing') return f.destExists || f.partExists ? 'keep' : 'lost';
  if (['queued', 'running', 'paused'].includes(f.status) && f.segmented && !f.partExists && !f.chunksExist) return 'lost';
  return 'keep';
}
