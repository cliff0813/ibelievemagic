import coursesJson from "@/data/courses.json";
import articlesJson from "@/data/articles.json";
import newsJson from "@/data/news.json";
import instructorsJson from "@/data/instructors.json";
import { fetchRealEstateNews, type NewsItem } from "@/lib/news";

export type Course = (typeof coursesJson)[number];
export type Article = (typeof articlesJson)[number] & { image?: string };
export type { NewsItem };
export type Instructor = (typeof instructorsJson)[number];
export type Block = { type: string; id?: string; text?: string; items?: string[] };

export { formatCourseDate, formatCourseDateLong } from "@/lib/course-date.mjs";

export const DEFAULT_ARTICLE_IMAGE = "/images/default-article.svg";

export const articleCategories: Record<string, string> = {
  "land-administration": "地政實務",
  "tax-planning": "稅務規劃",
  "legal-faq": "法律知識",
};

// Swap these for CMS/API fetches later; pages only depend on the signatures.
export async function getCourses(): Promise<Course[]> {
  return [...coursesJson].sort((a, b) => a.date.localeCompare(b.date));
}
export async function getCourseById(id: string): Promise<Course | undefined> {
  return coursesJson.find((c) => c.id === id);
}
export async function getArticles(): Promise<Article[]> {
  return [...articlesJson].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}
export async function getArticleBySlug(slug: string): Promise<Article | undefined> {
  return articlesJson.find((a) => a.slug === slug);
}
export async function getNews(): Promise<NewsItem[]> {
  try {
    const live = await fetchRealEstateNews();
    if (live.length) return live;
  } catch (e) {
    console.error("RSS fetch failed, using fallback news.json", e);
  }
  return [...newsJson].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}
export async function getInstructors(): Promise<Instructor[]> {
  return instructorsJson;
}
export function getInstructor(id: string) {
  return instructorsJson.find((i) => i.id === id);
}
export function getArticlesByIds(ids: string[]): Article[] {
  return articlesJson.filter((a) => ids.includes(a.id));
}
