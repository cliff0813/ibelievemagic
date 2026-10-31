const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const expectedHeaders = {
  Courses: [
    "courseId",
    "title",
    "date",
    "startTime",
    "endTime",
    "location",
    "mode",
    "image",
    "manualRegistrationMode",
  ],
  Bookings: [
    "bookingId",
    "lookupCode",
    "courseId",
    "courseDate",
    "leaderName",
    "leaderPhone",
    "leaderEmail",
    "status",
    "createdAt",
    "confirmationEmailStatus",
  ],
  Participants: [
    "bookingId",
    "courseId",
    "courseDate",
    "name",
    "phone",
    "email",
    "lineName",
  ],
  CancellationRequests: [
    "requestId",
    "bookingId",
    "reason",
    "status",
    "requestedAt",
    "reviewedBy",
    "reviewedAt",
    "notificationEmailStatus",
  ],
  AuditLog: ["eventId", "actorEmail", "action", "recordId", "createdAt"],
};

function createSheet(name, rows = []) {
  return {
    name,
    rows,
    getLastRow() {
      for (let index = this.rows.length - 1; index >= 0; index -= 1) {
        if (this.rows[index].some((value) => String(value ?? "").trim() !== "")) return index + 1;
      }
      return 0;
    },
    getLastColumn() {
      let last = 0;
      for (const row of this.rows) {
        row.forEach((value, index) => {
          if (String(value ?? "").trim() !== "") last = Math.max(last, index + 1);
        });
      }
      return last;
    },
    getRange(row, column, rowCount = 1, columnCount = 1) {
      return {
        getValues: () =>
          Array.from({ length: rowCount }, (_, rowOffset) =>
            Array.from({ length: columnCount }, (_, columnOffset) =>
              this.rows[row - 1 + rowOffset]?.[column - 1 + columnOffset] ?? "",
            ),
          ),
        setValues: (values) => {
          values.forEach((value, rowOffset) => {
            this.rows[row - 1 + rowOffset] = value.slice();
          });
        },
      };
    },
  };
}

function loadRepository({ sheets = {}, spreadsheetError, fallback = [] } = {}) {
  const spreadsheet = {
    getSheetByName(name) {
      if (spreadsheetError) throw spreadsheetError;
      return sheets[name] || null;
    },
    insertSheet(name) {
      const sheet = createSheet(name);
      sheets[name] = sheet;
      return sheet;
    },
  };
  const context = {
    FALLBACK_COURSES: fallback,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => spreadsheet,
    },
    Utilities: {
      formatDate(date, timeZone, format) {
        assert.equal(timeZone, "Asia/Taipei");
        assert.equal(format, "yyyy-MM-dd");
        const parts = new Intl.DateTimeFormat("en-CA", {
          timeZone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).formatToParts(date);
        const part = (type) => parts.find((item) => item.type === type).value;
        return `${part("year")}-${part("month")}-${part("day")}`;
      },
    },
  };
  vm.createContext(context);

  for (const filename of ["Schema.gs", "SheetRepository.gs"]) {
    const filePath = path.join(__dirname, "..", "src", filename);
    if (fs.existsSync(filePath)) {
      vm.runInContext(fs.readFileSync(filePath, "utf8"), context, { filename });
    }
  }
  return { context, sheets };
}

test("initialization creates missing sheets with the shared schema headers", () => {
  const { context, sheets } = loadRepository();

  assert.equal(typeof context.initializeWorkbook_, "function");
  context.initializeWorkbook_();

  for (const [name, headers] of Object.entries(expectedHeaders)) {
    assert.deepEqual(JSON.parse(JSON.stringify(sheets[name].rows[0])), headers);
  }
});

test("initialization imports fallback courses only once", () => {
  const fallback = [
    { id: "fallback-course", title: "Fallback", date: "2026-11-17" },
  ];
  const { context, sheets } = loadRepository({ fallback });

  context.initializeWorkbook_();
  context.initializeWorkbook_();

  assert.equal(sheets.Courses.rows.length, 2);
  assert.equal(sheets.Courses.rows[1][0], "fallback-course");
  assert.equal(sheets.Courses.rows[1][1], "Fallback");
  assert.equal(sheets.Courses.rows[1][8], "AUTO");
});

