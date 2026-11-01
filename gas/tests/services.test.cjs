const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const sourceDirectory = path.join(__dirname, "..", "src");

function createHarness({
  bookings = [],
  participants = [],
  cancellationRequests = [],
  course = {
    courseId: "course-1",
    title: "Test course",
    date: "2099-12-01",
    manualRegistrationMode: "AUTO",
  },
  failParticipantWrite = false,
  failConfirmationStatusWrite = false,
  failCancellationStatusUpdate = false,
  failMailer = false,
  failCache = false,
  activeUserEmail = "admin@example.com",
  activeUserUnavailable = false,
  adminAllowlist = " Admin@Example.com ",
  failNotificationStatusWrite = false,
  failCancellationDecisionUpdate = false,
  failAuditAppendActions = [],
  failAuditAppendNoWriteActions = [],
  failCancellationFinalizeUpdate = false, // "before" | "after" the write lands
  failCourseUpdateOnce = false,
  failAdminBookingRollback = false,
  now = 0,
} = {}) {
  let shouldFailCancellationDecisionUpdate = failCancellationDecisionUpdate;
  const auditActionsToFail = [...failAuditAppendActions];
  const auditNoWriteActionsToFail = [...failAuditAppendNoWriteActions];
  let shouldFailCancellationFinalize = failCancellationFinalizeUpdate;
  let shouldFailCourseUpdate = failCourseUpdateOnce;
  const state = {
    bookings: structuredClone(bookings),
    participants: structuredClone(participants),
    cancellationRequests: structuredClone(cancellationRequests),
    course: structuredClone(course),
    auditLogs: [],
    repositoryReads: 0,
    repositoryWrites: 0,
    cache: new Map(),
    cacheKeys: [],
    lockAcquired: 0,
    lockReleased: 0,
    mail: [],
    uuidCalls: 0,
    now,
  };
  class FakeDate extends Date {
    static now() {
      return state.now;
    }
  }
  const context = {
    Date: FakeDate,
    getCourses_: () => {
      state.repositoryReads++;
      return [structuredClone(state.course)];
    },
    getBookings_: () => {
      state.repositoryReads++;
      return state.bookings;
    },
    getParticipants_: () =>
      (state.repositoryReads++,
      state.participants.map((participant) => ({
        ...participant,
        bookingStatus: state.bookings.find(
          (booking) => booking.bookingId === participant.bookingId,
        )?.status,
      }))),
    getCancellationRequests_: () => {
      state.repositoryReads++;
      return state.cancellationRequests;
    },
    insertBooking_: (booking) => {
      state.repositoryWrites++;
      state.bookings.push(structuredClone(booking));
    },
    insertParticipants_: (newParticipants) => {
      state.repositoryWrites++;
      if (failParticipantWrite) throw new Error("Participant persistence failed");
      state.participants.push(...structuredClone(newParticipants));
    },
    updateBooking_: (bookingId, updates) => {
      state.repositoryWrites++;
      if (
        failAdminBookingRollback &&
        updates.status === "CANCELLATION_PENDING"
      ) {
        throw new Error("Booking rollback failed");
      }
      if (
        failConfirmationStatusWrite &&
        Object.hasOwn(updates, "confirmationEmailStatus")
      ) {
        throw new Error("Confirmation status persistence failed");
      }
      if (
        failCancellationStatusUpdate &&
        updates.status === "CANCELLATION_PENDING"
      ) {
        throw new Error("Booking status persistence failed");
      }
      const booking = state.bookings.find((item) => item.bookingId === bookingId);
      if (!booking) throw new Error("Booking not found");
      Object.assign(booking, structuredClone(updates));
    },
    updateCancellationRequest_: (requestId, updates) => {
      state.repositoryWrites++;
      if (
        shouldFailCancellationFinalize === "before" &&
        (updates.status === "APPROVED" || updates.status === "REJECTED")
      ) {
        shouldFailCancellationFinalize = false;
        throw new Error("Cancellation finalize update failed");
      }
      if (
        failNotificationStatusWrite &&
        Object.hasOwn(updates, "notificationEmailStatus") &&
        updates.notificationEmailStatus !== "PENDING"
      ) {
        throw new Error("Notification status persistence failed");
      }
      const request = state.cancellationRequests.find(
        (item) => item.requestId === requestId,
      );
      if (!request) throw new Error("Cancellation request not found");
      Object.assign(request, structuredClone(updates));
      if (
        shouldFailCancellationDecisionUpdate &&
        Object.hasOwn(updates, "reviewedBy")
      ) {
        shouldFailCancellationDecisionUpdate = false;
        throw new Error("Cancellation decision request update failed");
      }
      if (
        shouldFailCancellationFinalize === "after" &&
        (updates.status === "APPROVED" || updates.status === "REJECTED")
      ) {
        shouldFailCancellationFinalize = false;
        throw new Error("Cancellation finalize update failed");
      }
    },
    insertCancellationRequest_: (request) => {
      state.repositoryWrites++;
      state.cancellationRequests.push(structuredClone(request));
    },
    updateCourse_: (courseId, updates) => {
      state.repositoryWrites++;
      if (shouldFailCourseUpdate) {
        shouldFailCourseUpdate = false;
        throw new Error("Course update failed");
      }
      if (state.course.courseId !== courseId) throw new Error("Course not found");
      Object.assign(state.course, structuredClone(updates));
    },
    getAuditLogs_: () => {
      state.repositoryReads++;
      return state.auditLogs;
    },
    insertAuditLog_: (entry) => {
      state.repositoryWrites++;
      const noWriteIndex = auditNoWriteActionsToFail.indexOf(entry.action);
      if (noWriteIndex >= 0) {
        auditNoWriteActionsToFail.splice(noWriteIndex, 1);
        throw new Error("Audit append failed");
      }
      state.auditLogs.push(structuredClone(entry));
      const failureIndex = auditActionsToFail.indexOf(entry.action);
      if (failureIndex >= 0) {
        auditActionsToFail.splice(failureIndex, 1);
        throw new Error("Audit append failed");
      }
    },
    deleteAuditLog_: (eventId) => {
      state.repositoryWrites++;
      const index = state.auditLogs.findIndex(
        (entry) => entry.eventId === eventId,
      );
      if (index >= 0) state.auditLogs.splice(index, 1);
    },
    Session: {
      getActiveUser: () => ({
        getEmail: () => {
          if (activeUserUnavailable) throw new Error("Identity unavailable");
          return activeUserEmail;
        },
      }),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (name) => {
          assert.equal(name, "ADMIN_EMAIL_ALLOWLIST");
          return adminAllowlist;
        },
      }),
    },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => state.lockAcquired++,
        releaseLock: () => state.lockReleased++,
      }),
    },
    Utilities: {
      getUuid: () => `uuid-${++state.uuidCalls}`,
    },
    MailApp: {
      sendEmail: (message) => {
        state.mail.push(message);
        state.lockReleasedAtMail = state.lockReleased;
        if (state.onMail) state.onMail(message);
        if (failMailer) throw new Error("Mail delivery failed");
      },
    },
    CacheService: {
      getScriptCache: () => {
        if (failCache) throw new Error("ScriptCache unavailable");
        return {
          get: (key) => {
            state.cacheKeys.push(key);
            return state.cache.get(key) ?? null;
          },
          put: (key, value, expirationSeconds) => {
            state.cacheKeys.push(key);
            state.cache.set(key, value);
            state.cacheExpirationSeconds = expirationSeconds;
          },
        };
      },
    },
    Utilities: {
      getUuid: () => `uuid-${++state.uuidCalls}`,
      DigestAlgorithm: { SHA_256: "SHA_256" },
      computeDigest: (algorithm, value) => {
        assert.equal(algorithm, "SHA_256");
        return [...crypto.createHash("sha256").update(value).digest()].map(
          (byte) => (byte > 127 ? byte - 256 : byte),
        );
      },
      base64EncodeWebSafe: (bytes) =>
        Buffer.from(bytes.map((byte) => (byte < 0 ? byte + 256 : byte)))
          .toString("base64")
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/g, ""),
    },
  };
  vm.createContext(context);
  for (const filename of [
    "Domain.gs",
    "RegistrationService.gs",
    "AdminService.gs",
  ]) {
    const filePath = path.join(sourceDirectory, filename);
    if (fs.existsSync(filePath)) {
      vm.runInContext(fs.readFileSync(filePath, "utf8"), context, { filename });
    }
  }
  return { context, state };
}

