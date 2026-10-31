import coursesJson from "@/data/courses.json";
import articlesJson from "@/data/articles.json";
import newsJson from "@/data/news.json";
import instructorsJson from "@/data/instructors.json";

export type Course = (typeof coursesJson)[number];
export type Article = (typeof articlesJson)[number];
export type NewsItem = (typeof newsJson)[number];
export type Instructor = (typeof instructorsJson)[number];
export type Block = { type: string; id?: string; text?: string; items?: string[] };

export function formatCourseDate(date: string) {
  const d = new Date(`${date}T00:00:00+08:00`);
  const w = "日一二三四五六"[d.getDay()];
  return `${d.getMonth() + 1}月${d.getDate()}日週${w}`;
}

export const articleCategories: Record<string, string> = {
  "land-administration": "地政實務",
  "tax-planning": "稅務規劃",
  "legal-faq": "法律知識",
};

// Swap these for CMS/API fetches later; pages only depend on the signatures.
export async function getCourses(): Promise<Course[]> {
  return [...coursesJson].sort((a, b) => a.date.localeCompare(b.date));
}
export async function getArticles(): Promise<Article[]> {
  return [...articlesJson].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}
export async function getArticleBySlug(slug: string): Promise<Article | undefined> {
  return articlesJson.find((a) => a.slug === slug);
}
export async function getNews(): Promise<NewsItem[]> {
  return [...newsJson].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}
export async function getInstructors(): Promise<Instructor[]> {
  return instructorsJson;
}
export function getInstructor(id: string) {
  return instructorsJson.find((i) => i.id === id);
}
export function getArticlesByIds(ids: string[]) {
  return articlesJson.filter((a) => ids.includes(a.id));
}
