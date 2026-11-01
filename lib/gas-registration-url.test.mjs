import assert from "node:assert/strict";
import { test } from "node:test";
import { gasRegistrationHref } from "./gas-registration-url.mjs";

test("保留既有查詢參數並附上編碼後的課程 ID", () => {
  const href = gasRegistrationHref(
    "https://script.google.com/macros/s/DEPLOYMENT_ID/exec?src=site&courseId=old",
    "course/1",
  );

  assert.equal(
    href,
    "https://script.google.com/macros/s/DEPLOYMENT_ID/exec?src=site&courseId=course%2F1",
  );
});

test("未設定公開 GAS URL 時不產生失效連結", () => {
  assert.equal(gasRegistrationHref("", "course-1"), null);
});

function captureErrors(fn) {
  const original = console.error;
  const messages = [];
  console.error = (...args) => messages.push(args.join(" "));
  try {
    return { result: fn(), messages };
  } finally {
    console.error = original;
  }
}

test("格式錯誤的 GAS URL 不會中斷產生頁面，並明確警告", () => {
  for (const bad of ["not a url", "/relative/path", "http://script.google.com/macros/s/ID/exec", "ftp://example.com/x"]) {
    const { result, messages } = captureErrors(() => gasRegistrationHref(bad, "course-1"));
    assert.equal(result, null, bad);
    assert.equal(messages.length, 1, bad);
    assert.match(messages[0], /data\/gas-registration\.json/);
    assert.match(messages[0], /webAppUrl/);
  }
});

test("空白 URL 維持靜默略過", () => {
  const { result, messages } = captureErrors(() => gasRegistrationHref("", "course-1"));
  assert.equal(result, null);
  assert.equal(messages.length, 0);
});
