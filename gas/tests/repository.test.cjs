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
              const targetRow = row - 1 + rowOffset;
              this.rows[targetRow] ||= [];
              value.forEach((cell, columnOffset) => {
                this.rows[targetRow][column - 1 + columnOffset] = cell;
              });
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
  const insertedSheetNames = [];
  const spreadsheet = {
    getSheetByName(name) {
      if (spreadsheetError) throw spreadsheetError;
      return sheets[name] || null;
    },
    insertSheet(name) {
      const sheet = createSheet(name);
      sheets[name] = sheet;
      insertedSheetNames.push(name);
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
  return { context, sheets, insertedSheetNames };
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

test("initialization creates missing content sheets only once", () => {
  const { context, sheets, insertedSheetNames } = loadRepository();

  context.initializeWorkbook_();
  const outlineSheet = sheets.CourseOutline;
  const pricingSheet = sheets.CoursePricing;
  context.initializeWorkbook_();

  assert.equal(insertedSheetNames.filter((name) => name === "CourseOutline").length, 1);
  assert.equal(insertedSheetNames.filter((name) => name === "CoursePricing").length, 1);
  assert.equal(sheets.CourseOutline, outlineSheet);
  assert.equal(sheets.CoursePricing, pricingSheet);
});

test("initialization rejects reordered Courses headers without changing rows", () => {
  const rows = [
    expectedHeaders.Courses.slice().reverse(),
    ["course-1", "Existing course", "2026-11-17"],
  ];
  const original = JSON.parse(JSON.stringify(rows));
  const courses = createSheet("Courses", rows);
  const { context } = loadRepository({ sheets: { Courses: courses } });

  assert.throws(() => context.initializeWorkbook_(), /Courses.*header/i);
  assert.deepEqual(JSON.parse(JSON.stringify(courses.rows)), original);
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

test("initialization seeds blank course details and ordered outline and pricing rows", () => {
  const fallback = [
    {
      id: "fallback-course",
      title: "Fallback title",
      description: "Fallback description",
      instructor: "Fallback instructor",
      instructorBio: ["Bio line one", "Bio line two"],
      outline: ["Outline first", "Outline second"],
      pricing: [
        { label: "Standard", price: 2500 },
        { label: "Early bird", price: 2000 },
      ],
    },
  ];
  const courses = createSheet("Courses", [
    expectedHeaders.Courses,
    [
      "fallback-course",
      "Sheet title",
      "2026-11-17",
      "09:00",
      "12:00",
      "Sheet location",
      "In person",
      "",
      "",
      "",
      "",
      "",
    ],
  ]);
  const { context, sheets } = loadRepository({ sheets: { Courses: courses }, fallback });

  context.initializeWorkbook_();
  context.initializeWorkbook_();

  assert.equal(courses.rows[1][1], "Sheet title");
  assert.equal(courses.rows[1][2], "2026-11-17");
  assert.equal(courses.rows[1][5], "Sheet location");
  assert.equal(courses.rows[1][9], "Fallback description");
  assert.equal(courses.rows[1][10], "Fallback instructor");
  assert.equal(courses.rows[1][11], "Bio line one\nBio line two");
  assert.deepEqual(
    JSON.parse(JSON.stringify(sheets.CourseOutline.rows.slice(1))),
    [
      ["fallback-course", 1, "Outline first"],
      ["fallback-course", 2, "Outline second"],
    ],
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(sheets.CoursePricing.rows.slice(1))),
    [
      ["fallback-course", 1, "Standard", 2500],
      ["fallback-course", 2, "Early bird", 2000],
    ],
  );
});

test("initialization preserves existing non-empty details and content rows", () => {
  const fallback = [
    {
      courseId: "course-1",
      title: "Fallback title",
      description: "Fallback description",
      instructor: "Fallback instructor",
      instructorBio: "Fallback bio",
      outline: ["Fallback outline"],
      pricing: [{ label: "Fallback price", price: 99 }],
    },
  ];
  const courses = createSheet("Courses", [
    expectedHeaders.Courses,
    [
      "course-1",
      "Existing title",
      "2026-11-17",
      "09:00",
      "12:00",
      "Existing location",
      "In person",
      "",
      "OPEN",
      "Existing description",
      "Existing instructor",
      "Existing bio",
    ],
  ]);
  const existingOutline = ["course-1", 1, "Edited outline"];
  const existingPricing = ["course-1", 1, "Edited price", 123];
  const { context, sheets } = loadRepository({
    sheets: {
      Courses: courses,
      CourseOutline: createSheet("CourseOutline", [
        expectedHeaders.CourseOutline,
        existingOutline.slice(),
      ]),
      CoursePricing: createSheet("CoursePricing", [
        expectedHeaders.CoursePricing,
        existingPricing.slice(),
      ]),
    },
    fallback,
  });

  context.initializeWorkbook_();

  assert.equal(courses.rows[1][1], "Existing title");
  assert.equal(courses.rows[1][5], "Existing location");
  assert.equal(courses.rows[1][8], "OPEN");
  assert.equal(courses.rows[1][9], "Existing description");
  assert.equal(courses.rows[1][10], "Existing instructor");
  assert.equal(courses.rows[1][11], "Existing bio");
  assert.deepEqual(JSON.parse(JSON.stringify(sheets.CourseOutline.rows[1])), existingOutline);
  assert.deepEqual(JSON.parse(JSON.stringify(sheets.CoursePricing.rows[1])), existingPricing);
  assert.equal(sheets.CourseOutline.rows.length, 2);
  assert.equal(sheets.CoursePricing.rows.length, 2);
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

test("getCourses returns content fields and keeps registration normalization", () => {
  const { context } = loadRepository({
    sheets: {
      Courses: createSheet("Courses", [
        expectedHeaders.Courses,
        [
          "sheet-course",
          "Sheet course",
          "2026-11-17",
          "13:30",
          "16:30",
          "Hall",
          "In person",
          "image",
          "",
          "Description",
          "Instructor",
          "Instructor biography",
        ],
      ]),
    },
  });

  const [course] = context.getCourses_();
  assert.equal(course.description, "Description");
  assert.equal(course.instructor, "Instructor");
  assert.equal(course.instructorBio, "Instructor biography");
  assert.equal(course.manualRegistrationMode, "AUTO");
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

test("replaceSheetRecordsByValue_ replaces only matching course rows and appends replacements in order", () => {
  const { context, sheets } = loadRepository({
    sheets: {
      CourseOutline: createSheet("CourseOutline", [
        expectedHeaders.CourseOutline,
        ["course-1", 1, "Old first item"],
        ["course-2", 1, "Other course item"],
        ["course-1", 2, "Old second item"],
      ]),
    },
  });
  const replacements = [
    { courseId: "course-1", sortOrder: 1, item: "New first item" },
    { courseId: "course-1", sortOrder: 2, item: "New second item" },
  ];

  context.replaceSheetRecordsByValue_(
    "CourseOutline",
    "courseId",
    "course-1",
    replacements,
  );

  assert.deepEqual(JSON.parse(JSON.stringify(sheets.CourseOutline.rows)), [
    expectedHeaders.CourseOutline,
    ["course-2", 1, "Other course item"],
    ["course-1", 1, "New first item"],
    ["course-1", 2, "New second item"],
  ]);
});

test("updateSheetRecordsByValue_ updates all matching rows and a retry completes partial updates", () => {
  const sheet = createSheet("Participants", [
    expectedHeaders.Participants,
    ["b1", "course-1", "2026-12-01", "First", "0911111111", "first@example.com", ""],
    ["b1", "course-1", "2026-12-01", "Second", "0922222222", "second@example.com", ""],
    ["b2", "course-2", "2026-12-01", "Other", "0933333333", "other@example.com", ""],
  ]);
  const originalGetRange = sheet.getRange.bind(sheet);
  let shouldFail = true;
  sheet.getRange = (row, column, rowCount, columnCount) => {
    const range = originalGetRange(row, column, rowCount, columnCount);
    const setValues = range.setValues;
    range.setValues = (values) => {
      if (shouldFail && row === 3 && column === 3) {
        shouldFail = false;
        throw new Error("Injected participant update failure");
      }
      setValues(values);
    };
    return range;
  };
  const { context } = loadRepository({ sheets: { Participants: sheet } });

  assert.throws(
    () =>
      context.updateSheetRecordsByValue_(
        "Participants",
        "courseId",
        "course-1",
        { courseDate: "2027-01-03" },
      ),
    /Injected participant update failure/,
  );
  assert.equal(sheet.rows[1][2], "2027-01-03");
  assert.equal(sheet.rows[2][2], "2026-12-01");

  assert.equal(
    context.updateSheetRecordsByValue_(
      "Participants",
      "courseId",
      "course-1",
      { courseDate: "2027-01-03" },
    ),
    2,
  );
  assert.deepEqual(JSON.parse(JSON.stringify(sheet.rows)), [
    expectedHeaders.Participants,
    ["b1", "course-1", "2027-01-03", "First", "0911111111", "first@example.com", ""],
    ["b1", "course-1", "2027-01-03", "Second", "0922222222", "second@example.com", ""],
    ["b2", "course-2", "2026-12-01", "Other", "0933333333", "other@example.com", ""],
  ]);
});

test("deleteSheetRecordsByValue_ deletes every exact match and repeated deletes preserve other IDs", () => {
  const { context, sheets } = loadRepository({
    sheets: {
      CoursePricing: createSheet("CoursePricing", [
        expectedHeaders.CoursePricing,
        ["course-1", 1, "First", 10],
        ["course-2", 1, "Other course", 20],
        ["course-1", 2, "Second", 30],
        ["course-3", 1, "Another course", 40],
        ["course-1-extra", 1, "Different ID", 50],
      ]),
    },
  });

  assert.equal(
    context.deleteSheetRecordsByValue_(
      "CoursePricing",
      "courseId",
      "course-1",
    ),
    2,
  );
  assert.deepEqual(JSON.parse(JSON.stringify(sheets.CoursePricing.rows)), [
    expectedHeaders.CoursePricing,
    ["course-2", 1, "Other course", 20],
    ["course-3", 1, "Another course", 40],
    ["course-1-extra", 1, "Different ID", 50],
  ]);

  assert.equal(
    context.deleteSheetRecordsByValue_(
      "CoursePricing",
      "courseId",
      "course-1",
    ),
    0,
  );
  assert.deepEqual(JSON.parse(JSON.stringify(sheets.CoursePricing.rows)), [
    expectedHeaders.CoursePricing,
    ["course-2", 1, "Other course", 20],
    ["course-3", 1, "Another course", 40],
    ["course-1-extra", 1, "Different ID", 50],
  ]);
});

test("sheet row helpers reject unknown sheets and keys before changing rows", () => {
  const { context, sheets } = loadRepository({
    sheets: {
      CourseOutline: createSheet("CourseOutline", [
        expectedHeaders.CourseOutline,
        ["course-1", 1, "Existing item"],
      ]),
    },
  });
  const originalRows = JSON.parse(JSON.stringify(sheets.CourseOutline.rows));

  assert.throws(
    () => context.deleteSheetRecordsByValue_("UnknownSheet", "courseId", "course-1"),
    /UnknownSheet/,
  );
  assert.throws(
    () => context.deleteSheetRecordsByValue_("CourseOutline", "notAField", "course-1"),
    /notAField/,
  );
  assert.throws(
    () => context.replaceSheetRecordsByValue_("UnknownSheet", "courseId", "course-1", []),
    /UnknownSheet/,
  );
  assert.throws(
    () => context.replaceSheetRecordsByValue_("CourseOutline", "notAField", "course-1", []),
    /notAField/,
  );
  assert.deepEqual(JSON.parse(JSON.stringify(sheets.CourseOutline.rows)), originalRows);
});

test("replaceSheetRecordsByValue_ validates replacement records before deleting matches", () => {
  const { context, sheets } = loadRepository({
    sheets: {
      CourseOutline: createSheet("CourseOutline", [
        expectedHeaders.CourseOutline,
        ["course-1", 1, "Existing item"],
        ["course-2", 1, "Other course item"],
      ]),
    },
  });
  const originalRows = JSON.parse(JSON.stringify(sheets.CourseOutline.rows));

  assert.throws(
    () =>
      context.replaceSheetRecordsByValue_(
        "CourseOutline",
        "courseId",
        "course-1",
        {},
      ),
    /array/,
  );
  assert.throws(
    () =>
      context.replaceSheetRecordsByValue_(
        "CourseOutline",
        "courseId",
        "course-1",
        [{ courseId: "course-2", sortOrder: 2, item: "Wrong course" }],
      ),
    /courseId/,
  );
  assert.deepEqual(JSON.parse(JSON.stringify(sheets.CourseOutline.rows)), originalRows);
});

test("replaceSheetRecordsByValue_ with an empty array deletes matches without a zero-row append", () => {
  const sheet = createSheet("CourseOutline", [
    expectedHeaders.CourseOutline,
    ["course-1", 1, "Old item"],
    ["course-2", 1, "Other course item"],
  ]);
  const getRange = sheet.getRange.bind(sheet);
  let zeroRowWrites = 0;
  sheet.getRange = (row, column, rowCount = 1, columnCount = 1) => {
    const range = getRange(row, column, rowCount, columnCount);
    if (rowCount === 0) {
      return {
        ...range,
        setValues: () => {
          zeroRowWrites += 1;
          throw new Error("zero-row range");
        },
      };
    }
    return range;
  };
  const { context } = loadRepository({ sheets: { CourseOutline: sheet } });

  context.replaceSheetRecordsByValue_("CourseOutline", "courseId", "course-1", []);

  assert.equal(zeroRowWrites, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(sheet.rows)), [
    expectedHeaders.CourseOutline,
    ["course-2", 1, "Other course item"],
  ]);
});

test("replaceSheetRecordsByValue_ keeps old rows when append fails and a retry leaves only desired rows", () => {
  const sheet = createSheet("CourseOutline", [
    expectedHeaders.CourseOutline,
    ["course-1", 1, "Old item"],
    ["course-2", 1, "Other course item"],
  ]);
  const setValuesFailure = new Error("simulated append failure");
  let failNextAppend = true;
  const getRange = sheet.getRange.bind(sheet);
  sheet.getRange = (row, column, rowCount = 1, columnCount = 1) => {
    const range = getRange(row, column, rowCount, columnCount);
    if (row <= 3 || rowCount < 2 || !failNextAppend) return range;
    return {
      ...range,
      setValues: (values) => {
        failNextAppend = false;
        range.setValues(values.slice(0, 1));
        throw setValuesFailure;
      },
    };
  };
  const { context } = loadRepository({ sheets: { CourseOutline: sheet } });
  const replacements = [
    { courseId: "course-1", sortOrder: 1, item: "New first item" },
    { courseId: "course-1", sortOrder: 2, item: "New second item" },
  ];

  assert.throws(
    () =>
      context.replaceSheetRecordsByValue_("CourseOutline", "courseId", "course-1", replacements),
    (error) => error === setValuesFailure,
  );
  assert.ok(
    sheet.rows.some((row) => row[0] === "course-1" && row[2] === "Old item"),
  );

  context.replaceSheetRecordsByValue_("CourseOutline", "courseId", "course-1", replacements);

  assert.deepEqual(JSON.parse(JSON.stringify(sheet.rows)), [
    expectedHeaders.CourseOutline,
    ["course-2", 1, "Other course item"],
    ["course-1", 1, "New first item"],
    ["course-1", 2, "New second item"],
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
