const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const sourceDirectory = path.join(__dirname, "..", "src");

// Live HtmlService/google.script.run acceptance remains pending; GAS deployment credentials are unavailable here.
function loadWebApp(courses, options = {}) {
  const contentRecords = {
    CourseOutline: options.outline || [],
    CoursePricing: options.pricing || [],
  };
  const missingSheets = new Set(options.missingSheets || []);
  const sheetReadErrors = options.sheetReadErrors || {};
  const context = {
    adminChecks: 0,
    requireAdmin_: () => {
      context.adminChecks++;
      return "admin@example.com";
    },
    getCourses_: () => structuredClone(courses),
    getRegistrationSpreadsheet_: () => ({
      getSheetByName(name) {
        return missingSheets.has(name) ? null : { name };
      },
    }),
    getSheetRecords_: (name) => {
      if (sheetReadErrors[name]) throw sheetReadErrors[name];
      return structuredClone(contentRecords[name]);
    },
    getCourseAvailability_: (date, now, manualMode) =>
      date > "2026-11-01" && manualMode !== "CLOSED" ? "OPEN" : "CLOSED",
    ContentService: {
      MimeType: { JAVASCRIPT: "application/javascript" },
      createTextOutput(content) {
        return {
          content,
          mimeType: "",
          setMimeType(mimeType) {
            this.mimeType = mimeType;
            return this;
          },
        };
      },
    },
    HtmlService: {
      createTemplateFromFile(name) {
        const template = {
          initialCourseId: "",
          evaluate() {
            return {
              title: "",
              setTitle(title) {
                this.title = title;
                return this;
              },
            };
          },
        };
        context.lastTemplateName = name;
        context.lastTemplate = template;
        return template;
      },
    },
  };
  vm.createContext(context);
  const filename = path.join(sourceDirectory, "WebApp.gs");
  vm.runInContext(fs.readFileSync(filename, "utf8"), context, { filename });
  return context;
}

test("public course JSONP includes allowlisted display fields for every valid course", () => {
  const context = loadWebApp(
    [
      {
        courseId: "open-1",
        title: "開放課程",
        date: "2026-12-01",
        startTime: "10:00",
        endTime: "12:00",
        location: "台北",
        mode: "實體",
        image: "https://example.com/course.png",
        description: "課程介紹",
        instructor: "講師",
        instructorBio: "講師介紹",
        manualRegistrationMode: "AUTO",
        spreadsheetId: "private-sheet-id",
        bookings: [{ bookingId: "private-booking-id" }],
        unexpectedPrivateField: "private-value",
      },
      {
        courseId: "closed-1",
        title: "關閉課程",
        date: "2026-12-02",
        manualRegistrationMode: "CLOSED",
      },
      {
        courseId: "expired-1",
        title: "過期課程",
        date: "2026-10-30",
        manualRegistrationMode: "AUTO",
      },
      { courseId: "", title: "無效課程" },
      { courseId: "missing-title" },
    ],
    {
      outline: [
        { courseId: "open-1", sortOrder: 20, item: "第二項" },
        { courseId: "closed-1", sortOrder: 1, item: "關閉課程大綱" },
        { courseId: "open-1", sortOrder: 10, item: "第一項" },
      ],
      pricing: [
        { courseId: "open-1", sortOrder: 2, label: "優惠", price: 800 },
        { courseId: "expired-1", sortOrder: 1, label: "過期課程費用", price: 0 },
        { courseId: "open-1", sortOrder: 1, label: "原價", price: 1000 },
      ],
    },
  );

  const response = context.doGet({
    parameter: { format: "courses", callback: "courseCallback" },
  });

  assert.equal(response.mimeType, "application/javascript");
  assert.match(response.content, /^courseCallback\([\s\S]*\);$/);
  const payload = JSON.parse(response.content.match(/^courseCallback\(([\s\S]*)\);$/)[1]);
  assert.deepEqual(JSON.parse(JSON.stringify(payload)), [
    {
      courseId: "open-1",
      title: "開放課程",
      date: "2026-12-01",
      startTime: "10:00",
      endTime: "12:00",
      location: "台北",
      mode: "實體",
      image: "https://example.com/course.png",
      description: "課程介紹",
      instructor: "講師",
      instructorBio: "講師介紹",
      outline: ["第一項", "第二項"],
      pricing: [
        { label: "原價", price: 1000 },
        { label: "優惠", price: 800 },
      ],
    },
    {
      courseId: "closed-1",
      title: "關閉課程",
      date: "2026-12-02",
      startTime: "",
      endTime: "",
      location: "",
      mode: "",
      image: "",
      description: "",
      instructor: "",
      instructorBio: "",
      outline: ["關閉課程大綱"],
      pricing: [],
    },
    {
      courseId: "expired-1",
      title: "過期課程",
      date: "2026-10-30",
      startTime: "",
      endTime: "",
      location: "",
      mode: "",
      image: "",
      description: "",
      instructor: "",
      instructorBio: "",
      outline: [],
      pricing: [{ label: "過期課程費用", price: 0 }],
    },
  ]);
});

