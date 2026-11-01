import assert from "node:assert/strict";
import fs from "node:fs";
import Module, { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { loadCourses } from "./course-api.mjs";
import { dispatchEvent, findAll, installFakeDom, setNativeValue } from "./fake-dom.mjs";
import {
  courseDetailHref,
  filterCourses,
  findCourseById,
  startCourseLoad,
} from "./live-courses.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nodeRequire = createRequire(import.meta.url);
const ts = nodeRequire("typescript");
// react-dom captures DOM availability at import time, so a fake DOM must exist first.
const suiteDom = installFakeDom();
after(() => suiteDom.restore());
const { createElement } = nodeRequire("react");
const { renderToStaticMarkup } = nodeRequire("react-dom/server");

// ---- minimal TSX loader: transpiles real components, no new dependencies ----
const searchState = { query: "" };
const stubs = {
  "next/link": {
    default: ({ href, children, ...rest }) => createElement("a", { href, ...rest }, children),
  },
  "next/navigation": { useSearchParams: () => new URLSearchParams(searchState.query) },
  "@/lib/data": {
    formatCourseDate: (d) => `D:${d}`,
    formatCourseDateLong: (d) => `DL:${d}`,
  },
};
const cache = new Map();
function resolveFile(base) {
  for (const ext of ["", ".tsx", ".ts", ".mjs", ".json", "/index.tsx"]) {
    const p = base + ext;
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  throw new Error(`Cannot resolve ${base}`);
}
function loadModule(file) {
  if (cache.has(file)) return cache.get(file).exports;
  if (!/\.tsx?$/.test(file)) return nodeRequire(file);
  const mod = new Module(file);
  mod.filename = file;
  mod.paths = Module._nodeModulePaths(path.dirname(file));
  cache.set(file, mod);
  mod.require = (spec) => {
    if (stubs[spec]) return { __esModule: true, ...stubs[spec] };
    if (spec.startsWith("@/")) return loadModule(resolveFile(path.join(root, spec.slice(2))));
    if (spec.startsWith(".")) return loadModule(resolveFile(path.resolve(path.dirname(file), spec)));
    return nodeRequire(spec);
  };
  const { outputText } = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: file,
  });
  mod._compile(outputText, file);
  return mod.exports;
}
const load = (rel) => loadModule(path.join(root, rel));
const html = (el) => renderToStaticMarkup(el);

const course = (over = {}) => ({
  id: "c1",
  title: "實價登錄實務",
  date: "2026-12-05",
  startTime: "09:00",
  endTime: "12:00",
  location: "台北教室 A",
  mode: "實體+線上",
  image: "/images/c1.jpg",
  description: "這是一門關於買賣的課程",
  instructor: "王大明",
  instructorBio: ["地政士", "二十年經驗"],
  outline: ["第一章 登記", "第二章 稅務", "第三章 融資"],
  pricing: [
    { label: "早鳥價", price: 1200 },
    { label: "原價", price: 1800 },
    { label: "團體價", price: 1000 },
  ],
  ...over,
});

async function settle() {
  await new Promise((r) => setImmediate(r));
}

// ---- state machine ----
test("startCourseLoad reports loading then ready", async () => {
  const states = [];
  startCourseLoad({ load: async () => [course()], onState: (s) => states.push(s) });
  await settle();
  assert.deepEqual(states.map((s) => s.status), ["loading", "ready"]);
  assert.equal(states[1].courses[0].id, "c1");
});

test("startCourseLoad reports empty, error, and retry via a fresh load", async () => {
  const states = [];
  startCourseLoad({ load: async () => [], onState: (s) => states.push(s) });
  await settle();
  assert.equal(states.at(-1).status, "empty");

  startCourseLoad({
    load: async () => {
      throw new Error("Timed out loading public courses");
    },
    onState: (s) => states.push(s),
  });
  await settle();
  assert.deepEqual(states.at(-1), { status: "error", message: "Timed out loading public courses" });

  startCourseLoad({ load: async () => [course()], onState: (s) => states.push(s) });
  await settle();
  assert.deepEqual(states.slice(-2).map((s) => s.status), ["loading", "ready"]);
});