function validPayload(overrides = {}) {
  return {
    courseId: "course-1",
    courseDate: "2099-12-01",
    registrationType: "INDIVIDUAL",
    leaderName: "王小明",
    leaderPhone: "0912-345-678",
    leaderEmail: "leader@example.com",
    consentAccepted: true,
    participants: [
      {
        name: "王小明",
        phone: "0912-345-678",
        email: "leader@example.com",
        lineName: "xiaoming",
      },
    ],
    ...overrides,
  };
}

function uniqueCoursePayload(index, leaderEmail = "leader@example.com") {
  const courseId = `course-${index}`;
  const phone = `0912345${String(index).padStart(3, "0")}`;
  return validPayload({
    courseId,
    leaderEmail,
    leaderPhone: phone,
    participants: [
      {
        name: `Leader ${index}`,
        phone,
        email: `participant-${index}@example.com`,
        lineName: `leader-${index}`,
      },
    ],
  });
}

function seedBooking(status, overrides = {}) {
  return {
    bookingId: `existing-${status}`,
    lookupCode: "existing-code",
    courseId: "course-1",
    courseDate: "2099-12-01",
    leaderName: "Existing leader",
    leaderPhone: "0987-654-321",
    leaderEmail: "existing@example.com",
    status,
    createdAt: "2099-01-01T00:00:00.000Z",
    confirmationEmailStatus: "SENT",
    ...overrides,
  };
}