test("public course JSONP rejects callbacks outside the JavaScript identifier allowlist", () => {
  const context = loadWebApp([]);

  for (const callback of ["courseCallback.alert(1)", "bad-name", "1bad", ""]) {
    assert.throws(
      () => context.doGet({ parameter: { format: "courses", callback } }),
      /callback/i,
    );
  }
});

test("public course JSONP rejects reserved words as callbacks", () => {
  const context = loadWebApp([]);

  for (const callback of [
    "class", "default", "return", "null", "true", "false", "this", "typeof",
    "enum", "implements", "let", "static", "yield", "await", "eval", "arguments",
  ]) {
    assert.throws(
      () => context.doGet({ parameter: { format: "courses", callback } }),
      /callback/i,
      callback,
    );
  }
  assert.doesNotThrow(() =>
    context.doGet({ parameter: { format: "courses", callback: "classCallback" } }),
  );
});
test("public course JSONP treats missing detail sheets as empty content", () => {
  const context = loadWebApp(
    [{ courseId: "course-1", title: "課程" }],
    { missingSheets: ["CourseOutline", "CoursePricing"] },
  );

  const response = context.doGet({
    parameter: { format: "courses", callback: "courseCallback" },
  });
  const payload = JSON.parse(response.content.match(/^courseCallback\(([\s\S]*)\);$/)[1]);

  assert.deepEqual(JSON.parse(JSON.stringify(payload[0].outline)), []);
  assert.deepEqual(JSON.parse(JSON.stringify(payload[0].pricing)), []);
});

test("public course JSONP propagates content sheet read failures", () => {
  const readError = new Error("CourseOutline read failed");
  const context = loadWebApp(
    [{ courseId: "course-1", title: "課程" }],
    { sheetReadErrors: { CourseOutline: readError } },
  );

  assert.throws(
    () =>
      context.doGet({
        parameter: { format: "courses", callback: "courseCallback" },
      }),
    (error) => error === readError,
  );
});

test("public course API returns only open, displayable fields", () => {
  const context = loadWebApp([
    {
      courseId: "open-1",
      title: "開放課程",
      date: "2026-12-01",
      startTime: "10:00",
      endTime: "12:00",
      location: "台北",
      mode: "實體",
      image: "https://example.com/course.png",
      manualRegistrationMode: "AUTO",
      price: 999,
      spreadsheetId: "private-id",
    },
    {
      courseId: "closed-1",
      title: "關閉課程",
      date: "2026-12-02",
      manualRegistrationMode: "CLOSED",
    },
    {
      courseId: "expired-1",
      title: "過期課程",
      date: "2026-10-30",
      manualRegistrationMode: "AUTO",
    },
  ]);

  assert.deepEqual(JSON.parse(JSON.stringify(context.listOpenCourses())), [
    {
      courseId: "open-1",
      title: "開放課程",
      date: "2026-12-01",
      startTime: "10:00",
      endTime: "12:00",
      location: "台北",
      mode: "實體",
      image: "https://example.com/course.png",
    },
  ]);
});

test("public doGet defaults to the page and safely forwards course preselection", () => {
  const context = loadWebApp([]);

  const page = context.doGet({ parameter: { courseId: "course-42" } });

  assert.equal(context.lastTemplateName, "Public");
  assert.equal(context.lastTemplate.initialCourseId, "course-42");
  assert.equal(page.title, "課程報名與查詢");
});

test("admin route checks server-side authorization before rendering", () => {
  const context = loadWebApp([]);

  const page = context.doGet({ parameter: { page: "admin" } });

  assert.equal(context.adminChecks, 1);
  assert.equal(context.lastTemplateName, "Admin");
  assert.equal(page.title, "課程報名管理");
});

