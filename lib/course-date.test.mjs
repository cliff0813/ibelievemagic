import test from "node:test";
import assert from "node:assert/strict";
import { formatCourseDate, formatCourseDateLong } from "./course-date.mjs";

test("formatCourseDate keeps the calendar day regardless of process timezone", () => {
  assert.equal(formatCourseDate("2026-11-17"), "11月17日週二");
});

test("formatCourseDateLong keeps the calendar day regardless of process timezone", () => {
  assert.equal(formatCourseDateLong("2026-11-17"), "2026年11月17日星期二");
});