test("報名成功時寫入一筆 Booking 與所有 Participants", () => {
  const { context, state } = createHarness();

  const result = context.submitBooking(validPayload());

  assert.equal(state.bookings.length, 1);
  assert.equal(state.bookings[0].status, "SUBMITTED");
  assert.equal(state.bookings[0].bookingId, "uuid-1");
  assert.equal(state.bookings[0].lookupCode, "uuid-2");
  assert.equal(state.participants.length, 1);
  assert.equal(state.participants[0].bookingId, "uuid-1");
  assert.equal(result.lookupCode, "uuid-2");
  assert.equal("bookingId" in result, false);
  assert.equal(result.confirmationEmailStatus, "SENT");
  assert.equal(state.lockReleasedAtMail, 1);
  assert.equal(state.lockAcquired, 2);
  assert.equal(state.lockReleased, 2);
});

test("報名時同課程日期已有電話或 Email 重複就拒絕", () => {
  for (const contact of [
    { phone: "0912345678", email: "different@example.com" },
    { phone: "0900000000", email: "LEADER@example.com" },
  ]) {
    const booking = seedBooking("SUBMITTED");
    const { context } = createHarness({
      bookings: [booking],
      participants: [
        {
          bookingId: booking.bookingId,
          courseId: booking.courseId,
          courseDate: booking.courseDate,
          name: "Existing participant",
          ...contact,
        },
      ],
    });

    assert.throws(
      () => context.submitBooking(validPayload()),
      /duplicate|already registered|重複/i,
    );
  }
});

test("取消待審核仍視為重複但已核准取消可重新報名", () => {
  const pending = seedBooking("CANCELLATION_PENDING");
  const pendingHarness = createHarness({
    bookings: [pending],
    participants: [
      {
        bookingId: pending.bookingId,
        courseId: pending.courseId,
        courseDate: pending.courseDate,
        name: "Existing participant",
        phone: "0912345678",
        email: "different@example.com",
      },
    ],
  });
  assert.throws(
    () => pendingHarness.context.submitBooking(validPayload()),
    /duplicate|already registered|重複/i,
  );

  const cancelled = seedBooking("CANCELLED");
  const cancelledHarness = createHarness({
    bookings: [cancelled],
    participants: [
      {
        bookingId: cancelled.bookingId,
        courseId: cancelled.courseId,
        courseDate: cancelled.courseDate,
        name: "Existing participant",
        phone: "0912345678",
        email: "different@example.com",
      },
    ],
  });
  assert.equal(
    cancelledHarness.context.submitBooking(validPayload()).confirmationEmailStatus,
    "SENT",
  );
});

test("報名允許同一團體成員共用聯絡方式", () => {
  const { context, state } = createHarness();
  const sharedContact = {
    phone: "0912-345-678",
    email: "same@example.com",
  };

  context.submitBooking(
    validPayload({
      registrationType: "GROUP",
      participants: [
        { name: "成員甲", ...sharedContact },
        { name: "成員乙", ...sharedContact },
        { name: "成員丙", ...sharedContact },
      ],
    }),
  );

  assert.equal(state.participants.length, 3);
});

test("報名拒絕少於三人的團體", () => {
  const { context, state } = createHarness();
  const result = context.submitBooking(
    validPayload({
      registrationType: "GROUP",
      participants: [
        { name: "成員甲", phone: "0912345678", email: "a@example.com" },
        { name: "成員乙", phone: "0912345679", email: "b@example.com" },
      ],
    }),
  );
  assert.equal(result.success, false);
  assert.ok(result.errors.includes("GROUP_REQUIRES_THREE_PARTICIPANTS"));
  assert.equal(state.bookings.length, 0);
});

test("報名缺少個資同意時回傳驗證錯誤且不寫入資料", () => {
  const { context, state } = createHarness();

  const result = context.submitBooking(
    validPayload({ consentAccepted: false }),
  );

  assert.equal(result.success, false);
  assert.ok(result.errors.includes("CONSENT_REQUIRED"));
  assert.equal(state.bookings.length, 0);
  assert.equal(state.participants.length, 0);
});

test("查詢代碼錯誤與團長電話錯誤回傳相同的查無報名結果", () => {
  const booking = seedBooking("SUBMITTED");
  const { context, state } = createHarness({
    bookings: [booking],
    participants: [
      {
        bookingId: booking.bookingId,
        courseId: booking.courseId,
        courseDate: booking.courseDate,
        name: "Existing participant",
        phone: "0912345678",
        email: "participant@example.com",
      },
    ],
  });

  const wrongCode = context.lookupBooking("wrong-code", "0987 654 321");
  const wrongPhone = context.lookupBooking("existing-code", "0000-000-000");
  assert.deepEqual(JSON.parse(JSON.stringify(wrongCode)), JSON.parse(JSON.stringify(wrongPhone)));
  assert.deepEqual(JSON.parse(JSON.stringify(wrongCode)), {
    found: false,
    message: "booking not found",
  });

  const found = context.lookupBooking("existing-code", "0987 654 321");
  assert.equal(found.found, true);
  assert.deepEqual(Object.keys(found.booking).sort(), [
    "courseDate",
    "courseId",
    "leaderName",
    "status",
  ]);
  assert.deepEqual(Object.keys(found.participants[0]).sort(), ["name", "phone"]);
  assert.equal(state.lockReleased, 0);
});

