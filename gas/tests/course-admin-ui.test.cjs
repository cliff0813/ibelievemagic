const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const adminPath = path.join(__dirname, "..", "src", "Admin.html");
const adminHtml = fs.readFileSync(adminPath, "utf8");

class Element {
  constructor(tagName = "div", id = "") {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.children = [];
    this.listeners = {};
    this.attributes = {};
    this.className = "";
    this._value = "";
    this.readOnly = false;
    this.required = false;
    this.disabled = false;
    this.hidden = false;
    this.parentNode = null;
    this._textContent = "";
  }

  get textContent() {
    return this._textContent + this.children.map((child) => child.textContent).join("");
  }

  get value() {
    return this._value;
  }

  set value(value) {
    this._value = String(value ?? "");
  }

  set textContent(value) {
    this._textContent = String(value ?? "");
    this.replaceChildren();
  }

  addEventListener(type, callback) {
    this.listeners[type] = callback;
  }

  dispatch(type, extra = {}) {
    const callback = this.listeners[type];
    if (callback) {
      callback({
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
        target: this,
        ...extra,
      });
    }
  }

  appendChild(node) {
    node.parentNode = this;
    this.children.push(node);
    return node;
  }

  insertBefore(node, reference) {
    const currentIndex = this.children.indexOf(node);
    if (currentIndex >= 0) this.children.splice(currentIndex, 1);
    const referenceIndex = this.children.indexOf(reference);
    node.parentNode = this;
    this.children.splice(referenceIndex < 0 ? this.children.length : referenceIndex, 0, node);
    return node;
  }

  replaceChildren(...nodes) {
    this.children = [];
    nodes.forEach((node) => this.appendChild(node));
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
      const named = selector.match(/^\[name="([^"]+)"\]$/);
      if (named) return element.name === named[1];
      const namedInput = selector.match(/^input\[name="([^"]+)"\]$/);
      if (namedInput) {
        return element.tagName === "INPUT" && element.name === namedInput[1];
      }
      return false;
    };
    const found = [];
    const visit = (element) => {
      element.children.forEach((child) => {
        if (match(child)) found.push(child);
        visit(child);
      });
    };
    visit(this);
    return found;
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }

  reportValidity() {
    return true;
  }

  reset() {
    const clearValues = (element) => {
      element.children.forEach((child) => {
        if (child.tagName === "INPUT" || child.tagName === "TEXTAREA") {
          child.value = "";
        }
        clearValues(child);
      });
    };
    clearValues(this);
  }
}

function createHarness({ courses = [], confirm = true, uuidAvailable = true } = {}) {
  const ids = [
    "admin-status",
    "booking-list",
    "cancellation-list",
    "course-list",
    "course-form",
    "course-id",
    "course-title",
    "course-date",
    "course-start-time",
    "course-end-time",
    "course-location",
    "course-mode",
    "course-image",
    "course-description",
    "course-instructor",
    "course-instructor-bio",
    "course-outline",
    "course-pricing",
    "course-submit",
    "cancel-course-edit",
    "add-outline-item",
    "add-pricing-item",
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, new Element("div", id)]));
  elements["course-form"].reportValidity = () => true;
  elements["course-form"].reset = () => {
    ids.slice(5, 17).forEach((id) => {
      elements[id].value = "";
    });
  };
  const serverCalls = [];
  const pending = [];
  let uuid = 0;
  let confirmation = confirm;
  const runner = {
    withSuccessHandler(handler) {
      this.successHandler = handler;
      return this;
    },
    withFailureHandler(handler) {
      this.failureHandler = handler;
      return this;
    },
    listAdminBookings() {
      this.successHandler([]);
    },
    listAdminCancellationRequests() {
      this.successHandler([]);
    },
    listAdminCourses() {
      this.successHandler(courses);
    },
  };
  for (const method of [
    "createAdminCourse",
    "updateAdminCourse",
    "deleteAdminCourse",
    "setCourseRegistrationMode",
  ]) {
    runner[method] = function (...args) {
      serverCalls.push({ method, args });
      pending.push({
        success: this.successHandler,
        failure: this.failureHandler,
      });
    };
  }
  const document = {
    getElementById(id) {
      return elements[id] || null;
    },
    createElement(tagName) {
      return new Element(tagName);
    },
  };
  const context = {
    document,
    google: { script: { run: runner } },
    crypto: uuidAvailable ? { randomUUID: () => `uuid-${++uuid}` } : undefined,
    window: { confirm: () => confirmation },
  };
  vm.createContext(context);
  const script = adminHtml.match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInContext(script, context, { filename: adminPath });

  return {
    elements,
    serverCalls,
    runner,
    resolveLast(value) {
      pending.shift().success(value);
    },
    rejectLast(error) {
      pending.shift().failure(error);
    },
    setConfirmation(value) {
      confirmation = value;
    },
  };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