test("cancelling a load suppresses later state", async () => {
  const states = [];
  const cancel = startCourseLoad({ load: async () => [course()], onState: (s) => states.push(s) });
  cancel();
  await settle();
  assert.deepEqual(states.map((s) => s.status), ["loading"]);
});

test("startCourseLoad works end to end with the JSONP client", async () => {
  const callbacks = Object.create(null);
  const windowObject = callbacks;
  const documentObject = {
    head: {
      appendChild(script) {
        const cb = new URL(script.src).searchParams.get("callback");
        queueMicrotask(() =>
          windowObject[cb]([{ ...course(), id: undefined, courseId: "live-1", title: "Live" }]),
        );
        script.parentNode = this;
      },
      removeChild() {},
    },
    createElement: () => ({}),
  };
  const config = JSON.parse(fs.readFileSync(path.join(root, "data/gas-registration.json"), "utf8"));
  const states = [];
  startCourseLoad({
    load: () =>
      loadCourses({
        webAppUrl: config.webAppUrl,
        windowObject,
        documentObject,
        randomUUID: () => "abc-123",
        setTimeoutFn: () => 1,
        clearTimeoutFn: () => {},
      }),
    onState: (s) => states.push(s),
  });
  await settle();
  assert.equal(states.at(-1).status, "ready");
  assert.equal(states.at(-1).courses[0].id, "live-1");
});

// ---- pure helpers ----
test("filterCourses searches title, instructor, and description", () => {
  const list = [
    course({ id: "a", title: "Alpha", instructor: "X", description: "d1" }),
    course({ id: "b", title: "T", instructor: "Beta Teacher", description: "d2" }),
    course({ id: "c", title: "T", instructor: "Y", description: "mentions GAMMA here" }),
  ];
  assert.deepEqual(filterCourses(list, "alpha").map((c) => c.id), ["a"]);
  assert.deepEqual(filterCourses(list, " beta ").map((c) => c.id), ["b"]);
  assert.deepEqual(filterCourses(list, "gamma").map((c) => c.id), ["c"]);
  assert.equal(filterCourses(list, "").length, 3);
  assert.equal(filterCourses(list, "nomatch").length, 0);
});

test("detail href uses the generic route with an encoded ID query", () => {
  assert.equal(courseDetailHref("a b&c/d"), "/courses/detail/?id=a%20b%26c%2Fd");
  assert.equal(findCourseById([course()], "c1")?.id, "c1");
  assert.equal(findCourseById([course()], "zzz"), undefined);
  assert.equal(findCourseById([course()], null), undefined);
});

// ---- list rendering ----
test("list shows distinguishable loading, error+retry, and no-courses states", () => {
  const { LiveCourseListView } = load("components/LiveCourseList.tsx");
  const noop = () => {};
  const loading = html(createElement(LiveCourseListView, { state: { status: "loading" }, onRetry: noop }));
  const error = html(
    createElement(LiveCourseListView, { state: { status: "error", message: "Timed out loading public courses" }, onRetry: noop }),
  );
  const empty = html(createElement(LiveCourseListView, { state: { status: "empty" }, onRetry: noop }));

  assert.match(loading, /載入中/);
  assert.doesNotMatch(loading, /<button/);
  assert.match(error, /Timed out loading public courses/);
  assert.match(error, /<button[^>]*>[^<]*重試/);
  assert.match(empty, /目前沒有開放的課程/);
  assert.doesNotMatch(empty, /<button/);
  assert.notEqual(loading, error);
  assert.notEqual(error, empty);
  assert.doesNotMatch(error, /載入中|目前沒有開放/);
  assert.doesNotMatch(empty, /載入中|載入失敗/);
});

