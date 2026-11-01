const WEEKDAYS = "日一二三四五六";

// Parse a YYYY-MM-DD date-only value into calendar components without
// converting through a timezone-dependent instant.
function parseDateParts(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date));
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return { year, month, day, weekday };
}

export function formatCourseDateLong(date) {
  const p = parseDateParts(date);
  if (!p) return String(date);
  return `${p.year}年${p.month}月${p.day}日星期${WEEKDAYS[p.weekday]}`;
}

export function formatCourseDate(date) {
  const p = parseDateParts(date);
  if (!p) return String(date);
  return `${p.month}月${p.day}日週${WEEKDAYS[p.weekday]}`;
}