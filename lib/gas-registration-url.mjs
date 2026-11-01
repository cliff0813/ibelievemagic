/**
 * @param {string} baseUrl
 * @param {string} courseId
 * @returns {string | null}
 */
export function gasRegistrationHref(baseUrl, courseId) {
  if (!baseUrl) return null;

  const url = new URL(baseUrl);
  url.searchParams.set("courseId", courseId);
  return url.toString();
}
