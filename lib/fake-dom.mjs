// Minimal fake DOM, just enough for react-dom/client to mount, update, and
// dispatch events in node:test without jsdom or any other dependency.
class FakeNode {
  constructor(doc) {
    this.ownerDocument = doc;
    this.childNodes = [];
    this.parentNode = null;
  }
  get firstChild() { return this.childNodes[0] ?? null; }
  get lastChild() { return this.childNodes.at(-1) ?? null; }
  get nextSibling() {
    const s = this.parentNode?.childNodes;
    return s ? s[s.indexOf(this) + 1] ?? null : null;
  }
  appendChild(child) { return this.insertBefore(child, null); }
  insertBefore(child, ref) {
    child.parentNode?.removeChild(child);
    child.parentNode = this;
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i === -1) this.childNodes.push(child);
    else this.childNodes.splice(i, 0, child);
    return child;
  }
  removeChild(child) {
    const i = this.childNodes.indexOf(child);
    if (i !== -1) this.childNodes.splice(i, 1);
    child.parentNode = null;
    return child;
  }
  get textContent() {
    return this.nodeType === 3 ? this.data : this.childNodes.map((c) => c.textContent).join("");
  }
  set textContent(v) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    if (v) this.appendChild(this.ownerDocument.createTextNode(String(v)));
  }
}

class FakeText extends FakeNode {
  nodeType = 3;
  nodeName = "#text";
  constructor(doc, data) { super(doc); this.data = data; }
  get nodeValue() { return this.data; }
  set nodeValue(v) { this.data = String(v); }
}

class FakeElement extends FakeNode {
  nodeType = 1;
  constructor(doc, tag) {
    super(doc);
    this.nodeName = this.tagName = tag.toUpperCase();
    this.attributes = new Map();
    this.listeners = [];
    this.style = { setProperty() {} };
    this._value = "";
  }
  // Accessor lives on the prototype so React's input value tracking works the
  // same way it does against a real HTMLInputElement.
  get value() { return this._value; }
  set value(v) { this._value = String(v); }
  setAttribute(k, v) { this.attributes.set(k, String(v)); }
  getAttribute(k) { return this.attributes.has(k) ? this.attributes.get(k) : null; }
  removeAttribute(k) { this.attributes.delete(k); }
  hasAttribute(k) { return this.attributes.has(k); }
  addEventListener(type, listener, options) {
    const capture = options === true || !!options?.capture;
    this.listeners.push({ type, listener, capture });
  }
  removeEventListener(type, listener, options) {
    const capture = options === true || !!options?.capture;
    this.listeners = this.listeners.filter(
      (l) => !(l.type === type && l.listener === listener && l.capture === capture),
    );
  }
  get type() { return this.getAttribute("type") ?? (this.nodeName === "INPUT" ? "text" : ""); }
  set type(v) { this.setAttribute("type", v); }
}

class FakeDocument extends FakeNode {
  nodeType = 9;
  nodeName = "#document";
  constructor() {
    super(null);
    this.ownerDocument = this;
    this.defaultView = null;
    this.documentElement = new FakeElement(this, "html");
    this.head = new FakeElement(this, "head");
    this.body = new FakeElement(this, "body");
    this.activeElement = this.body;
    this.listeners = [];
    this.oninput = null; // lets React detect native `input` event support
  }
  createElement(tag) { return new FakeElement(this, tag); }
  createElementNS(_ns, tag) { return new FakeElement(this, tag); }
  createTextNode(data) { return new FakeText(this, String(data)); }
  addEventListener() {}
  removeEventListener() {}
}

const GLOBAL_KEYS = ["window", "document", "IS_REACT_ACT_ENVIRONMENT"];

/** Installs fake globals; returns { window, document, restore } where restore() reinstates the prior values. */
export function installFakeDom() {
  const previous = GLOBAL_KEYS.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]);
  const document = new FakeDocument();
  const window = {
    document,
    HTMLIFrameElement: class {},
    HTMLElement: FakeElement,
    location: { href: "http://localhost/" },
    addEventListener() {},
    removeEventListener() {},
    navigator: { userAgent: "node" },
    setTimeout,
    clearTimeout,
  };
  document.defaultView = window;
  const define = (k, value) =>
    Object.defineProperty(globalThis, k, { value, configurable: true, writable: true, enumerable: true });
  define("window", window);
  define("document", document);
  define("IS_REACT_ACT_ENVIRONMENT", true);
  const restore = () => {
    for (const [k, d] of previous) {
      if (d) Object.defineProperty(globalThis, k, d);
      else delete globalThis[k];
    }
  };
  return { window, document, restore };
}

/** Dispatches a bubbling native event through capture then bubble listeners. */
export function dispatchEvent(target, type, props = {}) {
  const path = [];
  for (let n = target; n; n = n.parentNode) path.push(n);
  const event = {
    type,
    target,
    bubbles: true,
    cancelable: true,
    defaultPrevented: false,
    isTrusted: true,
    timeStamp: Date.now(),
    eventPhase: 3,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() {},
    ...props,
  };
  for (const n of [...path].reverse()) {
    for (const l of n.listeners ?? []) if (l.type === type && l.capture) l.listener({ ...event, currentTarget: n, target });
  }
  for (const n of path) {
    for (const l of n.listeners ?? []) if (l.type === type && !l.capture) l.listener({ ...event, currentTarget: n, target });
  }
}

export function findAll(node, predicate, out = []) {
  if (node.nodeType === 1 && predicate(node)) out.push(node);
  for (const c of node.childNodes ?? []) findAll(c, predicate, out);
  return out;
}

export function setNativeValue(input, value) {
  // Bypass any instance-level tracker, like real user input does.
  Object.getOwnPropertyDescriptor(FakeElement.prototype, "value").set.call(input, value);
}