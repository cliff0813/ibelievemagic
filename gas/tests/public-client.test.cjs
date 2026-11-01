const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const clientPath = path.join(__dirname, "..", "src", "Client.html");

class Element {
  constructor(tagName = "div", id = "") {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.children = [];
    this.listeners = {};
    this.dataset = {};
    this.attributes = {};
    this.className = "";
    this.value = "";
    this._textContent = "";
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.parentNode = null;
  }

  focus() {}

  select() {}

  get textContent() {
    return (
      this._textContent +
      this.children.map((child) => child.textContent).join("")
    );
  }

  set textContent(value) {
    this._textContent = String(value ?? "");
    this.children = [];
  }

  addEventListener(type, callback) {
    this.listeners[type] = callback;
  }

  dispatch(type, extra = {}) {
    const callback = this.listeners[type];
    if (callback) {
      callback({
        preventDefault() {},
        target: this,
        ...extra,
      });
    }
  }

  append(...nodes) {
    for (const node of nodes) {
      node.parentNode = this;
      this.children.push(node);
    }
  }

  appendChild(node) {
    this.append(node);
    return node;
  }

  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const match = (element) => {
      if (selector.startsWith(".")) {
        return element.className.split(/\s+/).includes(selector.slice(1));
      }
      const field = selector.match(/^\[data-field="([^"]+)"\]$/);
      if (field) return element.dataset.field === field[1];
      const namedInput = selector.match(/^input\[name="([^"]+)"\]$/);
      if (namedInput) {
        return (
          element.tagName === "INPUT" &&
          element.name === namedInput[1]
        );
      }
      return false;
    };
    const found = [];
    const visit = (element) => {
      for (const child of element.children) {
        if (match(child)) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter(
      (child) => child !== this,
    );
    this.parentNode = null;
  }

  reportValidity() {
    return true;
  }
}

function createClientHarness({ confirm = true } = {}) {
  const ids = [
    "app",
    "booking-form",
    "course-select",
    "leader-name",
    "leader-phone",
    "leader-email",
    "participants-container",
    "add-participant",
    "consent",
    "submit-booking",
    "booking-status",
    "booking-success",
    "lookup-form",
    "lookup-code",
    "lookup-phone",
    "lookup-status",
    "booking-details",
    "cancellation-form",
    "cancellation-reason",
    "cancel-booking",
    "cancellation-status",
    "lookup-code-display",
    "email-status",
    "copy-lookup-code",
    "registration-type-individual",
    "registration-type-group",
  ];
  const elements = Object.fromEntries(
    ids.map((id) => [id, new Element("div", id)]),
  );
  elements["app"].dataset.initialCourseId = "course-1";
  elements["booking-form"].reportValidity = () => true;
  elements["lookup-form"].reportValidity = () => true;
  elements["registration-type-individual"].type = "radio";
  elements["registration-type-individual"].name = "registrationType";
  elements["registration-type-individual"].value = "INDIVIDUAL";
  elements["registration-type-individual"].checked = true;
  elements["registration-type-group"].type = "radio";
  elements["registration-type-group"].name = "registrationType";
  elements["registration-type-group"].value = "GROUP";

  const serverCalls = [];
  let copied = "";
  let confirmation = confirm;
  const document = {
    getElementById(id) {
      return elements[id] || null;
    },
    createElement(tagName) {
      return new Element(tagName);
    },
    querySelectorAll(selector) {
      if (selector === 'input[name="registrationType"]') {
        return [
          elements["registration-type-individual"],
          elements["registration-type-group"],
        ];
      }
      return [];
    },
  };
  const runner = {
    successHandler: null,
    failureHandler: null,
    withSuccessHandler(handler) {
      this.successHandler = handler;
      return this;
    },
    withFailureHandler(handler) {
      this.failureHandler = handler;
      return this;
    },
    listOpenCourses() {
      serverCalls.push({ method: "listOpenCourses" });
      this.successHandler([
        {
          courseId: "course-1",
          title: "公開課程",
          date: "2099-12-01",
          startTime: "10:00",
          location: "台北",
        },
      ]);
    },
    submitBooking(payload) {
      serverCalls.push({ method: "submitBooking", payload });
      this.pendingSuccess = this.successHandler;
      this.pendingFailure = this.failureHandler;
    },
    lookupBooking(code, phone) {
      serverCalls.push({ method: "lookupBooking", code, phone });
      this.pendingSuccess = this.successHandler;
    },
    requestCancellation(code, phone, reason) {
      serverCalls.push({ method: "requestCancellation", code, phone, reason });
      this.pendingSuccess = this.successHandler;
    },
  };
  const context = {
    document,
    google: { script: { run: runner } },
    navigator: {
      clipboard: {
        writeText: async (value) => {
          copied = value;
          return value;
        },
      },
    },
    window: { confirm: () => confirmation },
    console,
  };
  vm.createContext(context);
  const source = fs.readFileSync(clientPath, "utf8").replace(/<\/?script>/g, "");
  vm.runInContext(source, context, { filename: clientPath });
  return {
    elements,
    serverCalls,
    runner,
    get copied() {
      return copied;
    },
    setConfirmation(value) {
      confirmation = value;
    },
  };
}

function addParticipantValues(row, values) {
  for (const [field, value] of Object.entries(values)) {
    const input = row.querySelector(`[data-field="${field}"]`);
    input.value = value;
  }
}

function setBookingValues(harness, { group = false } = {}) {
  const { elements } = harness;
  elements["leader-name"].value = "團主";
  elements["leader-phone"].value = "0912345678";
  elements["leader-email"].value = "leader@example.com";
  elements.consent.checked = true;
  elements["registration-type-individual"].checked = !group;
  elements["registration-type-group"].checked = group;
  const rows = elements["participants-container"].querySelectorAll(
    ".participant-row",
  );
  rows.forEach((row, index) =>
    addParticipantValues(row, {
      name: `學員${index + 1}`,
      phone: `091234567${index}`,
      email: `member${index}@example.com`,
      lineName: `line-${index}`,
    }),
  );
}

test("booking submission sends participant data, disables while pending, and preserves throttled lookup code", () => {
  const harness = createClientHarness();
  setBookingValues(harness);
  harness.elements["booking-form"].dispatch("submit");

  const call = harness.serverCalls.find(
    (item) => item.method === "submitBooking",
  );
  assert.equal(call.payload.courseId, "course-1");
  assert.equal(call.payload.registrationType, "INDIVIDUAL");
  assert.equal(call.payload.participants[0].name, "學員1");
  assert.equal(harness.elements["submit-booking"].disabled, true);
  assert.match(harness.elements["booking-status"].textContent, /送出|處理/);

  harness.runner.pendingSuccess({
    success: true,
    lookupCode: "copy-this-code",
    confirmationEmailStatus: "RATE_LIMITED",
  });

  test("three-person group booking submits all participants", () => {
    const harness = createClientHarness();
    harness.elements["registration-type-individual"].checked = false;
    harness.elements["registration-type-group"].checked = true;
    harness.elements["registration-type-group"].dispatch("change");
    harness.elements["add-participant"].dispatch("click");
    harness.elements["add-participant"].dispatch("click");
    setBookingValues(harness, { group: true });

    harness.elements["booking-form"].dispatch("submit");

    const call = harness.serverCalls.find(
      (item) => item.method === "submitBooking",
    );
    assert.equal(call.payload.registrationType, "GROUP");
    assert.equal(call.payload.participants.length, 3);
  });

  assert.equal(harness.elements["submit-booking"].disabled, false);
  assert.equal(harness.elements["lookup-code-display"].value, "copy-this-code");
  assert.equal(harness.elements["lookup-code-display"].disabled, false);
  assert.match(harness.elements["email-status"].textContent, /RATE_LIMITED.*寄送頻率限制/);
});

test("copy action copies the visible lookup code", async () => {
  const harness = createClientHarness();
  setBookingValues(harness);
  harness.elements["booking-form"].dispatch("submit");
  harness.runner.pendingSuccess({
    success: true,
    lookupCode: "copyable-code",
    confirmationEmailStatus: "FAILED",
  });

  harness.elements["copy-lookup-code"].dispatch("click");
  await Promise.resolve();

  assert.equal(harness.copied, "copyable-code");
});

test("RATE_LIMIT_UNAVAILABLE still leaves a visible and copyable lookup code", () => {
  const harness = createClientHarness();
  setBookingValues(harness);
  harness.elements["booking-form"].dispatch("submit");
  harness.runner.pendingSuccess({
    success: true,
    lookupCode: "save-this-code",
    confirmationEmailStatus: "RATE_LIMIT_UNAVAILABLE",
  });

  assert.equal(harness.elements["lookup-code-display"].value, "save-this-code");
  assert.equal(harness.elements["lookup-code-display"].disabled, false);
  assert.match(harness.elements["email-status"].textContent, /RATE_LIMIT_UNAVAILABLE.*無法確認寄送頻率/);
});

test("booking success handler displays server-side validation responses", () => {
  const harness = createClientHarness();
  setBookingValues(harness);
  harness.elements["booking-form"].dispatch("submit");
  harness.runner.pendingSuccess({
    success: false,
    errors: ["GROUP_REQUIRES_THREE_PARTICIPANTS"],
  });

  assert.equal(harness.elements["submit-booking"].disabled, false);
  assert.match(harness.elements["booking-status"].textContent, /至少需要三位學員/);
});

test("booking failure handler restores the submit button with a service message", () => {
  const harness = createClientHarness();
  setBookingValues(harness);
  harness.elements["booking-form"].dispatch("submit");
  harness.runner.pendingFailure(new Error("服務暫時無法使用"));

  assert.equal(harness.elements["submit-booking"].disabled, false);
  assert.match(harness.elements["booking-status"].textContent, /服務暫時無法完成操作/);
});

test("group booking with fewer than three participants is not submitted", () => {
  const harness = createClientHarness();
  setBookingValues(harness, { group: true });
  harness.elements["registration-type-group"].dispatch("change");
  harness.elements["add-participant"].dispatch("click");
  const row = harness.elements["participants-container"].children.at(-1);
  row.remove();
  harness.elements["booking-form"].dispatch("submit");

  assert.equal(
    harness.serverCalls.some((item) => item.method === "submitBooking"),
    false,
  );
  assert.match(harness.elements["booking-status"].textContent, /三|3/);
});

test("lookup renders only the matched booking and cancellation waits for confirmation", () => {
  const harness = createClientHarness({ confirm: false });
  harness.elements["lookup-code"].value = "lookup-1";
  harness.elements["lookup-phone"].value = "0912345678";
  harness.elements["lookup-form"].dispatch("submit");
  assert.deepEqual(
    harness.serverCalls.at(-1),
    { method: "lookupBooking", code: "lookup-1", phone: "0912345678" },
  );

  harness.runner.pendingSuccess({
    found: true,
    booking: {
      lookupCode: "lookup-1",
      courseId: "course-1",
      courseDate: "2099-12-01",
      leaderName: "團主",
      status: "SUBMITTED",
    },
    participants: [{ name: "學員甲", phone: "0912345678" }],
  });
  assert.match(harness.elements["booking-details"].textContent, /團主|學員甲/);
  assert.equal(harness.elements["cancellation-form"].hidden, false);

  harness.elements["cancellation-reason"].value = "行程變更";
  harness.elements["cancellation-form"].dispatch("submit");
  assert.equal(
    harness.serverCalls.some((item) => item.method === "requestCancellation"),
    false,
  );

  harness.setConfirmation(true);
  harness.elements["cancellation-form"].dispatch("submit");
  harness.runner.pendingSuccess({
    success: true,
    status: "CANCELLATION_PENDING",
  });
  assert.match(harness.elements["cancellation-status"].textContent, /待管理員審核/);
  assert.doesNotMatch(harness.elements["cancellation-status"].textContent, /已取消/);
});

test("overlapping lookups cannot pair a result with another booking's credentials", () => {
  const harness = createClientHarness();
  harness.elements["lookup-code"].value = "first-code";
  harness.elements["lookup-phone"].value = "0911111111";
  harness.elements["lookup-form"].dispatch("submit");
  const firstResponse = harness.runner.pendingSuccess;

  harness.elements["lookup-code"].value = "second-code";
  harness.elements["lookup-phone"].value = "0922222222";
  harness.elements["lookup-form"].dispatch("submit");
  const secondResponse = harness.runner.pendingSuccess;

  secondResponse({
    found: true,
    booking: {
      courseId: "course-2",
      courseDate: "2099-12-02",
      leaderName: "第二團主",
      status: "SUBMITTED",
    },
    participants: [{ name: "第二學員", phone: "0922222222" }],
  });
  firstResponse({
    found: true,
    booking: {
      courseId: "course-1",
      courseDate: "2099-12-01",
      leaderName: "第一團主",
      status: "SUBMITTED",
    },
    participants: [{ name: "第一學員", phone: "0911111111" }],
  });

  assert.match(harness.elements["booking-details"].textContent, /第二團主/);
  assert.doesNotMatch(harness.elements["booking-details"].textContent, /第一團主/);
  harness.elements["cancellation-form"].dispatch("submit");
  const cancellation = harness.serverCalls.find(
    (item) => item.method === "requestCancellation",
  );
  assert.equal(cancellation.code, "second-code");
  assert.equal(cancellation.phone, "0922222222");
});

test("HTML presentation never injects sheet text as markup", () => {
  const publicHtml = fs.readFileSync(
    path.join(__dirname, "..", "src", "Public.html"),
    "utf8",
  );
  const client = fs.readFileSync(clientPath, "utf8");

  assert.match(publicHtml, /id="booking-form"/);
  assert.match(publicHtml, /id="lookup-form"/);
  assert.match(client, /textContent/);
  assert.doesNotMatch(client, /\.innerHTML\s*=/);
  assert.doesNotMatch(publicHtml, /價格|價錢|付款|名額剩餘/);
});
