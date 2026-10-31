"use client";
import Link from "next/link";
import { useState } from "react";
import { Building2, Menu, X } from "lucide-react";

const links = [
  { href: "/courses", label: "最新課程" },
  { href: "/notice", label: "報名須知" },
  { href: "/#knowledge", label: "不動產知識庫" },
  { href: "/#news", label: "產業新聞" },
  { href: "/#about", label: "關於我們" },
];

export default function Header() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 font-bold text-brand-900">
          <Building2 className="h-6 w-6 text-brand-600" /> 不動產學堂
        </Link>
        <nav className="hidden items-center gap-8 md:flex">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="text-sm font-medium text-slate-600 hover:text-brand-600">
              {l.label}
            </Link>
          ))}
          <Link href="/#contact" className="rounded-full bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-700">
            聯絡我們
          </Link>
        </nav>
        <button className="md:hidden" aria-label="開啟選單" onClick={() => setOpen(!open)}>
          {open ? <X /> : <Menu />}
        </button>
      </div>
      {open && (
        <nav className="flex flex-col gap-1 border-t bg-white px-4 py-3 md:hidden">
          {[...links, { href: "/#contact", label: "聯絡我們" }].map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="rounded px-2 py-3 text-slate-700 hover:bg-brand-50">
              {l.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
