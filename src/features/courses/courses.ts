// Courses = educational ZIM archives plus an app-side progress layer.
// The syllabus is built from the archive's main page links (document order);
// a lesson counts as done once it was opened in the reader or marked manually.
import { create } from 'zustand';

import { db, parseJson } from '@/db';
import { getItem } from '@/features/content/items';
import { getLinks, getMainPath, type ZimLink } from '@/features/library/zim';

export type Lesson = ZimLink;

export type CourseState = {
  itemId: string;
  syllabus: Lesson[];
  enrolledAt: number;
  lastPath: string | null;
  lastTitle: string | null;
  lastOpenedAt: number | null;
  completed: Set<string>;
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
  };
}

export function listCourses(): CourseState[] {
  const rows = db().getAllSync<{ item_id: string }>('SELECT item_id FROM courses ORDER BY COALESCE(last_opened_at, enrolled_at) DESC');
  return rows.map((r) => getCourse(r.item_id)).filter((c): c is CourseState => !!c && !!getItem(c.itemId));
}

async function buildSyllabus(itemId: string): Promise<Lesson[]> {
  const main = await getMainPath(itemId);
  if (!main) return [];
  const links = await getLinks(itemId, main);
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

/** Enrol (idempotent) and make sure the syllabus is built. */
export async function ensureCourse(itemId: string): Promise<CourseState | null> {
  const existing = getCourse(itemId);
  if (existing && existing.syllabus.length) return existing;
  let syllabus: Lesson[] = [];
  try {
    syllabus = await buildSyllabus(itemId);
  } catch {
    syllabus = [];
  }
  db().runSync(
    `INSERT INTO courses (item_id, syllabus, enrolled_at) VALUES (?, ?, ?)
     ON CONFLICT(item_id) DO UPDATE SET syllabus = excluded.syllabus`,
    itemId,
    JSON.stringify(syllabus),
    Date.now(),
  );
  useCourses.getState().bump();
  return getCourse(itemId);
}

export function recordCourseOpen(itemId: string, path: string, title: string) {
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
