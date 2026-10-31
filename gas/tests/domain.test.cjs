const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const domainSource = fs.readFileSync(
  path.join(__dirname, "..", "src", "Domain.gs"),
  "utf8",
);
const domain = {};
vm.createContext(domain);
vm.runInContext(domainSource, domain, { filename: "Domain.gs" });

test("自動截止日前仍開放", () => {
  assert.equal(
    domain.getCourseAvailability_(
      "2026-11-17",
      new Date("2026-11-14T23:59:59+08:00"),
      "AUTO",
    ),
    "OPEN",
  );
});

test("自動截止時關閉狀態", () => {
  assert.equal(
    domain.getCourseAvailability_(
      "2026-11-17",
      new Date("2026-11-15T00:00:00+08:00"),
      "AUTO",
    ),
    "CLOSED",
  );
});

test("手動開啟不能突破截止", () => {
  assert.equal(
    domain.getCourseAvailability_(
      "2026-11-17",
      new Date("2026-11-15T00:00:00+08:00"),
      "OPEN",
    ),
    "CLOSED",
  );
});

test("手動關閉可提早關閉", () => {
  assert.equal(
    domain.getCourseAvailability_(
      "2026-11-17",
      new Date("2026-11-14T23:59:59+08:00"),
      "CLOSED",
    ),
    "CLOSED",
  );
});

test("電話正規化保留開頭零並移除分隔符", () => {
  assert.equal(domain.normalizePhone_("0912-345 678"), "0912345678");
});

test("電子郵件正規化為小寫並去除空白", () => {
  assert.equal(domain.normalizeEmail_("  User@Example.COM "), "user@example.com");
});

test("未指定手動模式時依截止時間開放", () => {
  assert.equal(
    domain.getCourseAvailability_(
      "2026-11-17",
      new Date("2026-11-14T23:59:59+08:00"),
      "",
    ),
    "OPEN",
  );
});

test("未知手動模式採取安全關閉", () => {
  assert.equal(
    domain.getCourseAvailability_(
      "2026-11-17",
      new Date("2026-11-14T23:59:59+08:00"),
      "UNKNOWN",
    ),
    "CLOSED",
  );
});

test("既有有效報名中手機或 Email 任一相同即為重複", () => {
  const candidate = {
    phone: "0912-345 678",
    email: "USER@example.com",
  };
  const existing = [
    {
      courseId: "course-1",
      courseDate: "2026-11-17",
      bookingStatus: "SUBMITTED",
      phone: "0912345678",
      email: "other@example.com",
    },
    {
      courseId: "course-1",
      courseDate: "2026-11-17",
      bookingStatus: "CANCELLATION_PENDING",
      phone: "0987654321",
      email: "user@example.com",
    },
  ];

  assert.equal(
    domain.isExistingDuplicate_("course-1", "2026-11-17", candidate, existing),
    true,
  );
});

test("已取消或其他課程的報名不算重複", () => {
  const candidate = { phone: "0912345678", email: "user@example.com" };
  const existing = [
    {
      courseId: "course-2",
      courseDate: "2026-11-17",
      bookingStatus: "SUBMITTED",
      phone: "0912345678",
      email: "another@example.com",
    },
    {
      courseId: "course-1",
      courseDate: "2026-11-17",
      bookingStatus: "CANCELLED",
      phone: "0912345678",
      email: "another@example.com",
    },
  ];

  assert.equal(
    domain.isExistingDuplicate_("course-1", "2026-11-17", candidate, existing),
    false,
  );
});

test("取消申請待審中的報名仍算有效重複", () => {
  const candidate = { phone: "0912345678", email: "new@example.com" };
  const existing = [
    {
      courseId: "course-1",
      courseDate: "2026-11-17",
      bookingStatus: "CANCELLATION_PENDING",
      phone: "0912345678",
      email: "old@example.com",
    },
  ];

  assert.equal(
    domain.isExistingDuplicate_("course-1", "2026-11-17", candidate, existing),
    true,
  );
});

test("同一團報可有不同學員共用電話及 Email", () => {
  const sharedContact = { phone: "0912345678", email: "group@example.com" };
  const earlierParticipants = [{ name: "王小明", ...sharedContact }];
  const candidate = { name: "王小華", ...sharedContact };

  assert.equal(
    domain.isDuplicateWithinSubmission_(candidate, earlierParticipants),
    false,
  );
});

test("同一團報不允許重複完全相同的學員資料", () => {
  const earlierParticipants = [
    {
      name: "王小明",
      phone: "0912-345 678",
      email: "USER@example.com",
      lineName: "magic",
    },
  ];
  const candidate = {
    name: " 王小明 ",
    phone: "0912345678",
    email: "user@example.com",
    lineName: "magic",
  };

  assert.equal(
    domain.isDuplicateWithinSubmission_(candidate, earlierParticipants),
    true,
  );
});

test("個人報名接受一位有效學員", () => {
  const result = domain.validateBookingInput_({
    courseId: "course-1",
    courseDate: "2026-11-17",
    registrationType: "INDIVIDUAL",
    leaderName: "王小明",
    leaderPhone: "0912345678",
    leaderEmail: "leader@example.com",
    participants: [
      {
        name: "王小明",
        phone: "0912345678",
        email: "member@example.com",
        lineName: "",
      },
    ],
  });

  assert.equal(result.valid, true);
  assert.deepEqual(Array.from(result.errors), []);
});