test("取消申請建立 PENDING 記錄並將報名改為 CANCELLATION_PENDING", () => {
  const booking = seedBooking("SUBMITTED");
  const { context, state } = createHarness({ bookings: [booking] });

  const result = context.requestCancellation(
    "existing-code",
    "0987 654 321",
    "無法參加",
  );

  assert.equal(result.status, "CANCELLATION_PENDING");
  assert.equal(state.bookings[0].status, "CANCELLATION_PENDING");
  assert.equal(state.cancellationRequests.length, 1);
  assert.equal(state.cancellationRequests[0].status, "PENDING");
  assert.equal(state.cancellationRequests[0].reason, "無法參加");
  assert.equal(state.lockReleased, 1);
});

test("取消原因可省略、為 null 或空白，並以空字串儲存", () => {
  for (const reason of [undefined, null, "   "]) {
    const booking = seedBooking("SUBMITTED");
    const { context, state } = createHarness({ bookings: [booking] });
    const args = ["existing-code", "0987 654 321"];
    if (reason !== undefined) args.push(reason);

    const result = context.requestCancellation(...args);

    assert.equal(result.success, true);
    assert.equal(state.cancellationRequests[0].reason, "");
  }
});

test("取消原因拒絕非字串且非 null 的值", () => {
  const booking = seedBooking("SUBMITTED");
  const { context, state } = createHarness({ bookings: [booking] });

  assert.throws(
    () => context.requestCancellation("existing-code", "0987654321", 42),
    /reason.*string/i,
  );
  assert.equal(state.cancellationRequests.length, 0);
});

test("取消申請拒絕已取消報名及已有待審核申請的報名", () => {
  for (const status of ["CANCELLED", "CANCELLATION_PENDING", "SUBMITTED"]) {
    const booking = seedBooking(status);
    const requests =
      status !== "CANCELLED"
        ? [{ requestId: "request-1", bookingId: booking.bookingId, status: "PENDING" }]
        : [];
    const { context, state } = createHarness({
      bookings: [booking],
      cancellationRequests: requests,
    });

    assert.throws(
      () =>
        context.requestCancellation(
          "existing-code",
          "0987654321",
          "無法參加",
        ),
      /cancel|pending|取消|待審核/i,
    );
    assert.equal(state.lockReleased, 1);
    assert.equal(state.cancellationRequests.length, requests.length);
  }
});

test("取消狀態寫入失敗時保留報名並將取消申請標記 FAILED", () => {
  const booking = seedBooking("SUBMITTED");
  const { context, state } = createHarness({
    bookings: [booking],
    failCancellationStatusUpdate: true,
  });

  assert.throws(
    () =>
      context.requestCancellation(
        "existing-code",
        "0987 654 321",
        "無法參加",
      ),
    /Cancellation persistence failed/,
  );
  assert.equal(state.bookings[0].status, "SUBMITTED");
  assert.equal(state.cancellationRequests.length, 1);
  assert.equal(state.cancellationRequests[0].status, "FAILED");
  assert.equal(state.lockReleased, 1);
});

test("報名資料寫入失敗時標記 FAILED、回報錯誤並釋放鎖", () => {
  const { context, state } = createHarness({ failParticipantWrite: true });

  assert.throws(
    () => context.submitBooking(validPayload()),
    /Participant persistence failed/,
  );
  assert.equal(state.bookings.length, 1);
  assert.equal(state.bookings[0].status, "FAILED");
  assert.equal(state.lockReleased, 1);
});

test("確認信失敗不回滾報名並回傳可複製代碼及信件狀態", () => {
  const { context, state } = createHarness({ failMailer: true });

  const result = context.submitBooking(validPayload());

  assert.equal(state.bookings[0].status, "SUBMITTED");
  assert.equal(state.bookings[0].confirmationEmailStatus, "FAILED");
  assert.equal(result.lookupCode, state.bookings[0].lookupCode);
  assert.equal(result.confirmationEmailStatus, "FAILED");
});

test("同一正規化團主 Email 每小時最多寄三封確認信", () => {
  const { context, state } = createHarness();
  const results = [];

  for (let index = 1; index <= 4; index += 1) {
    state.course = {
      ...state.course,
      courseId: `course-${index}`,
    };
    const email =
      index === 1 ? "leader@example.com" : "  LEADER@EXAMPLE.COM  ";
    results.push(context.submitBooking(uniqueCoursePayload(index, email)));
  }

  assert.deepEqual(
    results.map((result) => result.confirmationEmailStatus),
    ["SENT", "SENT", "SENT", "RATE_LIMITED"],
  );
  assert.equal(state.mail.length, 3);
  assert.equal(state.bookings.length, 4);
  assert.equal(state.bookings[3].status, "SUBMITTED");
  assert.equal(state.bookings[3].confirmationEmailStatus, "RATE_LIMITED");
  assert.equal(results[3].success, true);
  assert.equal(results[3].lookupCode, state.bookings[3].lookupCode);
  assert.match(results[3].message, /rate limit|copy|save/i);
  const normalizedEmailHash = crypto
    .createHash("sha256")
    .update("leader@example.com")
    .digest("base64url");
  assert.deepEqual(
    [...new Set(state.cacheKeys)],
    [`confirmation-email:${normalizedEmailHash}`],
  );
  assert.ok(state.cacheKeys.every((key) => !key.includes("leader@example.com")));
  assert.equal(state.cacheExpirationSeconds, 3600);
});

