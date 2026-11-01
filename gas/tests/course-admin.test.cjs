const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const sourceDirectory = path.join(__dirname, "..", "src");

function createHarness({
  courses = [],
  outlines = [],
  pricing = [],
  bookings = [],
  auditLogs = [],
  authorized = true,
  failure = null,
  lockFailure = null,
} = {}) {
  const headersBySheet = {
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
    AuditLog: ["eventId", "actorEmail", "action", "recordId", "createdAt"],
    Participants: ["bookingId", "courseId", "courseDate", "name", "phone", "email", "lineName"],
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
  };
  const state = {
    reads: 0,
    writes: 0,
    acquired: 0,
    released: 0,
    failure: failure && { ...failure },
    lockFailure,
    uuid: 0,
    writeEvents: [],
  };
  const rowsFromObjects = (sheetName, records) =>
    records.map((record) =>
      headersBySheet[sheetName].map((header) => record[header] ?? ""),
    );
  const sheets = {};

  for (const [sheetName, records] of Object.entries({
    Courses: courses,
    CourseOutline: outlines,
    CoursePricing: pricing,
    Bookings: bookings,
    AuditLog: auditLogs,
    Participants: [],
    CancellationRequests: [],
  })) {
    const sheet = {
      rows: [headersBySheet[sheetName], ...rowsFromObjects(sheetName, records)],
      getLastRow() {
        state.reads += 1;
        for (let index = this.rows.length - 1; index >= 0; index -= 1) {
          if (this.rows[index].some((value) => String(value ?? "").trim() !== "")) {
            return index + 1;
          }
        }
        return 0;
      },
      getRange(row, column, rowCount = 1, columnCount = 1) {
        state.reads += 1;
        return {
          getValues: () =>
            Array.from({ length: rowCount }, (_, rowOffset) =>
              Array.from({ length: columnCount }, (_, columnOffset) =>
                this.rows[row - 1 + rowOffset]?.[column - 1 + columnOffset] ?? "",
              ),
            ),
          setValues: (values) => {
            state.writes += 1;
            state.writeEvents.push(sheetName);
            const shouldFail =
              state.failure && state.failure.write === state.writes;
            if (shouldFail && state.failure.when === "before") {
              throw new Error("Injected setValues failure");
            }
            values.forEach((value, rowOffset) => {
              const targetRow = row - 1 + rowOffset;
              this.rows[targetRow] ||= [];
              value.forEach((cell, columnOffset) => {
                this.rows[targetRow][column - 1 + columnOffset] = cell;
              });
            });
            if (shouldFail && state.failure.when === "after") {
              throw new Error("Injected setValues failure after write");
            }
          },
        };
      },
      deleteRow(row) {
        state.writes += 1;
        state.writeEvents.push(sheetName);
        const shouldFail =
          state.failure && state.failure.write === state.writes;
        if (shouldFail && state.failure.when === "before") {
          throw new Error("Injected deleteRow failure");
        }
        this.rows.splice(row - 1, 1);
        if (shouldFail && state.failure.when === "after") {
          throw new Error("Injected deleteRow failure after write");
        }
      },
    };
    sheets[sheetName] = sheet;
  }
  const spreadsheet = { getSheetByName: (name) => sheets[name] || null };
  const context = {
    FALLBACK_COURSES: [],
    SpreadsheetApp: {
      getActiveSpreadsheet: () => spreadsheet,
      openById: () => spreadsheet,
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (name) =>
          name === "ADMIN_EMAIL_ALLOWLIST"
            ? authorized
              ? "admin@example.com"
              : "someone-else@example.com"
            : "",
      }),
    },
    Session: {
      getActiveUser: () => ({ getEmail: () => "admin@example.com" }),
    },
    LockService: {
      getScriptLock: () => ({
        waitLock: (timeout) => {
          assert.equal(timeout, 30000);
          if (state.lockFailure) throw new Error(state.lockFailure);
          state.acquired += 1;
        },
        releaseLock: () => {
          state.released += 1;
        },
      }),
    },
    Utilities: {
      getUuid: () => `uuid-${++state.uuid}`,
      formatDate: (date, timeZone, format) => {
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
  for (const filename of [
    "Schema.gs",
    "SheetRepository.gs",
    "Domain.gs",
    "AdminService.gs",
  ]) {
    vm.runInContext(
      fs.readFileSync(path.join(sourceDirectory, filename), "utf8"),
      context,
      { filename },
    );
  }

  function records(sheetName) {
    const sheet = sheets[sheetName];
    return sheet.rows.slice(1).filter((row) =>
      row.some((value) => String(value ?? "").trim() !== ""),
    ).map((row) =>
      Object.fromEntries(
        headersBySheet[sheetName].map((header, index) => [header, row[index] ?? ""]),
      ),
    );
  }
  return { context, state, sheets, records };
}

function course(overrides = {}) {
  return {
    courseId: "course-1",
    title: "Course title",
    date: "2026-12-01",
    startTime: "09:30",
    endTime: "12:00",
    location: "Taipei",
    mode: "onsite",
    image: "https://example.com/course.png",
    description: "Course description",
    instructor: "Teacher",
    instructorBio: "Teacher bio",
    outline: ["Topic one", "Topic two"],
    pricing: [
      { label: "Standard", price: 1200 },
      { label: "Student", price: 800 },
    ],
    ...overrides,
  };
}

function assertLockReleased(harness) {
  assert.equal(harness.state.acquired, 1);
  assert.equal(harness.state.released, 1);
}

test("create writes editable fields, AUTO mode, and ordered course content", () => {
  const harness = createHarness();
  const result = harness.context.createAdminCourse(course());

  assert.equal(result.courseId, "course-1");
  assert.deepEqual(harness.records("Courses"), [
    {
      courseId: "course-1",
      title: "Course title",
      date: "2026-12-01",
      startTime: "09:30",
      endTime: "12:00",
      location: "Taipei",
      mode: "onsite",
      image: "https://example.com/course.png",
      manualRegistrationMode: "AUTO",
      description: "Course description",
      instructor: "Teacher",
      instructorBio: "Teacher bio",
    },
  ]);
  assert.deepEqual(harness.records("CourseOutline"), [
    { courseId: "course-1", sortOrder: 1, item: "Topic one" },
    { courseId: "course-1", sortOrder: 2, item: "Topic two" },
  ]);
  assert.deepEqual(harness.records("CoursePricing"), [
    { courseId: "course-1", sortOrder: 1, label: "Standard", price: 1200 },
    { courseId: "course-1", sortOrder: 2, label: "Student", price: 800 },
  ]);
  assert.deepEqual(harness.state.writeEvents, [
    "CourseOutline",
    "CoursePricing",
    "Courses",
  ]);
  assertLockReleased(harness);
});

test("create accepts custom IDs and retries without duplicating linked rows", () => {
  const harness = createHarness();
  const payload = course({ courseId: "custom-course" });

  assert.equal(harness.context.createAdminCourse(payload).courseId, "custom-course");
  harness.context.createAdminCourse(payload);

  assert.equal(harness.records("Courses").length, 1);
  assert.equal(harness.records("CourseOutline").length, 2);
  assert.equal(harness.records("CoursePricing").length, 2);
  assert.equal(harness.state.acquired, 2);
  assert.equal(harness.state.released, 2);
});

test("create rejects formula-prefixed course IDs before mutating sheets", () => {
  const harness = createHarness();

  assert.throws(
    () => harness.context.createAdminCourse(course({ courseId: "=course-1" })),
    /course.?id.*formula|formula.*course.?id/i,
  );
  assert.equal(harness.state.writes, 0);
  assert.equal(harness.records("Courses").length, 0);
  assert.equal(harness.records("CourseOutline").length, 0);
  assert.equal(harness.records("CoursePricing").length, 0);
  assertLockReleased(harness);
});

test("create preserves formula escaping and retries the same escaped course data", () => {
  const harness = createHarness();
  const payload = course({
    title: "=HYPERLINK(\"https://example.com\",\"title\")",
    description: "=1+1",
  });

  harness.context.createAdminCourse(payload);
  harness.context.createAdminCourse(payload);

  assert.equal(harness.records("Courses").length, 1);
  assert.equal(
    harness.records("Courses")[0].title,
    "'=HYPERLINK(\"https://example.com\",\"title\")",
  );
  assert.equal(harness.records("Courses")[0].description, "'=1+1");
});

test("create normalizes malformed optional text to empty strings", () => {
  const harness = createHarness();

  harness.context.createAdminCourse(
    course({ location: null, mode: {}, description: 42, instructorBio: false }),
  );

  const created = harness.records("Courses")[0];
  assert.equal(created.location, "");
  assert.equal(created.mode, "");
  assert.equal(created.description, "42");
  assert.equal(created.instructorBio, "false");
});

test("create rejects different base fields for an existing ID", () => {
  const harness = createHarness({ courses: [course()] });

  assert.throws(
    () => harness.context.createAdminCourse(course({ title: "Different" })),
    /duplicate|already exists/i,
  );
  assert.equal(harness.records("Courses")[0].title, "Course title");
  assert.equal(harness.state.writes, 0);
});

test("create validates required values, calendar date, time, URL, outline, and pricing before writes", () => {
  const invalidCases = [
    [{ courseId: " " }, /course.?id/i],
    [{ title: "" }, /title/i],
    [{ date: "" }, /date/i],
    [{ date: "2026-02-30" }, /date/i],
    [{ startTime: "" }, /startTime/i],
    [{ startTime: "24:00" }, /time/i],
    [{ endTime: "" }, /endTime/i],
    [{ endTime: "9:00" }, /time/i],
    [{ image: "not a URL" }, /image|url/i],
    [{ image: "https://example.com/path with space" }, /image|url/i],
    [{ image: "https://[1:2::3:]/image.png" }, /image|url/i],
    [{ image: "https://[1::2::3]/image.png" }, /image|url/i],
    [{ outline: ["   "] }, /outline/i],
    [{ outline: [1] }, /outline/i],
    [{ pricing: [{ label: " ", price: 1 }] }, /pricing|label/i],
    [{ pricing: [{ label: "Good", price: NaN }] }, /price/i],
    [{ pricing: [{ label: "Good", price: "1" }] }, /price/i],
    [{ pricing: [{ label: "Good", price: Infinity }] }, /price/i],
    [{ outline: "not an array" }, /outline/i],
    [{ pricing: "not an array" }, /pricing/i],
  ];

  for (const [overrides, error] of invalidCases) {
    const harness = createHarness();
    assert.throws(
      () => harness.context.createAdminCourse(course(overrides)),
      error,
    );
    assertLockReleased(harness);
    assert.equal(harness.state.writes, 0);
    assert.equal(harness.records("Courses").length, 0);
  }

  const invalidObjects = [null, [], "course"];
  for (const payload of invalidObjects) {
    const harness = createHarness();
    assert.throws(() => harness.context.createAdminCourse(payload), /object/i);
    assertLockReleased(harness);
    assert.equal(harness.state.writes, 0);
  }
});

test("create accepts valid compressed and uncompressed IPv6 image URLs", () => {
  for (const image of [
    "https://[2001:db8::1]/image.png",
    "http://[2001:0db8:0000:0000:0000:0000:0000:0001]/image.png",
  ]) {
    const harness = createHarness();
    harness.context.createAdminCourse(course({ image }));
    assert.equal(harness.records("Courses")[0].image, image);
  }
});

test("unauthorized mutations are rejected before repository reads or writes", () => {
  for (const action of [
    (context) => context.createAdminCourse(course()),
    (context) => context.updateAdminCourse("course-1", course()),
    (context) => context.deleteAdminCourse("course-1"),
  ]) {
    const harness = createHarness({ authorized: false });
    assert.throws(() => action(harness.context), /admin|access denied/i);
    assert.equal(harness.state.reads, 0);
    assert.equal(harness.state.writes, 0);
    assert.equal(harness.state.acquired, 0);
    assert.equal(harness.state.released, 0);
  }
});

test("listAdminCourses exposes only editable fields and sorted child content with pending recovery", () => {
  const harness = createHarness({
    courses: [course({ manualRegistrationMode: "CLOSED" })],
    outlines: [
      { courseId: "course-1", sortOrder: 2, item: "Second" },
      { courseId: "course-1", sortOrder: 1, item: "First" },
    ],
    pricing: [
      { courseId: "course-1", sortOrder: 2, label: "B", price: 20 },
      { courseId: "course-1", sortOrder: 1, label: "A", price: 10 },
    ],
    bookings: [{ bookingId: "private", courseId: "course-1", leaderEmail: "private@example.com" }],
    auditLogs: [{
      eventId: "intent",
      actorEmail: "admin@example.com",
      action: "COURSE_REGISTRATION_OPEN_INTENT",
      recordId: "course-1",
      createdAt: "now",
    }],
  });
  const listed = harness.context.listAdminCourses();

  assert.deepEqual(JSON.parse(JSON.stringify(listed)), [{
    courseId: "course-1",
    title: "Course title",
    date: "2026-12-01",
    startTime: "09:30",
    endTime: "12:00",
    location: "Taipei",
    mode: "onsite",
    image: "https://example.com/course.png",
    manualRegistrationMode: "CLOSED",
    description: "Course description",
    instructor: "Teacher",
    instructorBio: "Teacher bio",
    outline: ["First", "Second"],
    pricing: [
      { label: "A", price: 10 },
      { label: "B", price: 20 },
    ],
    pendingRecovery: { mode: "OPEN" },
  }]);
  assert.equal(JSON.stringify(listed).includes("private@example.com"), false);
  assert.equal(harness.state.acquired, 0);
});

test("update preserves ID and registration mode and replaces only selected course content", () => {
  const harness = createHarness({
    courses: [
      course({ manualRegistrationMode: "CLOSED" }),
      course({
        courseId: "course-2",
        title: "Other course",
        manualRegistrationMode: "AUTO",
      }),
    ],
    outlines: [
      { courseId: "course-1", sortOrder: 1, item: "Old" },
      { courseId: "course-2", sortOrder: 1, item: "Keep" },
    ],
    pricing: [{ courseId: "course-2", sortOrder: 1, label: "Keep", price: 2 }],
  });
  const payload = course({
    courseId: "attempted-change",
    manualRegistrationMode: "OPEN",
    title: "Updated",
    outline: ["New"],
    pricing: [{ label: "New price", price: 3 }],
  });

  harness.context.updateAdminCourse("course-1", payload);
  harness.context.updateAdminCourse("course-1", payload);

  assert.deepEqual(
    harness.records("Courses").map(({ courseId, title, manualRegistrationMode }) => ({
      courseId,
      title,
      manualRegistrationMode,
    })),
    [
      { courseId: "course-1", title: "Updated", manualRegistrationMode: "CLOSED" },
      { courseId: "course-2", title: "Other course", manualRegistrationMode: "AUTO" },
    ],
  );
  assert.deepEqual(harness.records("CourseOutline"), [
    { courseId: "course-2", sortOrder: 1, item: "Keep" },
    { courseId: "course-1", sortOrder: 1, item: "New" },
  ]);
  assert.deepEqual(harness.records("CoursePricing"), [
    { courseId: "course-2", sortOrder: 1, label: "Keep", price: 2 },
    { courseId: "course-1", sortOrder: 1, label: "New price", price: 3 },
  ]);
  assert.equal(harness.state.acquired, 2);
  assert.equal(harness.state.released, 2);
});

test("update moves every matching booking date across statuses without changing other fields", () => {
  const harness = createHarness({
    courses: [course(), course({ courseId: "other", title: "Other" })],
    bookings: [
      { bookingId: "one", courseId: "course-1", courseDate: "2026-12-01", status: "SUBMITTED", leaderName: "Keep" },
      { bookingId: "two", courseId: "course-1", courseDate: "2026-12-01", status: "CANCELLED", leaderName: "Keep too" },
      { bookingId: "three", courseId: "other", courseDate: "2026-12-01", status: "SUBMITTED" },
    ],
  });
  const payload = course({ date: "2027-01-03" });

  harness.context.updateAdminCourse("course-1", payload);
  harness.context.updateAdminCourse("course-1", payload);

  assert.deepEqual(
    harness.records("Bookings").map(({ bookingId, courseDate, status, leaderName }) => ({
      bookingId,
      courseDate,
      status,
      leaderName,
    })),
    [
      { bookingId: "one", courseDate: "2027-01-03", status: "SUBMITTED", leaderName: "Keep" },
      { bookingId: "two", courseDate: "2027-01-03", status: "CANCELLED", leaderName: "Keep too" },
      { bookingId: "three", courseDate: "2026-12-01", status: "SUBMITTED", leaderName: "" },
    ],
  );
  assert.equal(harness.state.acquired, 2);
  assert.equal(harness.state.released, 2);
});

test("update validates the full payload before changing bookings or course rows", () => {
  const harness = createHarness({
    courses: [course()],
    bookings: [
      { bookingId: "one", courseId: "course-1", courseDate: "2026-12-01", status: "SUBMITTED" },
    ],
  });

  assert.throws(
    () => harness.context.updateAdminCourse("course-1", course({ date: "2026-02-30" })),
    /date/i,
  );
  assert.equal(harness.records("Bookings")[0].courseDate, "2026-12-01");
  assert.equal(harness.records("Courses")[0].date, "2026-12-01");
  assert.equal(harness.state.writes, 0);
  assertLockReleased(harness);
});

test("update rejects a missing course and deletion is idempotent after full absence", () => {
  const harness = createHarness();
  assert.throws(
    () => harness.context.updateAdminCourse("missing", course()),
    /not found|missing/i,
  );
  assert.equal(harness.context.deleteAdminCourse("missing").courseId, "missing");
  assert.equal(harness.state.writes, 0);
});

test("delete refuses any booking status and preserves parent and child rows", () => {
  const harness = createHarness({
    courses: [course()],
    outlines: [{ courseId: "course-1", sortOrder: 1, item: "Topic" }],
    pricing: [{ courseId: "course-1", sortOrder: 1, label: "Fee", price: 10 }],
    bookings: [{ bookingId: "cancelled", courseId: "course-1", status: "CANCELLED" }],
  });

  assert.throws(() => harness.context.deleteAdminCourse("course-1"), /booking/i);
  assert.equal(harness.records("Courses").length, 1);
  assert.equal(harness.records("CourseOutline").length, 1);
  assert.equal(harness.records("CoursePricing").length, 1);
  assert.equal(harness.state.writes, 0);
});

test("delete removes only the target course and its children and is retryable", () => {
  const harness = createHarness({
    courses: [course(), course({ courseId: "other", title: "Other" })],
    outlines: [
      { courseId: "course-1", sortOrder: 1, item: "Topic" },
      { courseId: "other", sortOrder: 1, item: "Keep" },
    ],
    pricing: [{ courseId: "course-1", sortOrder: 1, label: "Fee", price: 10 }],
  });

  harness.context.deleteAdminCourse("course-1");
  harness.context.deleteAdminCourse("course-1");

  assert.deepEqual(harness.records("Courses").map((item) => item.courseId), ["other"]);
  assert.deepEqual(harness.records("CourseOutline").map((item) => item.courseId), ["other"]);
  assert.equal(harness.records("CoursePricing").length, 0);
});

test("delete retry cleans linked rows when its parent is already absent", () => {
  const harness = createHarness({
    outlines: [{ courseId: "course-1", sortOrder: 1, item: "Orphaned topic" }],
    pricing: [{ courseId: "course-1", sortOrder: 1, label: "Orphaned fee", price: 5 }],
  });

  harness.context.deleteAdminCourse("course-1");

  assert.equal(harness.records("CourseOutline").length, 0);
  assert.equal(harness.records("CoursePricing").length, 0);
  assert.equal(harness.state.acquired, 1);
  assert.equal(harness.state.released, 1);
});

test("mutating methods acquire and release exactly one lock even on errors", () => {
  const scenarios = [
    {
      harness: createHarness(),
      run: (harness) => harness.context.createAdminCourse(course({ date: "bad" })),
    },
    {
      harness: createHarness(),
      run: (harness) => harness.context.updateAdminCourse("missing", course()),
    },
    {
      harness: createHarness({
        bookings: [{ bookingId: "booking", courseId: "course-1", status: "CANCELLED" }],
      }),
      run: (harness) => harness.context.deleteAdminCourse("course-1"),
    },
  ];
  for (const scenario of scenarios) {
    assert.throws(() => scenario.run(scenario.harness));
    assertLockReleased(scenario.harness);
  }
});

test("lock wait failures include operation and course ID without repository access or release", () => {
  const scenarios = [
    {
      operation: "create",
      courseId: "create-id",
      run: (context) => context.createAdminCourse(course({ courseId: "create-id" })),
    },
    {
      operation: "update",
      courseId: "update-id",
      run: (context) => context.updateAdminCourse("update-id", course()),
    },
    {
      operation: "delete",
      courseId: "delete-id",
      run: (context) => context.deleteAdminCourse("delete-id"),
    },
  ];

  for (const scenario of scenarios) {
    const harness = createHarness({ lockFailure: "Lock wait timed out" });
    assert.throws(
      () => scenario.run(harness.context),
      (error) =>
        error.operation === scenario.operation &&
        error.courseId === scenario.courseId &&
        error.message.includes(scenario.operation) &&
        error.message.includes(scenario.courseId),
    );
    assert.equal(harness.state.reads, 0);
    assert.equal(harness.state.writes, 0);
    assert.equal(harness.state.acquired, 0);
    assert.equal(harness.state.released, 0);
  }
});

test("create recovers from failures before and after each sheet write without duplicates", () => {
  const payload = course();
  for (const when of ["before", "after"]) {
    for (let write = 1; write <= 3; write += 1) {
      const harness = createHarness({ failure: { write, when } });
      assert.throws(
        () => harness.context.createAdminCourse(payload),
        /create.*course-1|course-1.*create/i,
      );
      harness.context.createAdminCourse(payload);
      assert.equal(harness.records("Courses").length, 1);
      assert.equal(harness.records("CourseOutline").length, 2);
      assert.equal(harness.records("CoursePricing").length, 2);
      assert.equal(harness.state.acquired, 2);
      assert.equal(harness.state.released, 2);
    }
  }
});

test("update recovers from failures before and after linked-content, booking, and course writes", () => {
  const original = course();
  const payload = course({ date: "2027-01-03", title: "Updated", outline: ["New"] });
  for (const when of ["before", "after"]) {
    for (let write = 1; write <= 7; write += 1) {
      const harness = createHarness({
        courses: [original],
        outlines: [{ courseId: "course-1", sortOrder: 1, item: "Old" }],
        pricing: [{ courseId: "course-1", sortOrder: 1, label: "Old", price: 1 }],
        bookings: [
          { bookingId: "one", courseId: "course-1", courseDate: "2026-12-01", status: "CANCELLED" },
          { bookingId: "two", courseId: "course-1", courseDate: "2026-12-01", status: "SUBMITTED" },
        ],
        failure: { write, when },
      });
      assert.throws(
        () => harness.context.updateAdminCourse("course-1", payload),
        /update.*course-1|course-1.*update/i,
      );
      harness.context.updateAdminCourse("course-1", payload);
      assert.equal(harness.records("Bookings").every((item) => item.courseDate === payload.date), true);
      assert.deepEqual(harness.records("CourseOutline").filter((item) => item.courseId === "course-1").map((item) => item.item), ["New"]);
      assert.equal(harness.records("Courses")[0].title, "Updated");
      assert.equal(harness.state.acquired, 2);
      assert.equal(harness.state.released, 2);
    }
  }
});

test("delete recovers from failures before and after child and parent deletes", () => {
  for (const when of ["before", "after"]) {
    for (let write = 1; write <= 5; write += 1) {
      const harness = createHarness({
        courses: [course()],
        outlines: [
          { courseId: "course-1", sortOrder: 1, item: "A" },
          { courseId: "course-1", sortOrder: 2, item: "B" },
        ],
        pricing: [
          { courseId: "course-1", sortOrder: 1, label: "A", price: 1 },
          { courseId: "course-1", sortOrder: 2, label: "B", price: 2 },
        ],
        failure: { write, when },
      });
      assert.throws(
        () => harness.context.deleteAdminCourse("course-1"),
        /delete.*course-1|course-1.*delete/i,
      );
      harness.context.deleteAdminCourse("course-1");
      assert.equal(harness.records("Courses").length, 0);
      assert.equal(harness.records("CourseOutline").length, 0);
      assert.equal(harness.records("CoursePricing").length, 0);
      assert.equal(harness.state.acquired, 2);
      assert.equal(harness.state.released, 2);
    }
  }
});
