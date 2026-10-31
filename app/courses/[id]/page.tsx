import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Calendar, MapPin, Monitor, Banknote, Phone, Video, Check } from "lucide-react";
import ShareButtons from "@/components/ShareButtons";
import { getCourses, getCourseById, formatCourseDateLong } from "@/lib/data";
import info from "@/data/course-info.json";

export async function generateStaticParams() {
  return (await getCourses()).map((c) => ({ id: c.id }));
}

export async function generateMetadata({ params }: { params: { id: string } }) {
  const c = await getCourseById(params.id);
  return { title: c ? `${c.title}|不動產學堂` : "課程不存在" };
}

const card = "rounded-2xl border border-slate-200 bg-white p-6 shadow-sm";
const h2 = "mb-4 text-xl font-bold text-slate-900";

export default async function CourseDetailPage({ params }: { params: { id: string } }) {
  const c = await getCourseById(params.id);
  if (!c) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <Link href="/courses" className="inline-flex items-center gap-1 text-sm text-brand-600 hover:underline">
        <ArrowLeft className="h-4 w-4" /> 返回課程列表
      </Link>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={c.image} alt={c.title} className="w-full rounded-2xl shadow-sm" />

      <h1 className="text-2xl font-bold leading-snug text-brand-900 md:text-3xl">{c.title}</h1>
      <ShareButtons title={c.title} />
      <p className="leading-8 text-slate-700">{c.description}</p>

      <section className={card}>
        <h2 className={h2}>課程綱要</h2>
        <ol className="space-y-2">
          {c.outline.map((o) => (
            <li key={o} className="flex gap-2 text-slate-700"><Check className="mt-1 h-4 w-4 shrink-0 text-brand-600" />{o}</li>
          ))}
        </ol>
      </section>

      <section className={card}>
        <h2 className={h2}>講師介紹</h2>
        <p className="font-semibold text-slate-900">{c.instructor}</p>
        {c.instructorBio.map((b) => <p key={b} className="mt-2 text-sm leading-relaxed text-slate-600">{b}</p>)}
      </section>

      <section className={card}>
        <h2 className={h2}>開課資訊</h2>
        <dl className="grid gap-4 text-sm sm:grid-cols-3">
          <div><dt className="mb-1 flex items-center gap-1 text-slate-500"><Calendar className="h-4 w-4" />時間</dt>
            <dd className="font-medium text-slate-900">{formatCourseDateLong(c.date)} {c.startTime}–{c.endTime}</dd></div>
          <div><dt className="mb-1 flex items-center gap-1 text-slate-500"><MapPin className="h-4 w-4" />地點</dt>
            <dd className="font-medium text-slate-900">{c.location}</dd></div>
          <div><dt className="mb-1 flex items-center gap-1 text-slate-500"><Monitor className="h-4 w-4" />進行方式</dt>
            <dd className="font-medium text-slate-900">{c.mode}</dd></div>
        </dl>
      </section>

      <section className={card}>
        <h2 className={h2}>費用</h2>
        <ul className="divide-y divide-slate-100">
          {c.pricing.map((p) => (
            <li key={p.label} className="flex items-center justify-between gap-4 py-3 text-sm">
              <span className="text-slate-700">{p.label}</span>
              <span className="shrink-0 font-bold text-brand-900">NT${p.price.toLocaleString()}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs leading-relaxed text-slate-500">{info.pricingNote}</p>
      </section>

      <section className={card}>
        <h2 className={h2}>報名須知</h2>
        <ol className="list-decimal space-y-2 pl-5 text-slate-700">
          {info.registrationSteps.map((s) => <li key={s}>{s}</li>)}
        </ol>
        <a href={info.contact.lineUrl} target="_blank" rel="noopener noreferrer"
          className="mt-5 inline-block rounded-full bg-brand-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">
          透過官方 LINE 報名 / 詢問
        </a>
        <p className="mt-3 text-xs text-slate-500">完整規則請見 <Link href="/notice" className="text-brand-600 underline">報名須知</Link>。</p>
      </section>

      <section className={card}>
        <h2 className={`${h2} flex items-center gap-2`}><Banknote className="h-5 w-5" />匯款帳號</h2>
        <dl className="space-y-1 text-sm text-slate-700">
          <div>銀行:{info.bank.name}</div>
          <div>帳號:{info.bank.account}</div>
          <div>戶名:{info.bank.holder}</div>
        </dl>
      </section>

      <section className={card}>
        <h2 className={`${h2} flex items-center gap-2`}><Phone className="h-5 w-5" />客服聯絡</h2>
        <dl className="space-y-1 text-sm text-slate-700">
          <div>電話:<a href={`tel:${info.contact.phone}`} className="text-brand-600">{info.contact.phone}</a>({info.contact.contactName})</div>
          <div>時間:{info.contact.hours}</div>
        </dl>
        <p className="mt-2 text-xs text-slate-500">{info.contact.refundNote}</p>
      </section>

      <section className={card}>
        <h2 className={`${h2} flex items-center gap-2`}><Video className="h-5 w-5" />線上遠距上課方式</h2>
        <p className="text-sm leading-relaxed text-slate-700">{info.online.description}</p>
        <a href={info.online.downloadUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-sm font-semibold text-brand-600 hover:underline">
          下載 Zoom ↗
        </a>
      </section>
    </div>
  );
}
