import CoursesExplorer from "@/components/CoursesExplorer";
import { getCourses } from "@/lib/data";

export const metadata = { title: "最新課程|不動產學堂" };

export default async function CoursesPage() {
  const courses = await getCourses();
  return (
    <section className="mx-auto max-w-6xl px-4 py-12">
      <h1 className="mb-2 text-3xl font-bold text-brand-900">最新課程</h1>
      <p className="mb-8 text-slate-600">業界名師親授實戰課程,以關鍵字快速找到適合你的課。</p>
      <CoursesExplorer courses={courses} />
    </section>
  );
}