test("the approved public APIs remain callable alongside explicit admin APIs", () => {
  const context = {};
  vm.createContext(context);
  for (const filename of fs
    .readdirSync(sourceDirectory)
    .filter((name) => name.endsWith(".gs"))) {
    const filePath = path.join(sourceDirectory, filename);
    vm.runInContext(fs.readFileSync(filePath, "utf8"), context, {
      filename,
    });
  }
  const callable = Object.keys(context)
    .filter((name) => typeof context[name] === "function" && !name.endsWith("_"))
    .sort();

  assert.deepEqual(callable, [
    "createAdminCourse",
    "decideAdminCancellation",
    "deleteAdminCourse",
    "doGet",
    "initializeWorkbook",
    "listAdminBookings",
    "listAdminCancellationRequests",
    "listAdminCourses",
    "listOpenCourses",
    "lookupBooking",
    "recoverAdminCancellationCreation",
    "requestCancellation",
    "setCourseRegistrationMode",
    "submitBooking",
    "updateAdminCourse",
  ]);
});

test("initializeWorkbook public entry requires an admin before touching the sheet", () => {
  const context = {};
  vm.createContext(context);
  for (const filename of fs
    .readdirSync(sourceDirectory)
    .filter((name) => name.endsWith(".gs"))) {
    vm.runInContext(
      fs.readFileSync(path.join(sourceDirectory, filename), "utf8"),
      context,
      { filename },
    );
  }
  let initialized = 0;
  context.requireAdmin_ = () => {
    throw new Error("Admin sign-in required");
  };
  context.initializeWorkbook_ = () => {
    initialized += 1;
  };

  assert.throws(() => context.initializeWorkbook(), /Admin sign-in required/);
  assert.equal(initialized, 0);
});

test("admin page supports booking inspection, cancellation decisions and course toggles safely", () => {
  const htmlPath = path.join(sourceDirectory, "Admin.html");
  const html = fs.readFileSync(htmlPath, "utf8");

  for (const id of [
    "booking-list",
    "cancellation-list",
    "course-list",
    "admin-status",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /listAdminBookings/);
  assert.match(html, /listAdminCancellationRequests/);
  assert.match(html, /decideAdminCancellation/);
  assert.match(html, /setCourseRegistrationMode/);
  assert.match(html, /needsRecovery/);
  assert.match(html, /recoverAdminCancellationCreation/);
  assert.match(html, /needsCreationRecovery/);
  assert.match(html, /pendingRecovery/);
  assert.match(html, /繼續完成/);
  assert.match(html, /\.textContent\s*=/);
  assert.doesNotMatch(html, /\.innerHTML\s*=/);
  assert.doesNotMatch(html, /deleteRow|deleteBooking|deleteRequest/i);
});

test("admin cancellation card keeps a manual-contact warning for FAILED notifications after refresh", async () => {
  const html = fs.readFileSync(path.join(sourceDirectory, "Admin.html"), "utf8");
  const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
  function element() {
    return {
      children: [],
      className: "",
      textContent: "",
      appendChild(child) { this.children.push(child); return child; },
      replaceChildren() { this.children = []; },
      addEventListener() {},
    };
  }
  const elements = {
    "admin-status": element(),
    "booking-list": element(),
    "cancellation-list": element(),
    "course-list": element(),
  };
  const request = {
    requestId: "r1",
    bookingId: "b1",
    status: "APPROVED",
    leaderName: "Lead",
    leaderEmail: "lead@example.com",
    notificationEmailStatus: "FAILED",
  };
  const responses = {
    listAdminBookings: [],
    listAdminCancellationRequests: [request],
    listAdminCourses: [],
  };
  const runner = { success() {}, failure() {} };
  const context = {
    document: {
      getElementById: (id) => elements[id],
      createElement: () => element(),
    },
    google: {
      script: {
        run: {
          withSuccessHandler(success) { runner.success = success; return this; },
          withFailureHandler(failure) { runner.failure = failure; return this; },
          listAdminBookings() { runner.success(responses.listAdminBookings); },
          listAdminCancellationRequests() { runner.success(responses.listAdminCancellationRequests); },
          listAdminCourses() { runner.success(responses.listAdminCourses); },
        },
      },
    },
    Promise,
  };
  vm.createContext(context);
  vm.runInContext(script, context, { filename: "Admin.html" });
  await new Promise((resolve) => setImmediate(resolve));

  const texts = [];
  (function collect(node) {
    texts.push(node.textContent);
    node.children.forEach(collect);
  })(elements["cancellation-list"]);
  assert.equal(elements["admin-status"].textContent, "資料已更新。");
  assert.ok(texts.some((text) => /通知寄送失敗/.test(text) && /手動聯絡團主/.test(text)));
});