test("確認信限流只計入滾動一小時內的寄送嘗試", () => {
  const { context, state } = createHarness();
  const results = [];

  for (let index = 1; index <= 3; index += 1) {
    state.course = {
      ...state.course,
      courseId: `course-${index}`,
    };
    results.push(
      context.submitBooking(uniqueCoursePayload(index, "leader@example.com")),
    );
  }

  state.now += 60 * 60 * 1000 + 1;
  state.course = {
    ...state.course,
    courseId: "course-4",
  };
  results.push(
    context.submitBooking(uniqueCoursePayload(4, "leader@example.com")),
  );

  assert.deepEqual(
    results.map((result) => result.confirmationEmailStatus),
    ["SENT", "SENT", "SENT", "SENT"],
  );
  assert.equal(state.mail.length, 4);
});

test("ScriptCache failure fails closed without undoing the booking or hiding its code", () => {
  const { context, state } = createHarness({ failCache: true });

  const result = context.submitBooking(validPayload());

  assert.equal(state.mail.length, 0);
  assert.equal(state.bookings[0].status, "SUBMITTED");
  assert.equal(state.bookings[0].confirmationEmailStatus, "RATE_LIMIT_UNAVAILABLE");
  assert.equal(result.success, true);
  assert.equal(result.confirmationEmailStatus, "RATE_LIMIT_UNAVAILABLE");
  assert.equal(result.lookupCode, state.bookings[0].lookupCode);
  assert.match(result.message, /rate limit.*unavailable|email.*not sent/i);
  assert.equal(state.lockAcquired, 1);
  assert.equal(state.lockReleased, 1);
});

test("取消可在寄信期間交錯執行，確認信狀態更新不覆寫取消狀態", () => {
  const { context, state } = createHarness();
  state.onMail = () =>
    context.requestCancellation("uuid-2", "0912345678", "行程變更");

  const result = context.submitBooking(validPayload());

  assert.equal(result.confirmationEmailStatus, "SENT");
  assert.equal(state.lockReleasedAtMail, 1);
  assert.equal(state.cancellationRequests.length, 1);
  assert.equal(state.bookings[0].status, "CANCELLATION_PENDING");
  assert.equal(state.bookings[0].confirmationEmailStatus, "SENT");
  assert.equal(state.lockAcquired, 3);
  assert.equal(state.lockReleased, 3);
});

test("報名確認信狀態寫入失敗時保留 SUBMITTED 並回傳明確警告", () => {
  const { context, state } = createHarness({
    failConfirmationStatusWrite: true,
  });

  const result = context.submitBooking(validPayload());

  assert.equal(state.bookings[0].status, "SUBMITTED");
  assert.equal(result.success, true);
  assert.equal(result.lookupCode, state.bookings[0].lookupCode);
  assert.equal(result.confirmationEmailStatus, "SENT");
  assert.equal(result.confirmationEmailStatusRecorded, false);
  assert.match(result.message, /confirmation email status could not be recorded/i);
  assert.equal(state.lockAcquired, 2);
  assert.equal(state.lockReleased, 2);
});

function seedCancellation(status = "PENDING") {
  const booking = seedBooking("CANCELLATION_PENDING", {
    bookingId: "booking-admin-1",
    leaderEmail: "leader@example.com",
  });
  return {
    booking,
    request: {
      requestId: "request-admin-1",
      bookingId: booking.bookingId,
      reason: "行程變更",
      status,
      requestedAt: "2099-01-02T00:00:00.000Z",
      reviewedBy: "",
      reviewedAt: "",
      notificationEmailStatus: "PENDING",
    },
  };
}

test("白名單管理員可以讀取管理名單", () => {
  const { booking, request } = seedCancellation();
  const { context } = createHarness({
    bookings: [booking],
    cancellationRequests: [request],
  });

  const bookings = context.listAdminBookings();
  const requests = context.listAdminCancellationRequests();

  assert.equal(bookings.length, 1);
  assert.equal(bookings[0].bookingId, booking.bookingId);
  assert.equal("lookupCode" in bookings[0], false);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].requestId, request.requestId);
});

test("非白名單、空白及無法取得登入 Email 時拒絕且不讀寫資料", () => {
  for (const identity of [
    { activeUserEmail: "intruder@example.com" },
    { activeUserEmail: "  " },
    { activeUserEmail: "" },
    { activeUserUnavailable: true },
  ]) {
    const { booking, request } = seedCancellation();
    const { context, state } = createHarness({
      bookings: [booking],
      cancellationRequests: [request],
      ...identity,
    });

    assert.throws(
      () => context.listAdminCancellationRequests(),
      /admin.*(denied|required|unavailable)|identity/i,
    );
    assert.equal(state.repositoryReads, 0);
    assert.equal(state.repositoryWrites, 0);
    assert.equal(state.mail.length, 0);
  }
});