test("home variant renders endpoint records (first 3) with generic detail links", () => {
  const { LiveCourseListView } = load("components/LiveCourseList.tsx");
  const courses = [
    course({ id: "a b&c", title: "T1" }),
    course({ id: "2", title: "T2" }),
    course({ id: "3", title: "T3" }),
    course({ id: "4", title: "T4" }),
  ];
  const out = html(createElement(LiveCourseListView, { state: { status: "ready", courses }, onRetry() {}, limit: 3 }));
  assert.match(out, /T1/);
  assert.match(out, /T3/);
  assert.doesNotMatch(out, /T4/);
  assert.match(out, /href="\/courses\/detail\/\?id=a%20b%26c"/);
  assert.doesNotMatch(out, /href="\/courses\/(a|2)/);
  assert.match(out, /NT\$1,200/);
});

test("list variant renders every endpoint record with a search box", () => {
  const { LiveCourseListView } = load("components/LiveCourseList.tsx");
  const courses = [course({ id: "1", title: "T1" }), course({ id: "2", title: "T2" })];
  const out = html(createElement(LiveCourseListView, { state: { status: "ready", courses }, onRetry() {}, searchable: true }));
  assert.match(out, /T1/);
  assert.match(out, /T2/);
  assert.match(out, /<input/);
});

// ---- detail rendering ----
test("detail renders description, outline in order, instructor, location, mode, all prices", () => {
  const { LiveCourseDetailView } = load("components/LiveCourseDetail.tsx");
  const out = html(
    createElement(LiveCourseDetailView, { id: "c1", state: { status: "ready", courses: [course()] }, onRetry() {} }),
  );
  assert.match(out, /這是一門關於買賣的課程/);
  assert.ok(out.indexOf("第一章 登記") < out.indexOf("第二章 稅務"));
  assert.ok(out.indexOf("第二章 稅務") < out.indexOf("第三章 融資"));
  for (const t of ["王大明", "地政士", "二十年經驗", "台北教室 A", "實體+線上".replace("+", "\\+"), "早鳥價", "原價", "團體價", "NT\\$1,200", "NT\\$1,800", "NT\\$1,000"]) {
    assert.match(out, new RegExp(t));
  }
});

test("detail shows not-found for unknown or missing ID, and loading/error+retry", () => {
  const { LiveCourseDetailView } = load("components/LiveCourseDetail.tsx");
  const ready = { status: "ready", courses: [course()] };
  assert.match(html(createElement(LiveCourseDetailView, { id: "nope", state: ready, onRetry() {} })), /找不到這門課程/);
  assert.match(html(createElement(LiveCourseDetailView, { id: null, state: ready, onRetry() {} })), /找不到這門課程/);
  assert.match(html(createElement(LiveCourseDetailView, { id: "c1", state: { status: "empty" }, onRetry() {} })), /找不到這門課程/);
  assert.match(html(createElement(LiveCourseDetailView, { id: "c1", state: { status: "loading" }, onRetry() {} })), /載入中/);
  const err = html(createElement(LiveCourseDetailView, { id: "c1", state: { status: "error", message: "boom" }, onRetry() {} }));
  assert.match(err, /boom/);
  assert.match(err, /重試/);
  assert.doesNotMatch(err, /找不到這門課程/);
});

// ---- routes ----
test("legacy /courses/<id>/ route passes its ID to the live detail component", async () => {
  const page = load("app/courses/[id]/page.tsx");
  const { default: LiveCourseDetail } = load("components/LiveCourseDetail.tsx");
  const el = await page.default({ params: { id: "legacy-7" } });
  assert.equal(el.type, LiveCourseDetail);
  assert.equal(el.props.id, "legacy-7");
});

// ---- interaction tests: real react-dom/client, real hooks, real JSONP client ----
const { act } = nodeRequire("react");
const { createRoot } = nodeRequire("react-dom/client");

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });
const raw = ({ id, ...rest }) => ({ courseId: id, ...rest });

/** Mounts an element against a fake DOM whose script tags answer from `script` (per request). */
async function mount(element, responses) {
  const { window, document, restore } = installFakeDom();
  const requests = [];
  document.head.appendChild = (script) => {
    script.parentNode = document.head;
    const cb = new URL(script.src).searchParams.get("callback");
    const response = responses[requests.length];
    requests.push(script.src);
    setImmediate(() => {
      if (response === "fail") script.onerror();
      else window[cb](response);
    });
    return script;
  };
  document.head.removeChild = () => {};
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(element); });
  await flush();
  return {
    container,
    requests,
    text: () => container.textContent,
    unmount: async () => {
      try {
        await act(async () => root.unmount());
      } finally {
        document.body.removeChild(container);
        restore();
      }
    },
  };
}

