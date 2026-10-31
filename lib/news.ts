import { XMLParser } from "fast-xml-parser";

export type NewsItem = {
  id: string;
  title: string;
  summary?: string;
  source: string;
  url: string;
  publishedAt: string;
};

const QUERY = "不動產 OR 房地產 OR 房市 OR 實價登錄";
const FEED_URL = `https://news.google.com/rss/search?q=${encodeURIComponent(`${QUERY} when:7d`)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;
const MAX_ITEMS = 8;
const REVALIDATE_SECONDS = 1800;

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

export async function fetchRealEstateNews(): Promise<NewsItem[]> {
  const res = await fetch(FEED_URL, { next: { revalidate: REVALIDATE_SECONDS } });
  if (!res.ok) throw new Error(`RSS request failed: ${res.status}`);

  const xml = parser.parse(await res.text());
  const raw = xml?.rss?.channel?.item;
  const items: any[] = Array.isArray(raw) ? raw : raw ? [raw] : [];

  return items
    .map((it) => {
      const source: string = it.source?.["#text"] ?? "";
      const title = String(it.title ?? "").replace(new RegExp(`\\s*-\\s*${source}$`), "").trim();
      return {
        id: String(it.guid?.["#text"] ?? it.guid ?? it.link),
        title,
        source,
        url: String(it.link),
        publishedAt: new Date(it.pubDate).toISOString(),
      };
    })
    .filter((n) => n.title && n.url && !Number.isNaN(Date.parse(n.publishedAt)))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, MAX_ITEMS);
}