test("每個管理 API 入口都在任何 repository 讀寫前驗證身分", () => {
  const { booking, request } = seedCancellation();
  const { context, state } = createHarness({
    bookings: [booking],
    cancellationRequests: [request],
    activeUserEmail: "not-allowed@example.com",
  });

  for (const call of [
    () => context.listAdminBookings(),
    () => context.listAdminCancellationRequests(),
    () => context.listAdminCourses(),
    () => context.decideAdminCancellation(request.requestId, "APPROVED"),
    () => context.setCourseRegistrationMode("course-1", "CLOSED"),
  ]) {
    assert.throws(call, /admin/i);
    assert.equal(state.repositoryReads, 0);
    assert.equal(state.repositoryWrites, 0);
  }
});

test("核准與拒絕僅更新報名狀態、保留記錄並持久化通知與稽核結果", () => {
  for (const [decision, bookingStatus, notificationStatus] of [
    ["APPROVED", "CANCELLED", "SENT"],
    ["REJECTED", "SUBMITTED", "FAILED"],
  ]) {
    const { booking, request } = seedCancellation();
    const { context, state } = createHarness({
      bookings: [booking],
      cancellationRequests: [request],
      failMailer: notificationStatus === "FAILED",
    });

    const result = context.decideAdminCancellation(request.requestId, decision);

    assert.equal(result.success, true);
    assert.equal(result.status, decision);
    assert.equal(result.notificationEmailStatus, notificationStatus);
    assert.equal(state.bookings[0].status, bookingStatus);
    assert.equal(state.cancellationRequests[0].status, decision);
    assert.equal(
      state.cancellationRequests[0].notificationEmailStatus,
      notificationStatus,
    );
    assert.equal(state.cancellationRequests[0].reviewedBy, "admin@example.com");
    assert.ok(state.cancellationRequests[0].reviewedAt);
    assert.equal(state.auditLogs.length, 1);
    assert.equal(state.auditLogs[0].actorEmail, "admin@example.com");
    assert.equal(state.auditLogs[0].action, `CANCELLATION_${decision}`);
    assert.equal(state.auditLogs[0].recordId, request.requestId);
    assert.ok(state.auditLogs[0].createdAt);
    assert.deepEqual(
      Object.keys(state.auditLogs[0]).sort(),
      ["action", "actorEmail", "createdAt", "eventId", "recordId"].sort(),
    );
    assert.equal(state.bookings.length, 1);
    assert.equal(state.cancellationRequests.length, 1);
    assert.equal(state.mail.length, 1);
    assert.equal(state.mail[0].to, booking.leaderEmail);
    if (notificationStatus === "FAILED") {
      const followUp = context.listAdminCancellationRequests();
      assert.equal(followUp.length, 1);
      assert.equal(followUp[0].notificationEmailStatus, "FAILED");
      assert.equal(followUp[0].leaderEmail, booking.leaderEmail);
    }
  }
});

test("非 PENDING 取消申請不能被決定且不改變報名或留下稽核", () => {
  const { booking, request } = seedCancellation("APPROVED");
  const { context, state } = createHarness({
    bookings: [booking],
    cancellationRequests: [request],
  });

  assert.throws(
    () => context.decideAdminCancellation(request.requestId, "REJECTED"),
    /pending/i,
  );
  assert.equal(state.bookings[0].status, "CANCELLATION_PENDING");
  assert.equal(state.cancellationRequests[0].status, "APPROVED");
  assert.equal(state.auditLogs.length, 0);
  assert.equal(state.mail.length, 0);
});

function finalAudits(state) {
  return state.auditLogs.filter((entry) => !entry.action.endsWith("_INTENT"));
}

test("取消決定意圖寫入後回報錯誤時保留可恢復意圖，同決定可續行且不同決定被拒", () => {
  const { booking, request } = seedCancellation();
  const { context, state } = createHarness({
    bookings: [booking],
    cancellationRequests: [request],
    failCancellationDecisionUpdate: true,
  });

  assert.throws(
    () => context.decideAdminCancellation(request.requestId, "APPROVED"),
    (error) =>
      error.code === "RECOVERY_REQUIRED" &&
      /cancellation decision request update failed/i.test(error.message),
  );
  assert.equal(state.bookings[0].status, "CANCELLATION_PENDING");
  assert.equal(state.cancellationRequests[0].status, "APPROVING");
  assert.equal(state.auditLogs.length, 0);
  assert.equal(state.mail.length, 0);
  assert.equal(state.lockAcquired, 1);
  assert.equal(state.lockReleased, 1);

  assert.throws(
    () => context.decideAdminCancellation(request.requestId, "REJECTED"),
    /in-flight|resume/i,
  );
  assert.equal(state.bookings[0].status, "CANCELLATION_PENDING");
  assert.equal(state.cancellationRequests[0].status, "APPROVING");
  assert.equal(state.lockReleased, 2);

  const retry = context.decideAdminCancellation(request.requestId, "APPROVED");

  assert.equal(retry.success, true);
  assert.equal(state.bookings[0].status, "CANCELLED");
  assert.equal(state.cancellationRequests[0].status, "APPROVED");
  assert.equal(finalAudits(state).length, 1);
  assert.equal(state.auditLogs.length, 1);
  assert.equal(state.lockAcquired, 3);
  assert.equal(state.lockReleased, 3);
});

