/** @typedef {import('./course-types').Course} Course */
/**
 * @typedef {{ status: 'loading' }
 *   | { status: 'error', message: string }
 *   | { status: 'empty' }
 *   | { status: 'ready', courses: Course[] }} LiveCourseState
 */

/** @type {LiveCourseState} */
export const LOADING_STATE = { status: "loading" };

/**
 * Generic static detail route; the query string selects the course.
 * Next's <Link> adds the configured basePath.
 *
 * @param {string} id
 * @returns {string}
 */
export function courseDetailHref(id) {
  return `/courses/detail/?id=${encodeURIComponent(id)}`;
}

/**
 * @param {Course[]} courses
 * @param {string} query
 * @returns {Course[]}
 */
export function filterCourses(courses, query) {
  const kw = query.trim().toLowerCase();
  if (!kw) return courses;
  return courses.filter((c) =>
    [c.title, c.instructor, c.description].some((s) => s.toLowerCase().includes(kw)),
  );
}

/**
 * @param {Course[]} courses
 * @param {string | null | undefined} id
 * @returns {Course | undefined}
 */
export function findCourseById(courses, id) {
  if (!id) return undefined;
  return courses.find((c) => c.id === id);
}

/**
 * Runs one load attempt, reporting loading -> ready | empty | error.
 * Returns a cancel function (usable as a React effect cleanup) that
 * suppresses any later state report.
 *
 * @param {{ load: () => Promise<Course[]>, onState: (state: LiveCourseState) => void }} options
 * @returns {() => void}
 */
export function startCourseLoad({ load, onState }) {
  let cancelled = false;
  const report = (state) => {
    if (!cancelled) onState(state);
  };

  report(LOADING_STATE);
  Promise.resolve()
    .then(load)
    .then(
      (courses) => report(courses.length ? { status: "ready", courses } : { status: "empty" }),
      (error) =>
        report({
          status: "error",
          message: error instanceof Error && error.message ? error.message : "未知錯誤",
        }),
    );

  return () => {
    cancelled = true;
  };
}