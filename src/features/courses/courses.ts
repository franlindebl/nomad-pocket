// Courses = educational ZIM archives plus an app-side progress layer.
// The syllabus is built from the archive's main page links (document order). Main
// pages that are JS apps (freeCodeCamp, PhET…) have no links: freeCodeCamp ships its
// curriculum as JSON, anything else falls back to its HTML articles in title order.
// A lesson counts as done once it was opened (reader or syllabus) or marked manually.
import { create } from 'zustand';

import { db, parseJson } from '@/db';
import { recordVisit } from '@/features/library/history';
import { getJson, getLinks, getMainPath, listArticles, type ZimLink } from '@/features/library/zim';

export type Lesson = ZimLink;

export type CourseState = {
  itemId: string;
  syllabus: Lesson[];
  enrolledAt: number;
  lastPath: string | null;
  lastTitle: string | null;
  lastOpenedAt: number | null;
  completed: Set<string>;
  syllabusBuilt: boolean;
};

type CourseRow = {
  item_id: string;
  syllabus: string | null;
  enrolled_at: number;
  last_path: string | null;
  last_title: string | null;
  last_opened_at: number | null;
};

const MAX_LESSONS = 400;
const NON_LESSON = /\.(png|jpe?g|gif|svg|webp|css|js|pdf|mp4|webm|ogg|mp3)$/i;

function completedPaths(itemId: string, syllabus: Lesson[]): Set<string> {
  const manual = db().getAllSync<{ path: string }>('SELECT path FROM course_progress WHERE item_id = ?', itemId);
  const visited = db().getAllSync<{ path: string }>('SELECT DISTINCT path FROM history WHERE item_id = ?', itemId);
  const inSyllabus = new Set(syllabus.map((l) => l.path));
  const done = new Set<string>();
  for (const { path } of [...manual, ...visited]) if (inSyllabus.has(path)) done.add(path);
  return done;
}

export function getCourse(itemId: string): CourseState | null {
  const row = db().getFirstSync<CourseRow>('SELECT * FROM courses WHERE item_id = ?', itemId);
  if (!row) return null;
  const syllabus = parseJson<Lesson[]>(row.syllabus, []);
  return {
    itemId,
    syllabus,
    enrolledAt: row.enrolled_at,
    lastPath: row.last_path,
    lastTitle: row.last_title,
    lastOpenedAt: row.last_opened_at,
    completed: completedPaths(itemId, syllabus),
    syllabusBuilt: row.syllabus !== null,
  };
}

// freeCodeCamp ZIMs (fcc2zim): superblock → block → challenges, in curriculum order.
const FCC_CURRICULUM = 'content/curriculum/index.json';
type FccCurriculum = Record<string, Record<string, { title: string; slug: string }[]>>;

async function fccLessons(itemId: string): Promise<ZimLink[]> {
  const curriculum = await getJson<FccCurriculum>(itemId, FCC_CURRICULUM);
  if (!curriculum || typeof curriculum !== 'object') return [];
  const out: ZimLink[] = [];
  for (const [superblock, blocks] of Object.entries(curriculum)) {
    for (const [block, challenges] of Object.entries(blocks ?? {})) {
      if (!Array.isArray(challenges)) continue;
      for (const c of challenges) {
        if (c?.slug && c.title) out.push({ path: `index/${superblock}/${block}/${c.slug}.html`, title: c.title });
      }
    }
  }
  return out;
}

async function buildSyllabus(itemId: string): Promise<Lesson[]> {
  const main = await getMainPath(itemId);
  // Unreadable right now (not open yet, file missing): don't persist an empty syllabus.
  if (!main) throw new Error('ARCHIVE_UNAVAILABLE');
  let links = await getLinks(itemId, main);
  if (!links.length) links = await fccLessons(itemId);
  if (!links.length) links = await listArticles(itemId, MAX_LESSONS + 1);
  const seen = new Set<string>([main]);
  const lessons: Lesson[] = [];
  for (const l of links) {
    const path = l.path.split('#')[0];
    if (!path || seen.has(path) || NON_LESSON.test(path)) continue;
    const title = l.title.trim();
    if (!title) continue;
    seen.add(path);
    lessons.push({ path, title });
    if (lessons.length >= MAX_LESSONS) break;
  }
  return lessons;
}

// Empty syllabi are retried once per launch (older versions stored [] for JS-app archives).
const retriedEmpty = new Set<string>();

/** Enrol (idempotent) and make sure the syllabus is built. */
export async function ensureCourse(itemId: string): Promise<CourseState | null> {
  const existing = getCourse(itemId);
  // A built syllabus may legitimately be empty (no structured main page): don't rebuild it in a loop.
  if (existing && existing.syllabusBuilt && (existing.syllabus.length || retriedEmpty.has(itemId))) return existing;
  retriedEmpty.add(itemId);
  let syllabus: Lesson[] | null;
  try {
    syllabus = await buildSyllabus(itemId);
  } catch {
    syllabus = null; // retried next time
  }
  db().runSync(
    `INSERT INTO courses (item_id, syllabus, enrolled_at) VALUES (?, ?, ?)
     ON CONFLICT(item_id) DO UPDATE SET syllabus = COALESCE(excluded.syllabus, courses.syllabus)`,
    itemId,
    syllabus ? JSON.stringify(syllabus) : null,
    Date.now(),
  );
  useCourses.getState().bump();
  return getCourse(itemId);
}

export function recordCourseOpen(itemId: string, path: string, title: string) {
  // JS-app archives navigate away from the lesson path, so the reader alone wouldn't record it.
  recordVisit(itemId, path, title);
  db().runSync('UPDATE courses SET last_path = ?, last_title = ?, last_opened_at = ? WHERE item_id = ?', path, title, Date.now(), itemId);
  useCourses.getState().bump();
}

export function setLessonDone(itemId: string, path: string, done: boolean) {
  if (done) {
    db().runSync('INSERT OR REPLACE INTO course_progress (item_id, path, completed_at) VALUES (?, ?, ?)', itemId, path, Date.now());
  } else {
    db().runSync('DELETE FROM course_progress WHERE item_id = ? AND path = ?', itemId, path);
    db().runSync('DELETE FROM history WHERE item_id = ? AND path = ?', itemId, path);
  }
  useCourses.getState().bump();
}

export function resetCourse(itemId: string) {
  db().runSync('DELETE FROM course_progress WHERE item_id = ?', itemId);
  db().runSync('DELETE FROM history WHERE item_id = ?', itemId);
  db().runSync('UPDATE courses SET last_path = NULL, last_title = NULL WHERE item_id = ?', itemId);
  useCourses.getState().bump();
}

export function courseProgress(c: CourseState | null): number {
  if (!c || !c.syllabus.length) return 0;
  return c.completed.size / c.syllabus.length;
}

/** First lesson not done yet, else the last opened page. */
export function nextLesson(c: CourseState): Lesson | null {
  const pending = c.syllabus.find((l) => !c.completed.has(l.path));
  if (pending) return pending;
  return c.lastPath ? { path: c.lastPath, title: c.lastTitle ?? '' } : (c.syllabus[0] ?? null);
}

/** Version counter so screens re-read course state after changes. */
export const useCourses = create<{ version: number; bump: () => void }>((set) => ({
  version: 0,
  bump: () => set((s) => ({ version: s.version + 1 })),
}));
