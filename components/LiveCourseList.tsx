"use client";
import { useEffect, useState } from "react";
import { loadCourses } from "@/lib/course-api.mjs";
import gasRegistration from "@/data/gas-registration.json";
import { LOADING_STATE, startCourseLoad, type LiveCourseState } from "@/lib/live-courses.mjs";
import CourseCard from "./CourseCard";
import CoursesExplorer from "./CoursesExplorer";

/** Loads courses from the public GAS endpoint in the browser (never during SSR/build). */
export function useLiveCourses(): [LiveCourseState, () => void] {
  const [state, setState] = useState<LiveCourseState>(LOADING_STATE);
  const [attempt, setAttempt] = useState(0);

  useEffect(
    () =>
      startCourseLoad({
        load: () => loadCourses({ webAppUrl: gasRegistration.webAppUrl }),
        onState: setState,
      }),
    [attempt],
  );

  return [state, () => setAttempt((n) => n + 1)];
}

export function LiveCourseStatus({ state, onRetry }: { state: LiveCourseState; onRetry: () => void }) {
  if (state.status === "loading") {
    return <p role="status" className="py-16 text-center text-slate-500">課程資料載入中…</p>;
  }
  if (state.status === "error") {
    return (
      <div role="alert" className="py-16 text-center">
        <p className="mb-2 font-semibold text-red-600">課程資料載入失敗</p>
        <p className="mb-4 text-sm text-slate-500">{state.message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-full bg-brand-600 px-6 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          重試
        </button>
      </div>
    );
  }
  return null;
}

export function LiveCourseListView({
  state,
  onRetry,
  limit,
  searchable = false,
}: {
  state: LiveCourseState;
  onRetry: () => void;
  limit?: number;
  searchable?: boolean;
}) {
  if (state.status === "empty") {
    return <p className="py-16 text-center text-slate-500">目前沒有開放的課程,敬請期待。</p>;
  }
  if (state.status !== "ready") {
    return <LiveCourseStatus state={state} onRetry={onRetry} />;
  }
  if (searchable) return <CoursesExplorer courses={state.courses} />;
  const shown = limit === undefined ? state.courses : state.courses.slice(0, limit);
  return (
    <div className="grid gap-6 md:grid-cols-3">
      {shown.map((c) => <CourseCard key={c.id} course={c} />)}
    </div>
  );
}

export default function LiveCourseList({ limit, searchable }: { limit?: number; searchable?: boolean }) {
  const [state, retry] = useLiveCourses();
  return <LiveCourseListView state={state} onRetry={retry} limit={limit} searchable={searchable} />;
}