test("取消稽核寫入失敗（寫入前或寫入後）重試只會留下一筆穩定編號稽核", () => {
  for (const decision of ["APPROVED", "REJECTED"]) {
    for (const option of [
      "failAuditAppendActions",
      "failAuditAppendNoWriteActions",
    ]) {
      const { booking, request } = seedCancellation();
      const { context, state } = createHarness({
        bookings: [booking],
        cancellationRequests: [request],
        [option]: [`CANCELLATION_${decision}`],
      });

      assert.throws(
        () => context.decideAdminCancellation(request.requestId, decision),
        (error) =>
          error.code === "RECOVERY_REQUIRED" && /audit append failed/i.test(error.message),
      );
      assert.equal(
        state.bookings[0].status,
        decision === "APPROVED" ? "CANCELLED" : "SUBMITTED",
      );
      assert.equal(state.cancellationRequests[0].status, `${decision === "APPROVED" ? "APPROVING" : "REJECTING"}`);
      assert.equal(state.mail.length, 0);
      assert.equal(state.lockReleased, 1);

      const retry = context.decideAdminCancellation(request.requestId, decision);

      assert.equal(retry.success, true);
      assert.equal(state.cancellationRequests[0].status, decision);
      assert.equal(state.auditLogs.length, 1);
      assert.equal(
        state.auditLogs[0].eventId,
        `cancellation:${request.requestId}:${decision}`,
      );
      assert.equal(state.mail.length, 1);
      assert.equal(state.lockAcquired, 2);
      assert.equal(state.lockReleased, 2);

      assert.throws(
        () => context.decideAdminCancellation(request.requestId, decision),
        /pending/i,
      );
      assert.equal(state.auditLogs.length, 1);
    }
  }
});

test("取消回滾必然失敗也不依賴回滾：保留意圖、列表標示需恢復、同決定續行完成", () => {
  for (const [when, midStatus] of [
    ["before", "APPROVING"],
    ["after", "APPROVED"],
  ]) {
  const { booking, request } = seedCancellation();
  const { context, state } = createHarness({
    bookings: [booking],
    cancellationRequests: [request],
    failCancellationFinalizeUpdate: when,
    failAdminBookingRollback: true,
  });

  assert.throws(
    () => context.decideAdminCancellation(request.requestId, "APPROVED"),
    (error) =>
      error.code === "RECOVERY_REQUIRED" &&
      /cancellation finalize update failed/i.test(error.message),
  );
  assert.equal(state.bookings[0].status, "CANCELLED");
  assert.equal(state.cancellationRequests[0].status, midStatus);
  assert.equal(state.auditLogs.length, 1);
  assert.equal(state.mail.length, 0);
  assert.equal(state.lockReleased, 1);

  const listed = context.listAdminCancellationRequests();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].needsRecovery, true);
  assert.equal(listed[0].recoveryDecision, "APPROVED");

  assert.throws(
    () => context.decideAdminCancellation(request.requestId, "REJECTED"),
    /in-flight|resume|PENDING/i,
  );
  assert.equal(state.bookings[0].status, "CANCELLED");
  assert.equal(state.auditLogs.length, 1);

  const resumed = context.decideAdminCancellation(request.requestId, "APPROVED");

  assert.equal(resumed.success, true);
  assert.equal(state.bookings[0].status, "CANCELLED");
  assert.equal(state.cancellationRequests[0].status, "APPROVED");
  assert.equal(state.cancellationRequests[0].reviewedBy, "admin@example.com");
  assert.equal(state.auditLogs.length, 1);
  assert.equal(state.mail.length, 1);
  assert.equal(state.lockAcquired, 3);
  assert.equal(state.lockReleased, 3);
  assert.equal(context.listAdminCancellationRequests().length, 0);
  }
});

test("未授權者不能續行進行中的取消決定", () => {
  const { booking, request } = seedCancellation("APPROVING");
  const { context, state } = createHarness({
    bookings: [{ ...booking, status: "CANCELLED" }],
    cancellationRequests: [request],
    activeUserEmail: "intruder@example.com",
  });

  assert.throws(
    () => context.decideAdminCancellation(request.requestId, "APPROVED"),
    /admin/i,
  );
  assert.equal(state.repositoryWrites, 0);
  assert.equal(state.lockAcquired, 0);
});

