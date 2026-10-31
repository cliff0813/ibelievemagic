import noticeJson from "@/data/notice.json";

export const metadata = { title: "報名須知|不動產學堂" };

export default function NoticePage() {
  return (
    <section className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="mb-3 text-3xl font-bold text-brand-900">報名須知</h1>
      <p className="mb-10 rounded-xl bg-brand-50 p-4 leading-relaxed text-slate-700">{noticeJson.intro}</p>

      <div className="space-y-8">
        {noticeJson.sections.map((s) => (
          <div key={s.title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-bold text-slate-900">{s.title}</h2>
            <ol className="list-decimal space-y-2 pl-5 leading-relaxed text-slate-700">
              {s.items.map((it) => <li key={it}>{it}</li>)}
            </ol>
          </div>
        ))}
      </div>

      <p className="mt-10 text-center text-slate-600">{noticeJson.closing}</p>
    </section>
  );
}
