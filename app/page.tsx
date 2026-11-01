import Link from "next/link";
import { ArrowRight, BookOpen, Newspaper, GraduationCap, Award, Calendar } from "lucide-react";
import LiveCourseList from "@/components/LiveCourseList";
import ArticleCover from "@/components/ArticleCover";
import { getArticles, getNews, getInstructors, articleCategories } from "@/lib/data";

export const revalidate = 1800;

export default async function Home() {
  const [articles, news, instructors] = await Promise.all([getArticles(), getNews(), getInstructors()]);

  return (
    <>
      <section className="bg-gradient-to-br from-brand-900 via-brand-700 to-brand-500 text-white">
        <div className="mx-auto max-w-6xl px-4 py-20 md:py-28">
          <p className="mb-4 text-sm font-semibold tracking-widest text-gold-500">REAL ESTATE ACADEMY</p>
          <h1 className="max-w-3xl text-4xl font-bold leading-tight md:text-6xl">
            讓每一次不動產決策,<br />都有專業知識作後盾
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-blue-100">
            最新不動產課程、地政稅務法律知識與產業趨勢,一站掌握。
          </p>
          <div className="mt-10 flex flex-wrap gap-4">
            <Link href="/courses" className="inline-flex items-center gap-2 rounded-full bg-white px-7 py-3 font-semibold text-brand-700 hover:bg-blue-50">
              瀏覽最新課程  <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="#knowledge" className="rounded-full border border-white/60 px-7 py-3 font-semibold hover:bg-white/10">
              最新知識文章
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16">
        <SectionTitle icon={<GraduationCap />}         title="最新課程" href="/courses" />
        <LiveCourseList limit={3} />
      </section>

      <section id="knowledge" className="scroll-mt-20 bg-white py-16">
        <div className="mx-auto max-w-6xl px-4">
          <SectionTitle icon={<BookOpen />} title="不動產知識庫" />
          <div className="grid gap-6 md:grid-cols-3">
            {articles.map((a) => (
              <Link key={a.id} href={`/articles/${a.slug}`} className="group overflow-hidden rounded-2xl border border-slate-200 transition hover:border-brand-500 hover:shadow-md">
                <ArticleCover src={a.image} alt={a.title} />
                <div className="p-6">
                <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
                  {articleCategories[a.category]}
                </span>
                <h3 className="mb-2 mt-3 text-lg font-bold text-slate-900 group-hover:text-brand-600">{a.title}</h3>
                <p className="text-sm text-slate-600">{a.excerpt}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section id="news" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16">
        <SectionTitle icon={<Newspaper />} title="即時新聞與趨勢" />
        <ul className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
          {news.map((n) => (
            <li key={n.id}>
              <a href={n.url} target="_blank" rel="noopener noreferrer" className="flex flex-col gap-1 p-5 hover:bg-brand-50 sm:flex-row sm:items-center sm:gap-6">
                <span className="flex shrink-0 items-center gap-1 text-sm text-slate-500">
                  <Calendar className="h-4 w-4" />{n.publishedAt.slice(0, 10)}
                </span>
                <span className="flex-1">
                  <span className="block font-semibold text-slate-900">{n.title}</span>
                  {n.summary && <span className="text-sm text-slate-600">{n.summary}</span>}
                </span>
                <span className="text-xs text-slate-400">{n.source}</span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section id="about" className="scroll-mt-20 bg-brand-50 py-16">
        <div className="mx-auto max-w-6xl px-4">
          <SectionTitle icon={<Award />} title="關於我們 / 講師團隊" />
          <p className="mb-8 max-w-2xl text-slate-600">
            我們的使命是把複雜的不動產法規與市場知識,轉化為可實際應用的專業內容。
          </p>
          <div className="grid gap-6 md:grid-cols-2">
            {instructors.map((i) => (
              <div key={i.id} className="rounded-2xl bg-white p-6 shadow-sm">
                <h3 className="text-lg font-bold text-slate-900">{i.name}</h3>
                <p className="mb-2 text-sm font-medium text-brand-600">{i.title}</p>
                <p className="mb-3 text-sm text-slate-600">{i.bio}</p>
                <div className="flex flex-wrap gap-2">
                  {i.credentials.map((c) => (
                    <span key={c} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">{c}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

function SectionTitle({ icon, title, href }: { icon: React.ReactNode; title: string; href?: string }) {
  return (
    <div className="mb-8 flex items-center justify-between">
      <h2 className="flex items-center gap-3 text-2xl font-bold text-brand-900 [&>svg]:text-brand-600">{icon}{title}</h2>
      {href && <Link href={href} className="text-sm font-semibold text-brand-600 hover:underline">查看全部 →</Link>}
    </div>
  );
}
