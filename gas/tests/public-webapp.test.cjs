const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const sourceDirectory = path.join(__dirname, "..", "src");

// Live HtmlService/google.script.run acceptance remains pending; GAS deployment credentials are unavailable here.
function loadWebApp(courses) {
  const context = {
    adminChecks: 0,
    requireAdmin_: () => {
      context.adminChecks++;
      return "admin@example.com";
    },
    getCourses_: () => structuredClone(courses),
    getCourseAvailability_: (date, now, manualMode) =>
      date > "2026-11-01" && manualMode !== "CLOSED" ? "OPEN" : "CLOSED",
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
    "decideAdminCancellation",
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
