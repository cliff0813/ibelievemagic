import { DEFAULT_ARTICLE_IMAGE } from "@/lib/data";

// Falls back to the default cover when an article has no dedicated image.
export default function ArticleCover({ src, alt, className = "" }: { src?: string; alt: string; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src || DEFAULT_ARTICLE_IMAGE} alt={alt} loading="lazy" className={`aspect-[16/9] w-full object-cover ${className}`} />
  );
}
