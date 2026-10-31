import Link from "next/link";
import { Mail, Phone, MapPin } from "lucide-react";

export default function Footer() {
  return (
    <footer id="contact" className="mt-20 bg-brand-900 text-slate-300">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 md:grid-cols-3">
        <div>
          <h3 className="mb-3 text-lg font-bold text-white">不動產學堂</h3>
          <p className="text-sm leading-relaxed">專為不動產從業人員打造的教育訓練與知識平台。</p>
        </div>
        <div>
          <h4 className="mb-3 font-semibold text-white">快速連結</h4>
          <ul className="space-y-2 text-sm">
            <li><Link href="/courses" className="hover:text-white">最新課程</Link></li>
            <li><Link href="/notice" className="hover:text-white">報名須知</Link></li>
            <li><Link href="/#knowledge" className="hover:text-white">知識庫</Link></li>
            <li><Link href="/#news" className="hover:text-white">產業新聞</Link></li>
            <li><Link href="/#about" className="hover:text-white">講師團隊</Link></li>
          </ul>
        </div>
        <div>
          <h4 className="mb-3 font-semibold text-white">聯絡方式</h4>
          <ul className="space-y-2 text-sm">
            <li className="flex items-center gap-2"><Mail className="h-4 w-4" /> contact@example.com</li>
            <li className="flex items-center gap-2"><Phone className="h-4 w-4" /> 02-1234-5678</li>
            <li className="flex items-center gap-2"><MapPin className="h-4 w-4" /> 台北市(請填入地址)</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10 px-4 py-6 text-center text-xs leading-relaxed text-slate-400">
        <p className="mx-auto max-w-3xl">免責聲明:本站內容僅供教育與資訊參考,不構成法律、稅務或投資建議。實際個案請諮詢專業人士並以主管機關最新規定為準。</p>
        <p className="mt-2">© {new Date().getFullYear()} 不動產學堂. All rights reserved.</p>
      </div>
    </footer>
  );
}
