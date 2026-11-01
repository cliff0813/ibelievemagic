import assert from "node:assert/strict";
import { test } from "node:test";
import { articleImagePath } from "./article-image-path.mjs";

test("adds the GitHub Pages base path to local public images", () => {
  assert.equal(
    articleImagePath("/images/default-article.svg", "/ibelievemagic"),
    "/ibelievemagic/images/default-article.svg",
  );
});

test("does not alter image URLs or paths when no base path is configured", () => {
  assert.equal(
    articleImagePath("https://example.com/cover.jpg", "/ibelievemagic"),
    "https://example.com/cover.jpg",
  );
  assert.equal(articleImagePath("/images/default-article.svg", ""), "/images/default-article.svg");
});
