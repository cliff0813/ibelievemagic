const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const repositoryRoot = path.join(__dirname, "..", "..");
const sourcePath = path.join(repositoryRoot, "data", "courses.json");
const generatedPath = path.join(__dirname, "..", "src", "FallbackCourses.gs");
const scriptPath = path.join(__dirname, "..", "scripts", "sync-fallback.mjs");

test("fallback generator emits GAS-loadable data equal to courses.json", () => {
  const firstRun = spawnSync(process.execPath, [scriptPath], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  assert.equal(firstRun.status, 0, firstRun.stderr || firstRun.error?.message);

  const firstOutput = fs.readFileSync(generatedPath, "utf8");
  const context = {};
  vm.createContext(context);
  vm.runInContext(firstOutput, context, { filename: "FallbackCourses.gs" });
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.FALLBACK_COURSES)),
    JSON.parse(fs.readFileSync(sourcePath, "utf8")),
  );

  const secondRun = spawnSync(process.execPath, [scriptPath], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  assert.equal(secondRun.status, 0, secondRun.stderr || secondRun.error?.message);
  assert.equal(fs.readFileSync(generatedPath, "utf8"), firstOutput);
});
