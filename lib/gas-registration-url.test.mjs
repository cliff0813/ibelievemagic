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
