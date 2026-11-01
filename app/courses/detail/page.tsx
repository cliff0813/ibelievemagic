import { Suspense } from "react";
import { LiveCourseDetailFromQuery } from "@/components/LiveCourseDetail";

export const metadata = { title: "課程詳情|不動產學堂" };

export default function CourseDetailQueryPage() {
  return (
    <Suspense fallback={<p role="status" className="py-16 text-center text-slate-500">課程資料載入中…</p>}>
      <LiveCourseDetailFromQuery />
    </Suspense>
  );
}