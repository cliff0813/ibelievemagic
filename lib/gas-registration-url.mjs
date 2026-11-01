/**
 * @param {string} baseUrl
 * @param {string} courseId
 * @returns {string | null}
 */
export function gasRegistrationHref(baseUrl, courseId) {
  if (!baseUrl) return null;

  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    return malformed(baseUrl);
  }
  if (url.protocol !== "https:") return malformed(baseUrl);

  url.searchParams.set("courseId", courseId);
  return url.toString();
}

function malformed(baseUrl) {
  console.error(
    `[gas-registration] data/gas-registration.json 的 webAppUrl 格式錯誤（需為有效的 https URL），已略過報名連結：${JSON.stringify(baseUrl)}`,
  );
  return null;
}