function setFormValues(elements) {
  Object.assign(elements["course-id"], { value: "course-2026-12" });
  Object.assign(elements["course-title"], { value: "年底課程" });
  Object.assign(elements["course-date"], { value: "2026-12-15" });
  Object.assign(elements["course-start-time"], { value: "13:30" });
  Object.assign(elements["course-end-time"], { value: "16:30" });
  Object.assign(elements["course-location"], { value: "台北" });
  Object.assign(elements["course-mode"], { value: "實體 + 線上" });
  Object.assign(elements["course-image"], { value: "https://example.com/course.png" });
  Object.assign(elements["course-description"], { value: "課程說明" });
  Object.assign(elements["course-instructor"], { value: "講師" });
  Object.assign(elements["course-instructor-bio"], { value: "講師簡介" });
  elements["course-outline"].querySelectorAll('[name="outline"]').forEach((input, index) => {
    input.value = `課綱 ${index + 1}`;
  });
  elements["course-pricing"].querySelectorAll('[name="pricingLabel"]').forEach((input) => {
    input.value = "一般原價";
  });
  elements["course-pricing"].querySelectorAll('[name="pricingPrice"]').forEach((input) => {
    input.value = "1200";
  });
}

test("admin page contains a fixed, labeled course form and linked-content controls", () => {
  for (const id of [
    "course-form",
    "course-id",
    "course-title",
    "course-date",
    "course-start-time",
    "course-end-time",
    "course-location",
    "course-mode",
    "course-image",
    "course-description",
    "course-instructor",
    "course-instructor-bio",
    "course-outline",
    "course-pricing",
    "course-submit",
    "cancel-course-edit",
  ]) {
    assert.match(adminHtml, new RegExp(`id="${id}"`));
  }
  assert.match(adminHtml, /manualRegistrationMode[^<]*AUTO|AUTO[^<]*截止/i);
});

test("new course gets an editable UUID and submits the complete payload", async () => {
  const harness = createHarness();
  const { elements } = harness;
  assert.equal(elements["course-id"].value, "uuid-1");
  assert.equal(elements["course-id"].readOnly, false);
  setFormValues(elements);

  elements["course-form"].dispatch("submit");

  assert.deepEqual(JSON.parse(JSON.stringify(harness.serverCalls)), [{
    method: "createAdminCourse",
    args: [{
      courseId: "course-2026-12",
      title: "年底課程",
      date: "2026-12-15",
      startTime: "13:30",
      endTime: "16:30",
      location: "台北",
      mode: "實體 + 線上",
      image: "https://example.com/course.png",
      description: "課程說明",
      instructor: "講師",
      instructorBio: "講師簡介",
      outline: ["課綱 1"],
      pricing: [{ label: "一般原價", price: 1200 }],
    }],
  }]);

  harness.rejectLast(new Error("network down"));
  await flushPromises();
  assert.equal(elements["course-title"].value, "年底課程");
  assert.match(elements["admin-status"].textContent, /network down/);
});

test("course list supports edit, cancellation, and fallback-only protections", async () => {
  const course = {
    courseId: "stored",
    title: "可編輯課程",
    date: "2026-12-15",
    startTime: "13:30",
    endTime: "16:30",
    location: "台北",
    mode: "實體",
    image: "",
    description: "介紹",
    instructor: "講師",
    instructorBio: "簡介",
    manualRegistrationMode: "AUTO",
    outline: ["第一單元"],
    pricing: [{ label: "一般原價", price: 1200 }],
    persisted: true,
  };
  const harness = createHarness({
    courses: [course, { ...course, courseId: "fallback", persisted: false }],
  });
  const { elements } = harness;
  await flushPromises();

  const editButton = elements["course-list"].querySelector(".course-edit-button");
  assert.ok(editButton);
  editButton.dispatch("click");
  assert.equal(elements["course-id"].value, "stored");
  assert.equal(elements["course-id"].readOnly, true);
  assert.equal(elements["course-title"].value, "可編輯課程");
  assert.equal(elements["course-submit"].textContent, "更新課程");
  elements["course-title"].value = "更新名稱";
  elements["course-form"].dispatch("submit");
  assert.equal(harness.serverCalls.at(-1).method, "updateAdminCourse");
  assert.equal(harness.serverCalls.at(-1).args[0], "stored");
  harness.rejectLast(new Error("update down"));
  await flushPromises();
  assert.equal(elements["course-title"].value, "更新名稱");
  assert.match(elements["admin-status"].textContent, /update down/);

  elements["cancel-course-edit"].dispatch("click");
  assert.equal(elements["course-id"].readOnly, false);
  assert.equal(elements["course-submit"].textContent, "新增課程");

  const fallbackCard = elements["course-list"].children[1];
  assert.equal(fallbackCard.querySelector(".course-edit-button"), null);
  assert.equal(fallbackCard.querySelector(".course-delete-button"), null);
});