const gas = JSON.parse(fs.readFileSync(path.join(root, "data/gas-registration.json"), "utf8"));
const abc = [
  raw(course({ id: "a", title: "Alpha 課", instructor: "X", description: "d1" })),
  raw(course({ id: "b", title: "Other 課", instructor: "Beta Teacher", description: "d2" })),
  raw(course({ id: "c", title: "Other 課二", instructor: "Y", description: "mentions GAMMA" })),
];

test("retry button click issues a new request and renders the recovered courses", async () => {
  const { default: LiveCourseList } = load("components/LiveCourseList.tsx");
  const app = await mount(createElement(LiveCourseList, { searchable: true }), ["fail", abc]);
  assert.equal(app.requests.length, 1);
  assert.ok(app.requests[0].startsWith(gas.webAppUrl));
  assert.match(app.text(), /課程資料載入失敗/);
  assert.match(app.text(), /Failed to load the public courses script/);
  assert.doesNotMatch(app.text(), /Alpha 課/);

  const [retry] = findAll(app.container, (n) => n.nodeName === "BUTTON");
  assert.match(retry.textContent, /重試/);
  await act(async () => dispatchEvent(retry, "click"));
  await flush();

  assert.equal(app.requests.length, 2);
  assert.doesNotMatch(app.text(), /載入失敗/);
  assert.match(app.text(), /Alpha 課/);
  assert.match(app.text(), /Other 課二/);
  await app.unmount();
});

test("typing in the search input filters live courses by title, instructor, and description", async () => {
  const { default: LiveCourseList } = load("components/LiveCourseList.tsx");
  const app = await mount(createElement(LiveCourseList, { searchable: true }), [abc]);
  const [input] = findAll(app.container, (n) => n.nodeName === "INPUT");
  const type = async (v) => {
    setNativeValue(input, v);
    await act(async () => dispatchEvent(input, "input"));
  };
  const titles = () => findAll(app.container, (n) => n.nodeName === "H3").map((n) => n.textContent);

  assert.deepEqual(titles(), ["Alpha 課", "Other 課", "Other 課二"]);
  await type("alpha");
  assert.deepEqual(titles(), ["Alpha 課"]);
  await type("beta");
  assert.deepEqual(titles(), ["Other 課"]);
  await type("gamma");
  assert.deepEqual(titles(), ["Other 課二"]);
  await type("zzz");
  assert.deepEqual(titles(), []);
  assert.match(app.text(), /找不到符合的課程/);
  await type("");
  assert.equal(titles().length, 3);
  assert.equal(app.requests.length, 1, "searching must not refetch");
  await app.unmount();
});

test("generic /courses/detail/?id= route passes the query ID to the live detail component", async () => {
  const page = load("app/courses/detail/page.tsx");
  searchState.query = "id=b";
  let app = await mount(createElement(page.default), [abc]);
  assert.equal(app.requests.length, 1);
  assert.match(app.text(), /Other 課/);
  assert.match(app.text(), /Beta Teacher/);
  assert.doesNotMatch(app.text(), /Alpha 課|mentions GAMMA/);
  await app.unmount();

  searchState.query = "id=missing";
  app = await mount(createElement(page.default), [abc]);
  assert.match(app.text(), /找不到這門課程/);
  await app.unmount();

  searchState.query = "";
  app = await mount(createElement(page.default), [abc]);
  assert.match(app.text(), /找不到這門課程/);
  await app.unmount();
});

test("legacy /courses/<id>/ route loads the matching course from the endpoint", async () => {
  const page = load("app/courses/[id]/page.tsx");
  const app = await mount(await page.default({ params: { id: "c" } }), [abc]);
  assert.match(app.text(), /Other 課二/);
  assert.match(app.text(), /mentions GAMMA/);
  assert.doesNotMatch(app.text(), /Alpha 課/);
  await app.unmount();
});