test("an empty Courses sheet returns fallback courses in the canonical schema", () => {
  const fallback = [
    {
      id: "fallback-course",
      title: "Fallback",
      date: "2026-11-17",
      image: "fallback-image",
      description: "JSON-only description",
    },
  ];
  const { context } = loadRepository({
    sheets: {
      Courses: createSheet("Courses", [
        expectedHeaders.Courses,
        ["", "incomplete row"],
      ]),
    },
    fallback,
  });

  assert.deepEqual(
    JSON.parse(JSON.stringify(context.getCourses_())),
    [
      {
        courseId: "fallback-course",
        title: "Fallback",
        date: "2026-11-17",
        startTime: "",
        endTime: "",
        location: "",
        mode: "",
        image: "fallback-image",
        manualRegistrationMode: "AUTO",
      },
    ],
  );
});

test("a missing Courses sheet returns fallback courses in the canonical schema", () => {
  const { context } = loadRepository({
    fallback: [{ id: "fallback-course", title: "Fallback", date: "2026-11-17" }],
  });

  assert.deepEqual(
    JSON.parse(JSON.stringify(context.getCourses_())),
    [
      {
        courseId: "fallback-course",
        title: "Fallback",
        date: "2026-11-17",
        startTime: "",
        endTime: "",
        location: "",
        mode: "",
        image: "",
        manualRegistrationMode: "AUTO",
      },
    ],
  );
});

test("usable Courses rows are returned without adding fallback courses", () => {
  const fallback = [{ id: "fallback-course" }];
  const { context } = loadRepository({
    sheets: {
      Courses: createSheet("Courses", [
        expectedHeaders.Courses,
        ["sheet-course", "Sheet course", "2026-11-17", "13:30", "16:30", "Hall", "In person", "image", "AUTO"],
      ]),
    },
    fallback,
  });

  assert.deepEqual(
    JSON.parse(JSON.stringify(context.getCourses_())),
    [
      {
        courseId: "sheet-course",
        title: "Sheet course",
        date: "2026-11-17",
        startTime: "13:30",
        endTime: "16:30",
        location: "Hall",
        mode: "In person",
        image: "image",
        manualRegistrationMode: "AUTO",
      },
    ],
  );
});

test("blank manual registration mode defaults to AUTO and valid values are preserved", () => {
  const { context } = loadRepository({
    sheets: {
      Courses: createSheet("Courses", [
        expectedHeaders.Courses,
        ["blank-mode", "Blank mode", "2026-11-17", "", "", "", "", "", ""],
        ["open-mode", "Open mode", "2026-11-17", "", "", "", "", "", "OPEN"],
        [
          "closed-mode",
          "Closed mode",
          "2026-11-17",
          "",
          "",
          "",
          "",
          "",
          "CLOSED",
        ],
      ]),
    },
  });

  assert.deepEqual(
    context.getCourses_().map((course) => course.manualRegistrationMode),
    ["AUTO", "OPEN", "CLOSED"],
  );
});

test("a usable sheet course with unknown manual mode throws a course-data error", () => {
  const { context } = loadRepository({
    sheets: {
      Courses: createSheet("Courses", [
        expectedHeaders.Courses,
        [
          "invalid-mode",
          "Invalid mode",
          "2026-11-17",
          "13:30",
          "16:30",
          "Hall",
          "In person",
          "",
          "SOMETHING_ELSE",
        ],
      ]),
    },
    fallback: [{ id: "fallback-course", title: "Fallback" }],
  });

  assert.throws(
    () => context.getCourses_(),
    (error) =>
      error.name === "CourseDataError" &&
      error.code === "INVALID_MANUAL_REGISTRATION_MODE" &&
      /invalid-mode/.test(error.message),
  );
});

test("Google Sheets date cells are formatted in the Taiwan time zone", () => {
  const { context } = loadRepository({
    sheets: {
      Courses: createSheet("Courses", [
        expectedHeaders.Courses,
        [
          "sheet-course",
          "Sheet course",
          new Date("2026-11-16T16:00:00.000Z"),
          "13:30",
          "16:30",
          "Hall",
          "In person",
          "",
          "",
        ],
      ]),
    },
  });

  assert.equal(context.getCourses_()[0].date, "2026-11-17");
});

