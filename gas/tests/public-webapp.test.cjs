const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const sourceDirectory = path.join(__dirname, "..", "src");

// Live HtmlService/google.script.run acceptance remains pending; GAS deployment credentials are unavailable here.
function loadWebApp(courses) {
  const context = {
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

test("only the approved public APIs and doGet are globally callable", () => {
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
    "doGet",
    "listOpenCourses",
    "lookupBooking",
    "requestCancellation",
    "submitBooking",
  ]);
});