test("editing remains available when the browser cannot generate new UUIDs", async () => {
  const harness = createHarness({
    uuidAvailable: false,
    courses: [{
      courseId: "stored",
      title: "可編輯課程",
      date: "2026-12-15",
      persisted: true,
      outline: [],
      pricing: [],
    }],
  });
  const { elements } = harness;
  await flushPromises();

  assert.equal(elements["course-submit"].disabled, true);
  elements["course-list"].querySelector(".course-edit-button").dispatch("click");
  assert.equal(elements["course-submit"].disabled, false);
  elements["course-form"].dispatch("submit");
  assert.equal(harness.serverCalls.length, 1);
  assert.equal(harness.serverCalls.at(-1).method, "updateAdminCourse");
});

test("outline and pricing rows can be reordered", () => {
  const harness = createHarness();
  const { elements } = harness;
  elements["add-outline-item"].dispatch("click");
  const outlineRows = elements["course-outline"].querySelectorAll(".outline-row");
  outlineRows[0].querySelector('[name="outline"]').value = "第一項";
  outlineRows[1].querySelector('[name="outline"]').value = "第二項";
  outlineRows[1].querySelector(".outline-move-up").dispatch("click");
  assert.deepEqual(
    elements["course-outline"]
      .querySelectorAll('[name="outline"]')
      .map((input) => input.value),
    ["第二項", "第一項"],
  );

  elements["add-pricing-item"].dispatch("click");
  const pricingRows = elements["course-pricing"].querySelectorAll(".pricing-row");
  pricingRows[0].querySelector('[name="pricingLabel"]').value = "原價";
  pricingRows[0].querySelector('[name="pricingPrice"]').value = "1200";
  pricingRows[1].querySelector('[name="pricingLabel"]').value = "早鳥";
  pricingRows[1].querySelector('[name="pricingPrice"]').value = "1000";
  pricingRows[1].querySelector(".pricing-move-up").dispatch("click");
  assert.deepEqual(
    elements["course-pricing"]
      .querySelectorAll('[name="pricingLabel"]')
      .map((input) => input.value),
    ["早鳥", "原價"],
  );
});

test("dynamic content rows can be added and removed, and delete is confirmed", async () => {
  const harness = createHarness({
    courses: [{
      courseId: "stored",
      title: "<img src=x>",
      date: "2026-12-15",
      manualRegistrationMode: "AUTO",
      persisted: true,
      outline: [],
      pricing: [],
    }],
  });
  const { elements } = harness;
  await flushPromises();

  assert.equal(elements["course-outline"].querySelectorAll(".outline-row").length, 1);
  elements["add-outline-item"].dispatch("click");
  assert.equal(elements["course-outline"].querySelectorAll(".outline-row").length, 2);
  elements["course-outline"].querySelector(".outline-remove-button").dispatch("click");
  assert.equal(elements["course-outline"].querySelectorAll(".outline-row").length, 1);

  assert.equal(elements["course-pricing"].querySelectorAll(".pricing-row").length, 1);
  elements["add-pricing-item"].dispatch("click");
  assert.equal(elements["course-pricing"].querySelectorAll(".pricing-row").length, 2);
  elements["course-pricing"].querySelector(".pricing-remove-button").dispatch("click");
  assert.equal(elements["course-pricing"].querySelectorAll(".pricing-row").length, 1);

  const card = elements["course-list"].children[0];
  assert.equal(card.children[0].textContent, "<img src=x> · 2026-12-15");
  assert.ok(card.querySelector(".course-delete-button"));
  harness.setConfirmation(false);
  card.querySelector(".course-delete-button").dispatch("click");
  assert.equal(harness.serverCalls.some(({ method }) => method === "deleteAdminCourse"), false);
  harness.setConfirmation(true);
  card.querySelector(".course-delete-button").dispatch("click");
  assert.deepEqual(JSON.parse(JSON.stringify(harness.serverCalls.at(-1))), {
    method: "deleteAdminCourse",
    args: ["stored"],
  });
  harness.rejectLast(new Error("bookings prevent deletion"));
  await flushPromises();
  assert.match(elements["admin-status"].textContent, /bookings prevent deletion/);
});