test("Spreadsheet service errors propagate instead of returning fallback", () => {
  const serviceError = new Error("Spreadsheet unavailable");
  const { context } = loadRepository({
    spreadsheetError: serviceError,
    fallback: [{ id: "fallback-course" }],
  });

  assert.throws(() => context.getCourses_(), (error) => error === serviceError);
});

test("initialization adds headers to a truly blank existing sheet", () => {
  const sheets = { Bookings: createSheet("Bookings", [["", ""]]) };
  const { context } = loadRepository({ sheets });

  context.initializeWorkbook_();

  assert.deepEqual(
    JSON.parse(JSON.stringify(sheets.Bookings.rows[0])),
    expectedHeaders.Bookings,
  );
});

test("initialization leaves exact existing headers and rows intact", () => {
  const rows = [expectedHeaders.Bookings.slice(), ["b1", "L1"]];
  const sheets = { Bookings: createSheet("Bookings", rows) };
  const { context } = loadRepository({ sheets });

  context.initializeWorkbook_();

  assert.deepEqual(JSON.parse(JSON.stringify(sheets.Bookings.rows)), [
    expectedHeaders.Bookings,
    ["b1", "L1"],
  ]);
});

test("initialization rejects data beyond the schema when its header is blank", () => {
  const rows = [
    expectedHeaders.Bookings.slice(),
    ["b1", "L1", "", "", "", "", "", "", "", "", "unexpected"],
  ];
  const sheets = Object.fromEntries(
    Object.keys(expectedHeaders).map((name) => [name, createSheet(name)]),
  );
  sheets.Bookings = createSheet("Bookings", rows);
  const original = Object.fromEntries(
    Object.entries(sheets).map(([name, sheet]) => [
      name,
      JSON.parse(JSON.stringify(sheet.rows)),
    ]),
  );
  const { context } = loadRepository({ sheets });

  assert.throws(() => context.initializeWorkbook_(), /Bookings.*header/i);
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(sheets).map(([name, sheet]) => [name, sheet.rows]),
    ),
    original,
  );
});

test("initialization rejects data beneath a blank header beyond the Bookings schema", () => {
  const rows = [
    [...expectedHeaders.Bookings, ""],
    [...Array(expectedHeaders.Bookings.length).fill(""), "unexpected"],
  ];
  const original = JSON.parse(JSON.stringify(rows));
  const sheets = { Bookings: createSheet("Bookings", rows) };
  const { context } = loadRepository({ sheets });

  assert.throws(() => context.initializeWorkbook_(), /Bookings.*header/i);
  assert.deepEqual(JSON.parse(JSON.stringify(sheets.Bookings.rows)), original);
});

for (const [label, header] of [
  ["missing", ["b1", "L1", "c1"]],
  ["mismatched", ["bookingId", "wrong", "courseId"]],
  ["reordered", expectedHeaders.Bookings.slice().reverse()],
]) {
  test(`initialization rejects a ${label} header without changing rows`, () => {
    const rows = [header.slice(), ["data", "row"]];
    const original = JSON.parse(JSON.stringify(rows));
    const sheets = { Bookings: createSheet("Bookings", rows) };
    const { context } = loadRepository({ sheets });

    assert.throws(() => context.initializeWorkbook_(), /Bookings.*header/i);
    assert.deepEqual(JSON.parse(JSON.stringify(sheets.Bookings.rows)), original);
  });
}

for (const [label, rows] of [
  ["blank header row with data below", [["", "", ""], ["b1", "L1", "c1"]]],
  [
    "extra header column",
    [[...expectedHeaders.Bookings, "extra"], ["b1", "L1", "c1"]],
  ],
]) {
  test(`initialization rejects ${label} without changing cells`, () => {
    const original = JSON.parse(JSON.stringify(rows));
    const sheets = { Bookings: createSheet("Bookings", rows) };
    const { context } = loadRepository({ sheets });

    assert.throws(() => context.initializeWorkbook_(), /Bookings.*header/i);
    assert.deepEqual(JSON.parse(JSON.stringify(sheets.Bookings.rows)), original);
  });
}
