import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const sourcePath = path.join(repositoryRoot, "data", "courses.json");
const outputPath = path.join(repositoryRoot, "gas", "src", "FallbackCourses.gs");

const courses = JSON.parse(readFileSync(sourcePath, "utf8"));
if (!Array.isArray(courses)) {
  throw new TypeError("data/courses.json must contain an array of courses");
}

const orderedCourses = courses.slice().sort((left, right) => {
  const leftDate = String(left.date || "");
  const rightDate = String(right.date || "");
  if (leftDate !== rightDate) {
    return leftDate < rightDate ? -1 : 1;
  }

  const leftId = String(left.id || "");
  const rightId = String(right.id || "");
  return leftId === rightId ? 0 : leftId < rightId ? -1 : 1;
});

function sortObjectKeys(value) {
  if (Array.isArray(value)) {
    return value.map(sortObjectKeys);
  }
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((sorted, key) => {
        sorted[key] = sortObjectKeys(value[key]);
        return sorted;
      }, {});
  }
  return value;
}

const output = `var FALLBACK_COURSES = ${JSON.stringify(
  sortObjectKeys(orderedCourses),
  null,
  2,
)};\n`;
writeFileSync(outputPath, output, "utf8");
