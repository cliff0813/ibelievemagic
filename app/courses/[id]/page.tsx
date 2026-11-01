import LiveCourseDetail from "@/components/LiveCourseDetail";
import { getCourses } from "@/lib/data";

// Only enumerates legacy /courses/<id>/ URLs so they keep resolving; the
// page content itself is always loaded live from the public course endpoint.
export async function generateStaticParams() {
  return (await getCourses()).map((c) => ({ id: c.id }));
}

export const metadata = { title: "課程詳情|不動產學堂" };

export default function CourseDetailPage({ params }: { params: { id: string } }) {
  return <LiveCourseDetail id={params.id} />;
}