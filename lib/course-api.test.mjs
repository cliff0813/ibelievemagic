import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { buildCoursesUrl, loadCourses } from "./course-api.mjs";

const config = JSON.parse(
  await readFile(new URL("../data/gas-registration.json", import.meta.url), "utf8"),
);

function createHarness(onAppend = () => {}) {
  const scripts = [];
  const callbacks = Object.create(null);
  const timers = new Map();
  let nextTimerId = 1;
  const head = {
    appendChild(script) {
      scripts.push(script);
      script.parentNode = head;
      onAppend(script, callbacks);
      return script;
    },
    removeChild(script) {
      const index = scripts.indexOf(script);
      if (index !== -1) scripts.splice(index, 1);
      script.parentNode = null;
      return script;
    },
  };
  const documentObject = {
    head,
    createElement(tagName) {
      return { tagName: tagName.toUpperCase(), parentNode: null };
    },
  };

  return {
    callbacks,
    documentObject,
    scripts,
    timers,
    windowObject: callbacks,
    setTimeoutFn(callback, delay) {
      const id = nextTimerId++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeoutFn(id) {
      timers.delete(id);
    },
    fireTimers() {
      for (const { callback } of [...timers.values()]) callback();
    },
  };
}

function course(overrides = {}) {
  return {
    courseId: "course-1",
    title: "Property Essentials",
    date: "2026-12-01",
    startTime: "09:00",
    endTime: "12:00",
    location: "Taipei",
    mode: "in-person",
    image: "/course.jpg",
    description: "Course description",
    instructor: "Instructor",
    instructorBio: "First line\nSecond line",
    outline: ["Topic one", "Topic two"],
    pricing: [{ label: "Standard", price: "1200" }],
    ...overrides,
  };
}

function loadOptions(harness, overrides = {}) {
  return {
    webAppUrl: config.webAppUrl,
    documentObject: harness.documentObject,
    windowObject: harness.windowObject,
    randomUUID: () => "a1b2c3d4-e5f6-4789-abcd-0123456789ab",
    now: () => 1_798_761_600_000,
    setTimeoutFn: harness.setTimeoutFn,
    clearTimeoutFn: harness.clearTimeoutFn,
    ...overrides,
  };
}

test("builds a JSONP URL from the configured HTTPS /exec endpoint", () => {
  const url = new URL(
    buildCoursesUrl(
      config.webAppUrl,
      "__courseApiCallback_a1b2c3d4",
      1_798_761_600_000,
    ),
  );

  assert.equal(url.origin + url.pathname, config.webAppUrl);
  assert.equal(url.searchParams.get("format"), "courses");
  assert.equal(url.searchParams.get("callback"), "__courseApiCallback_a1b2c3d4");
  assert.equal(url.searchParams.get("_"), "1798761600000");
});

test("maps and normalizes callback records, then removes script and callback", async () => {
  const harness = createHarness((script, callbacks) => {
    const url = new URL(script.src);
    assert.match(url.searchParams.get("callback"), /^[$A-Z_a-z][$\w]*$/);
    assert.equal(url.searchParams.get("format"), "courses");
    callbacks[url.searchParams.get("callback")]([course()]);
  });

  const records = await loadCourses(loadOptions(harness));

  assert.deepEqual(records, [
    {
      id: "course-1",
      title: "Property Essentials",
      date: "2026-12-01",
      startTime: "09:00",
      endTime: "12:00",
      location: "Taipei",
      mode: "in-person",
      image: "/course.jpg",
      description: "Course description",
      instructor: "Instructor",
      instructorBio: ["First line", "Second line"],
      outline: ["Topic one", "Topic two"],
      pricing: [{ label: "Standard", price: 1200 }],
    },
  ]);
  assert.equal(harness.scripts.length, 0);
  assert.deepEqual(Object.keys(harness.callbacks), []);
  assert.equal(harness.timers.size, 0);
});

test("accepts an array for instructor bio from forward-compatible APIs", async () => {
  const harness = createHarness((script, callbacks) => {
    const callbackName = new URL(script.src).searchParams.get("callback");
    callbacks[callbackName]([course({ instructorBio: ["Bio line one", "Bio line two"] })]);
  });

  const records = await loadCourses(loadOptions(harness));

  assert.deepEqual(records[0].instructorBio, ["Bio line one", "Bio line two"]);
  assert.equal(harness.scripts.length, 0);
  assert.deepEqual(Object.keys(harness.callbacks), []);
});

test("rejects a script load error and removes script and callback", async () => {
  const harness = createHarness((script) => {
    script.onerror(new Error("network error"));
  });

  await assert.rejects(
    loadCourses(loadOptions(harness)),
    /Failed to load the public courses script/,
  );
  assert.equal(harness.scripts.length, 0);
  assert.deepEqual(Object.keys(harness.callbacks), []);
  assert.equal(harness.timers.size, 0);
});

test("rejects malformed course payloads and removes script and callback", async () => {
  const harness = createHarness((script, callbacks) => {
    const callbackName = new URL(script.src).searchParams.get("callback");
    callbacks[callbackName]([course({ title: undefined })]);
  });

  await assert.rejects(
    loadCourses(loadOptions(harness)),
    /Invalid course data: courses\[0\]\.title/,
  );
  assert.equal(harness.scripts.length, 0);
  assert.deepEqual(Object.keys(harness.callbacks), []);
  assert.equal(harness.timers.size, 0);
});

test("rejects invalid pricing instead of silently coercing it", async () => {
  const harness = createHarness((script, callbacks) => {
    const callbackName = new URL(script.src).searchParams.get("callback");
    callbacks[callbackName]([
      course({ pricing: [{ label: "Standard", price: "not-a-number" }] }),
    ]);
  });

  await assert.rejects(
    loadCourses(loadOptions(harness)),
    /Invalid course data: courses\[0\]\.pricing\[0\]\.price/,
  );
  assert.equal(harness.scripts.length, 0);
  assert.deepEqual(Object.keys(harness.callbacks), []);
});

test("rejects when the JSONP request times out and removes script and callback", async () => {
  const harness = createHarness();

  const result = loadCourses(loadOptions(harness, { timeoutMs: 2500 }));
  harness.fireTimers();

  await assert.rejects(result, /Timed out loading public courses/);
  assert.equal(harness.scripts.length, 0);
  assert.deepEqual(Object.keys(harness.callbacks), []);
  assert.equal(harness.timers.size, 0);
});

test("requires an HTTPS /exec deployment URL", async () => {
  for (const webAppUrl of [
    "http://script.google.com/macros/s/ID/exec",
    "https://script.google.com/macros/s/ID/dev",
  ]) {
    const harness = createHarness();
    await assert.rejects(
      loadCourses(loadOptions(harness, { webAppUrl })),
      /webAppUrl must be an HTTPS URL ending in \/exec/,
    );
    assert.equal(harness.scripts.length, 0);
    assert.deepEqual(Object.keys(harness.callbacks), []);
  }
});

test("concurrent requests use distinct callbacks and clean up independently", async () => {
  const harness = createHarness();
  const uuids = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  ];
  const options = loadOptions(harness, { randomUUID: () => uuids.shift() });

  const first = loadCourses(options);
  const second = loadCourses(options);
  const names = harness.scripts.map((s) => new URL(s.src).searchParams.get("callback"));

  assert.equal(names.length, 2);
  assert.notEqual(names[0], names[1]);
  assert.ok(names.every((name) => typeof harness.callbacks[name] === "function"));

  harness.callbacks[names[1]]([course({ courseId: "second" })]);
  assert.equal((await second)[0].id, "second");
  assert.equal(harness.scripts.length, 1);
  assert.equal(typeof harness.callbacks[names[0]], "function");
  assert.equal(harness.callbacks[names[1]], undefined);

  harness.callbacks[names[0]]([course({ courseId: "first" })]);
  assert.equal((await first)[0].id, "first");
  assert.equal(harness.scripts.length, 0);
  assert.equal(harness.callbacks[names[0]], undefined);
});

test("retries a colliding callback identifier without overwriting the in-flight callback", async () => {
  const harness = createHarness();
  const uuids = [
    "11111111-1111-4111-8111-111111111111",
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  ];
  const options = loadOptions(harness, { randomUUID: () => uuids.shift() });

  const first = loadCourses(options);
  const firstName = new URL(harness.scripts[0].src).searchParams.get("callback");
  const original = harness.callbacks[firstName];
  const second = loadCourses(options);
  const secondName = new URL(harness.scripts[1].src).searchParams.get("callback");

  assert.notEqual(secondName, firstName);
  assert.equal(harness.callbacks[firstName], original);
  original([course({ courseId: "first" })]);
  harness.callbacks[secondName]([course({ courseId: "second" })]);
  assert.equal((await first)[0].id, "first");
  assert.equal((await second)[0].id, "second");
});

test("rejects when a unique callback identifier cannot be allocated", async () => {
  const harness = createHarness();
  const same = "11111111-1111-4111-8111-111111111111";
  const options = loadOptions(harness, { randomUUID: () => same });

  loadCourses(options);
  await assert.rejects(
    loadCourses(options),
    /Unable to create a unique JSONP callback identifier/,
  );
  assert.equal(harness.scripts.length, 1);
});