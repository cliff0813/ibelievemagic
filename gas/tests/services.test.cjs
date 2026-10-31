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
} = {}) {
  const state = {
    bookings: structuredClone(bookings),
    participants: structuredClone(participants),
    cancellationRequests: structuredClone(cancellationRequests),
    course: structuredClone(course),
    cache: new Map(),
    cacheKeys: [],
    lockAcquired: 0,
    lockReleased: 0,
    mail: [],
    uuidCalls: 0,
  };
  const context = {
    getCourses_: () => [structuredClone(state.course)],
    getBookings_: () => state.bookings,
    getParticipants_: () =>
      state.participants.map((participant) => ({
        ...participant,
        bookingStatus: state.bookings.find(
          (booking) => booking.bookingId === participant.bookingId,
        )?.status,
      })),
    getCancellationRequests_: () => state.cancellationRequests,
    insertBooking_: (booking) => state.bookings.push(structuredClone(booking)),
    insertParticipants_: (newParticipants) => {
      if (failParticipantWrite) throw new Error("Participant persistence failed");
      state.participants.push(...structuredClone(newParticipants));
    },
    updateBooking_: (bookingId, updates) => {
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
      const request = state.cancellationRequests.find(
        (item) => item.requestId === requestId,
      );
      if (!request) throw new Error("Cancellation request not found");
      Object.assign(request, structuredClone(updates));
    },
    insertCancellationRequest_: (request) =>
      state.cancellationRequests.push(structuredClone(request)),
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
  for (const filename of ["Domain.gs", "RegistrationService.gs"]) {
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
  assert.throws(
    () =>
      context.submitBooking(
        validPayload({
          registrationType: "GROUP",
          participants: [
            { name: "成員甲", phone: "0912345678", email: "a@example.com" },
            { name: "成員乙", phone: "0912345679", email: "b@example.com" },
          ],
        }),
      ),
    /three|3|三/i,
  );
  assert.equal(state.bookings.length, 0);
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
  assert.equal(found.booking.lookupCode, "existing-code");
  assert.equal("bookingId" in found.booking, false);
  assert.equal("bookingId" in found.participants[0], false);
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
