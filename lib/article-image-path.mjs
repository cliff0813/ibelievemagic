/**
 * @param {string} src
 * @param {string} basePath
 * @returns {string}
 */
export function articleImagePath(src, basePath) {
  if (!basePath || !src.startsWith("/") || src.startsWith("//")) return src;
  return `${basePath.replace(/\/$/, "")}${src}`;
}