test("團體報名至少需要三位學員", () => {
  const result = domain.validateBookingInput_({
    courseId: "course-1",
    courseDate: "2026-11-17",
    registrationType: "GROUP",
    leaderName: "王小明",
    leaderPhone: "0912345678",
    leaderEmail: "leader@example.com",
    participants: [
      { name: "王小明", phone: "0912345678", email: "a@example.com" },
      { name: "王小華", phone: "0922345678", email: "b@example.com" },
    ],
  });

  assert.equal(result.valid, false);
  assert.ok(Array.from(result.errors).includes("GROUP_REQUIRES_THREE_PARTICIPANTS"));
});

test("三位不同團員可以共用團主聯絡電話及 Email", () => {
  const sharedContact = {
    phone: "0912345678",
    email: "group@example.com",
  };
  const result = domain.validateBookingInput_({
    courseId: "course-1",
    courseDate: "2026-11-17",
    registrationType: "GROUP",
    leaderName: "王小明",
    leaderPhone: "0912345678",
    leaderEmail: "leader@example.com",
    participants: [
      { name: "王小明", ...sharedContact },
      { name: "王小華", ...sharedContact },
      { name: "王小美", ...sharedContact },
    ],
  });

  assert.equal(result.valid, true);
  assert.deepEqual(Array.from(result.errors), []);
});

test("個人報名不接受多位學員", () => {
  const result = domain.validateBookingInput_({
    courseId: "course-1",
    courseDate: "2026-11-17",
    registrationType: "INDIVIDUAL",
    leaderName: "王小明",
    leaderPhone: "0912345678",
    leaderEmail: "leader@example.com",
    participants: [
      { name: "王小明", phone: "0912345678", email: "a@example.com" },
      { name: "王小華", phone: "0922345678", email: "b@example.com" },
    ],
  });

  assert.equal(result.valid, false);
  assert.ok(Array.from(result.errors).includes("INDIVIDUAL_REQUIRES_ONE_PARTICIPANT"));
});

test("驗證器安全拒絕空值及格式錯誤的 payload", () => {
  for (const payload of [
    null,
    [],
    {},
    {
      courseId: "course-1",
      courseDate: "2026-02-30",
      registrationType: "UNKNOWN",
      leaderName: "",
      leaderPhone: "abc",
      leaderEmail: "not-an-email",
      participants: "not-an-array",
    },
  ]) {
    assert.equal(domain.validateBookingInput_(payload).valid, false);
  }
});

test("驗證器拒絕重複學員、無效聯絡資料及缺漏欄位", () => {
  const result = domain.validateBookingInput_({
    courseId: "",
    courseDate: "not-a-date",
    registrationType: "GROUP",
    leaderName: "",
    leaderPhone: "",
    leaderEmail: "invalid",
    participants: [
      { name: "王小明", phone: "0912-345 678", email: "a@example.com" },
      { name: " 王小明 ", phone: "0912345678", email: "A@example.com" },
      { name: "   ", phone: "bad", email: "bad" },
    ],
  });

  assert.equal(result.valid, false);
  assert.ok(Array.from(result.errors).includes("DUPLICATE_PARTICIPANT"));
  assert.ok(Array.from(result.errors).includes("INVALID_COURSE_ID"));
  assert.ok(Array.from(result.errors).includes("INVALID_COURSE_DATE"));
  assert.ok(Array.from(result.errors).includes("INVALID_LEADER_NAME"));
  assert.ok(Array.from(result.errors).includes("INVALID_LEADER_PHONE"));
  assert.ok(Array.from(result.errors).includes("INVALID_LEADER_EMAIL"));
  assert.ok(Array.from(result.errors).includes("INVALID_PARTICIPANT"));
});

test("電話欄位拒絕混入字母的格式", () => {
  const result = domain.validateBookingInput_({
    courseId: "course-1",
    courseDate: "2026-11-17",
    registrationType: "INDIVIDUAL",
    leaderName: "王小明",
    leaderPhone: "abc0912345678",
    leaderEmail: "leader@example.com",
    participants: [
      {
        name: "王小明",
        phone: "0912345678",
        email: "member@example.com",
      },
    ],
  });

  assert.equal(result.valid, false);
  assert.ok(Array.from(result.errors).includes("INVALID_LEADER_PHONE"));
});

function bookingWithPhone_(phone) {
  return domain.validateBookingInput_({
    courseId: "course-1",
    courseDate: "2026-11-17",
    registrationType: "INDIVIDUAL",
    leaderName: "王小明",
    leaderPhone: phone,
    leaderEmail: "leader@example.com",
    participants: [
      { name: "王小明", phone: phone, email: "member@example.com", lineName: "" },
    ],
  });
}

test("電話加號只能出現在開頭且最多一個", () => {
  assert.equal(bookingWithPhone_("0912+345678").valid, false);
  assert.equal(bookingWithPhone_("++886912345678").valid, false);
  assert.equal(bookingWithPhone_("+886 912-345-678").valid, true);
});

test("不存在的日曆日期視為關閉", () => {
  const early = new Date("2026-01-01T00:00:00+08:00");
  assert.equal(domain.getCourseAvailability_("2026-02-31", early, "AUTO"), "CLOSED");
  assert.equal(domain.getCourseAvailability_("not-a-date", early, "AUTO"), "CLOSED");
});