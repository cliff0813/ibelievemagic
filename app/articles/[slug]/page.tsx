import Link from "next/link";
import { notFound } from "next/navigation";
import { Calendar, Clock, ListOrdered } from "lucide-react";
import ShareButtons from "@/components/ShareButtons";
import ArticleCover from "@/components/ArticleCover";
import {
  getArticles, getArticleBySlug, getArticlesByIds, getInstructor,
  articleCategories, type Block,
} from "@/lib/data";

export async function generateStaticParams() {
  return (await getArticles()).map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const a = await getArticleBySlug(params.slug);
  return { title: a ? `${a.title}|不動產學堂` : "文章不存在", description: a?.excerpt };
}

export default async function ArticlePage({ params }: { params: { slug: string } }) {
  const article = await getArticleBySlug(params.slug);
  if (!article) notFound();

  const body = article.body as Block[];
  const toc = body.filter((b) => b.type === "h2");
  const related = getArticlesByIds(article.related);
  const author = getInstructor(article.author);

  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 lg:grid-cols-[1fr_280px]">
      <article>
        <Link href="/#knowledge" className="text-sm text-brand-600 hover:underline">← 返回知識庫</Link>
        <ArticleCover src={article.image} alt={article.title} className="mt-4 rounded-2xl" />
        <span className="mt-6 block w-fit rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
          {articleCategories[article.category]}
        </span>
        <h1 className="mb-4 mt-3 text-3xl font-bold leading-tight text-brand-900">{article.title}</h1>
        <div className="mb-6 flex flex-wrap items-center gap-4 text-sm text-slate-500">
          {author && <span>作者:{author.name}</span>}
          <span className="flex items-center gap-1"><Calendar className="h-4 w-4" />{article.publishedAt}</span>
          <span className="flex items-center gap-1"><Clock className="h-4 w-4" />{article.readingMinutes} 分鐘閱讀</span>
        </div>
        <ShareButtons title={article.title} />

        <div className="mt-8 space-y-5 leading-8 text-slate-700">
          {body.map((b, i) => {
            if (b.type === "h2")
              return <h2 key={i} id={b.id} className="scroll-mt-24 pt-4 text-2xl font-bold text-slate-900">{b.text}</h2>;
            if (b.type === "ul")
              return <ul key={i} className="list-disc space-y-1 pl-6">{b.items?.map((it) => <li key={it}>{it}</li>)}</ul>;
            return <p key={i}>{b.text}</p>;
          })}
        </div>

        <p className="mt-10 rounded-lg bg-amber-50 p-4 text-sm text-amber-800">
          本文僅供教育參考,不構成法律或稅務意見,請以主管機關最新規定為準。
        </p>

        <section className="mt-14">
          <h2 className="mb-4 text-xl font-bold text-slate-900">相關文章</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {related.map((r) => (
              <Link key={r.id} href={`/articles/${r.slug}`} className="overflow-hidden rounded-xl border border-slate-200 bg-white hover:shadow-md">
                <ArticleCover src={r.image} alt={r.title} />
                <div className="p-4">
                  <span className="text-xs text-brand-600">{articleCategories[r.category]}</span>
                  <p className="mt-1 font-semibold text-slate-900">{r.title}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      </article>

      <aside className="hidden lg:block">
        <nav className="sticky top-24 rounded-2xl border border-slate-200 bg-white p-5">
          <h3 className="mb-3 flex items-center gap-2 font-bold text-slate-900"><ListOrdered className="h-4 w-4" /> 目錄</h3>
          <ul className="space-y-2 text-sm">
            {toc.map((t) => (
              <li key={t.id}><a href={`#${t.id}`} className="text-slate-600 hover:text-brand-600">{t.text}</a></li>
            ))}
          </ul>
        </nav>
      </aside>
    </div>
  );
}
