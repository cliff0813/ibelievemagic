import LiveCourseList from "@/components/LiveCourseList";

export const metadata = { title: "最新課程|不動產學堂" };

export default function CoursesPage() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-12">
      <h1 className="mb-2 text-3xl font-bold text-brand-900">最新課程</h1>
      <p className="mb-8 text-slate-600">業界名師親授實戰課程,以關鍵字快速找到適合你的課。</p>
      <LiveCourseList searchable />
    </section>
  );
}