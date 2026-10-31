"use client";
import { useState } from "react";
import { Share2, Link2, Mail, Check } from "lucide-react";

export default function ShareButtons({ title }: { title: string }) {
  const [copied, setCopied] = useState(false);
  const url = () => window.location.href;
  const btn = "inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-brand-50";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-slate-500">分享:</span>
      <button
        className={btn}
        onClick={async () => {
          if (navigator.share) await navigator.share({ title, url: url() }).catch(() => {});
          else window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url())}`, "_blank", "noopener");
        }}
      >
        <Share2 className="h-4 w-4" /> 分享
      </button>
      <button
        className={btn}
        onClick={async () => {
          await navigator.clipboard.writeText(url());
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check className="h-4 w-4" /> : <Link2 className="h-4 w-4" />} {copied ? "已複製" : "複製連結"}
      </button>
      <button className={btn} onClick={() => (window.location.href = `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(url())}`)}>
        <Mail className="h-4 w-4" /> Email
      </button>
    </div>
  );
}