test("管理員可立即關閉並稽核課程；截止後重開明確失敗且不修改資料", () => {
  const { context, state } = createHarness();

  const opened = context.setCourseRegistrationMode("course-1", "OPEN");

  assert.equal(opened.manualRegistrationMode, "OPEN");
  assert.equal(state.course.manualRegistrationMode, "OPEN");
  assert.equal(finalAudits(state)[0].action, "COURSE_REGISTRATION_OPEN");

  const closed = context.setCourseRegistrationMode("course-1", "CLOSED");

  assert.equal(closed.manualRegistrationMode, "CLOSED");
  assert.equal(state.course.manualRegistrationMode, "CLOSED");
  assert.equal(finalAudits(state).length, 2);
  assert.equal(finalAudits(state)[1].actorEmail, "admin@example.com");
  assert.equal(finalAudits(state)[1].action, "COURSE_REGISTRATION_CLOSED");
  assert.equal(finalAudits(state)[1].recordId, "course-1");

  const pastCourseHarness = createHarness({
    course: {
      courseId: "past-course",
      title: "Past course",
      date: "2000-01-01",
      manualRegistrationMode: "CLOSED",
    },
  });
  assert.throws(
    () =>
      pastCourseHarness.context.setCourseRegistrationMode(
        "past-course",
        "OPEN",
      ),
    /deadline|截止/i,
  );
  assert.equal(
    pastCourseHarness.state.course.manualRegistrationMode,
    "CLOSED",
  );
  assert.equal(pastCourseHarness.state.auditLogs.length, 0);
});

test("課程稽核寫入失敗（寫入前）保留待恢復意圖，同模式續行且只產生一筆最終稽核", () => {
  const { context, state } = createHarness({
    failAuditAppendNoWriteActions: ["COURSE_REGISTRATION_CLOSED"],
  });

  assert.throws(
    () => context.setCourseRegistrationMode("course-1", "CLOSED"),
    (error) =>
      error.code === "RECOVERY_REQUIRED" && /audit append failed/i.test(error.message),
  );
  assert.equal(state.course.manualRegistrationMode, "CLOSED");
  assert.equal(finalAudits(state).length, 0);
  assert.equal(state.auditLogs.length, 1);
  assert.equal(state.lockReleased, 1);
  const pending = context
    .listAdminCourses()
    .find((course) => course.courseId === "course-1");
  assert.equal(pending.pendingRecovery.mode, "CLOSED");

  assert.throws(
    () => context.setCourseRegistrationMode("course-1", "OPEN"),
    /in-flight|resume/i,
  );
  assert.equal(state.course.manualRegistrationMode, "CLOSED");
  assert.equal(state.lockReleased, 2);

  const retry = context.setCourseRegistrationMode("course-1", "CLOSED");

  assert.equal(retry.manualRegistrationMode, "CLOSED");
  assert.equal(finalAudits(state).length, 1);
  assert.equal(finalAudits(state)[0].action, "COURSE_REGISTRATION_CLOSED");
  assert.equal(finalAudits(state)[0].actorEmail, "admin@example.com");
  assert.equal(context.listAdminCourses()[0].pendingRecovery, null);
  assert.equal(state.lockAcquired, 3);
  assert.equal(state.lockReleased, 3);

  context.setCourseRegistrationMode("course-1", "OPEN");
  assert.equal(finalAudits(state).length, 2);
});

test("課程稽核寫入後回報錯誤與課程更新失敗重試都不重複稽核", () => {
  const afterWrite = createHarness({
    failAuditAppendActions: ["COURSE_REGISTRATION_CLOSED"],
  });
  assert.throws(
    () => afterWrite.context.setCourseRegistrationMode("course-1", "CLOSED"),
    /audit append failed/i,
  );
  afterWrite.context.setCourseRegistrationMode("course-1", "CLOSED");
  assert.equal(finalAudits(afterWrite.state).length, 1);
  assert.equal(afterWrite.state.course.manualRegistrationMode, "CLOSED");

  const updateFailure = createHarness({ failCourseUpdateOnce: true });
  assert.throws(
    () => updateFailure.context.setCourseRegistrationMode("course-1", "CLOSED"),
    (error) =>
      error.code === "RECOVERY_REQUIRED" && /course update failed/i.test(error.message),
  );
  assert.equal(updateFailure.state.course.manualRegistrationMode, "AUTO");
  assert.equal(finalAudits(updateFailure.state).length, 0);
  assert.equal(updateFailure.state.lockReleased, 1);
  updateFailure.context.setCourseRegistrationMode("course-1", "CLOSED");
  assert.equal(updateFailure.state.course.manualRegistrationMode, "CLOSED");
  assert.equal(finalAudits(updateFailure.state).length, 1);
});

test("通知狀態無法持久化時回報錯誤而不假稱寄送成功", () => {
  const { booking, request } = seedCancellation();
  const { context, state } = createHarness({
    bookings: [booking],
    cancellationRequests: [request],
    failNotificationStatusWrite: true,
  });

  assert.throws(
    () => context.decideAdminCancellation(request.requestId, "APPROVED"),
    /notification status persistence failed/i,
  );
  assert.equal(state.mail.length, 1);
  assert.equal(state.cancellationRequests[0].notificationEmailStatus, "PENDING");
  assert.equal(context.listAdminCancellationRequests().length, 1);
});
