"use client";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import CourseCard from "./CourseCard";
import type { Course } from "@/lib/course-types";
import { filterCourses } from "@/lib/live-courses.mjs";

export default function CoursesExplorer({ courses }: { courses: Course[] }) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    return filterCourses(courses, q);
  }, [courses, q]);

  return (
    <div>
      <div className="relative mb-8">
        <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜尋課程名稱、講師、關鍵字…"
          className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-12 pr-4 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        />
      </div>
      {filtered.length ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => <CourseCard key={c.id} course={c} />)}
        </div>
      ) : (
        <p className="py-16 text-center text-slate-500">找不到符合的課程,請調整搜尋條件。</p>
      )}
    </div>
  );
}
