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
    "description",
    "instructor",
    "instructorBio",
  ],
  CourseOutline: ["courseId", "sortOrder", "item"],
  CoursePricing: ["courseId", "sortOrder", "label", "price"],
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
    deleteRow(row) {
      this.rows.splice(row - 1, 1);
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

test("initialization extends the old Courses schema without changing existing rows", () => {
  const existingCourse = [
    "course-1",
    "Existing course",
    "2026-11-17",
    "09:00",
    "12:00",
    "Taipei",
    "onsite",
    "course-image",
    "AUTO",
  ];
  const oldCoursesHeader = expectedHeaders.Courses.slice(0, 9);
  const courses = createSheet("Courses", [
    oldCoursesHeader,
    existingCourse.slice(),
  ]);
  const { context, sheets } = loadRepository({
    sheets: { Courses: courses },
  });

  context.initializeWorkbook_();
  context.initializeWorkbook_();

  assert.deepEqual(
    JSON.parse(JSON.stringify(courses.rows[0])),
    expectedHeaders.Courses,
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(courses.rows[1])),
    existingCourse,
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(sheets.CourseOutline.rows[0])),
    expectedHeaders.CourseOutline,
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(sheets.CoursePricing.rows[0])),
    expectedHeaders.CoursePricing,
  );
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
        description: "JSON-only description",
        instructor: "",
        instructorBio: "",
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
        description: "",
        instructor: "",
        instructorBio: "",
      },
    ],
  );
});

test("a missing Bookings sheet is a configuration error, not an empty result", () => {
  const { context } = loadRepository();

  assert.throws(
    () => context.getBookings_(),
    (error) =>
      error.name === "ConfigurationError" &&
      error.code === "REQUIRED_SHEET_MISSING" &&
      /Bookings/.test(error.message),
  );
});

test("missing required record sheets are configuration errors", () => {
  for (const [sheetName, getterName] of [
    ["Bookings", "getBookings_"],
    ["Participants", "getParticipants_"],
    ["CancellationRequests", "getCancellationRequests_"],
  ]) {
    const { context } = loadRepository();

    assert.throws(
      () => context[getterName](),
      (error) =>
        error.name === "ConfigurationError" &&
        error.code === "REQUIRED_SHEET_MISSING" &&
        error.message.includes(sheetName),
    );
  }
});

test("an existing empty required record sheet returns an empty result", () => {
  const { context } = loadRepository({
    sheets: {
      Bookings: createSheet("Bookings", [expectedHeaders.Bookings]),
    },
  });

  assert.deepEqual(JSON.parse(JSON.stringify(context.getBookings_())), []);
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
        description: "",
        instructor: "",
        instructorBio: "",
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

test("repository writes strings beginning with equals as literal sheet values", () => {
  const { context, sheets } = loadRepository();
  context.initializeWorkbook_();

  context.insertBooking_({
    bookingId: "b1",
    lookupCode: "l1",
    courseId: "c1",
    courseDate: "2099-12-01",
    leaderName: "=IMPORTXML(\"https://example.invalid\", \"//title\")",
    leaderPhone: "0912345678",
    leaderEmail: "leader@example.com",
    status: "PROCESSING",
    createdAt: "now",
    confirmationEmailStatus: "PENDING",
  });
  context.updateBooking_("b1", { leaderName: "=SUM(1, 1)" });
  context.insertCancellationRequest_({
    requestId: "r1",
    bookingId: "b1",
    reason: "=HYPERLINK(\"https://example.invalid\")",
    status: "PENDING",
    requestedAt: "now",
    reviewedBy: "",
    reviewedAt: "",
    notificationEmailStatus: "PENDING",
  });

  assert.equal(sheets.Bookings.rows[1][4], "'=SUM(1, 1)");
  assert.equal(
    sheets.CancellationRequests.rows[1][2],
    "'=HYPERLINK(\"https://example.invalid\")",
  );
});

test("course-mode and audit repository helpers operate only on their declared records", () => {
  const { context, sheets } = loadRepository({
    sheets: {
      Courses: createSheet("Courses", [
        expectedHeaders.Courses,
        ["course-1", "Course", "2099-12-01", "", "", "", "", "", "AUTO"],
      ]),
      AuditLog: createSheet("AuditLog", [expectedHeaders.AuditLog]),
    },
  });

  context.updateCourse_("course-1", { manualRegistrationMode: "CLOSED" });
  context.insertAuditLog_({
    eventId: "event-1",
    actorEmail: "admin@example.com",
    action: "COURSE_REGISTRATION_CLOSED",
    recordId: "course-1",
    createdAt: "2099-01-01T00:00:00.000Z",
  });

  assert.equal(sheets.Courses.rows[1][8], "CLOSED");
  assert.deepEqual(JSON.parse(JSON.stringify(context.getAuditLogs_())), [
    {
      eventId: "event-1",
      actorEmail: "admin@example.com",
      action: "COURSE_REGISTRATION_CLOSED",
      recordId: "course-1",
      createdAt: "2099-01-01T00:00:00.000Z",
    },
  ]);
  assert.ok(
    ["updateCourse_", "insertAuditLog_", "getAuditLogs_"].every((name) =>
      name.endsWith("_"),
    ),
  );
});

test("audit compensation deletes only the attempted event and is idempotent", () => {
  const { context, sheets } = loadRepository({
    sheets: {
      AuditLog: createSheet("AuditLog", [
        expectedHeaders.AuditLog,
        [
          "event-1",
          "admin@example.com",
          "CANCELLATION_APPROVED",
          "request-1",
          "time-1",
        ],
        [
          "event-2",
          "admin@example.com",
          "COURSE_REGISTRATION_CLOSED",
          "course-1",
          "time-2",
        ],
      ]),
    },
  });

  assert.equal(context.deleteAuditLog_("event-1"), true);
  assert.equal(context.deleteAuditLog_("event-1"), false);
  assert.deepEqual(JSON.parse(JSON.stringify(sheets.AuditLog.rows)), [
    expectedHeaders.AuditLog,
    [
      "event-2",
      "admin@example.com",
      "COURSE_REGISTRATION_CLOSED",
      "course-1",
      "time-2",
    ],
  ]);
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
