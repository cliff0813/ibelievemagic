import { Calendar, Clock, User, ArrowRight } from "lucide-react";
import { type Course, formatCourseDate } from "@/lib/data";

export default function CourseCard({ course }: { course: Course }) {
  return (
    <article className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={course.image} alt={course.title} loading="lazy" className="aspect-[16/9] w-full object-cover" />
      <div className="flex flex-1 flex-col p-5">
        <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-slate-500">
          <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />{formatCourseDate(course.date)}</span>
          <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{course.startTime}–{course.endTime}</span>
        </div>
        <h3 className="mb-2 text-base font-bold leading-snug text-slate-900">{course.title}</h3>
        <p className="mb-2 flex items-center gap-1 text-sm font-medium text-brand-600"><User className="h-4 w-4" />講師:{course.instructor}</p>
        <p className="mb-4 line-clamp-5 flex-1 text-sm leading-relaxed text-slate-600">{course.description}</p>
        <div className="flex items-center justify-between">
          <span className="text-lg font-bold text-brand-900">NT${course.price.toLocaleString()}</span>
          <a href={course.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:text-brand-700">
            了解詳情 <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </div>
    </article>
  );
}
