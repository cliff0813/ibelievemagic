const REQUIRED_TEXT_FIELDS = [
  "title",
  "date",
  "startTime",
  "endTime",
  "location",
  "mode",
  "image",
  "description",
  "instructor",
];

/**
 * Builds the public-course JSONP request URL.
 *
 * @param {string} webAppUrl
 * @param {string} callback
 * @param {number|string} cacheBuster
 * @returns {string}
 */
export function buildCoursesUrl(webAppUrl, callback, cacheBuster = Date.now()) {
  const url = validateWebAppUrl(webAppUrl);
  if (typeof callback !== "string" || !/^[$A-Z_a-z][$\w]*$/.test(callback)) {
    throw new Error("callback must be a valid JavaScript identifier");
  }
  if (
    (typeof cacheBuster !== "number" && typeof cacheBuster !== "string") ||
    String(cacheBuster).trim() === "" ||
    (typeof cacheBuster === "number" && !Number.isFinite(cacheBuster))
  ) {
    throw new Error("cacheBuster must be a finite number or non-empty string");
  }

  url.searchParams.set("format", "courses");
  url.searchParams.set("callback", callback);
  url.searchParams.set("_", String(cacheBuster));
  return url.toString();
}

/**
 * Loads and validates public course records using cross-origin JSONP.
 *
 * @param {{
 *   webAppUrl: string,
 *   windowObject?: object,
 *   documentObject?: object,
 *   timeoutMs?: number,
 *   now?: () => number,
 *   randomUUID?: () => string,
 *   setTimeoutFn?: (callback: () => void, delay: number) => unknown,
 *   clearTimeoutFn?: (timer: unknown) => void
 * }} options
 * @returns {Promise<Array<object>>}
 */
export async function loadCourses({
  webAppUrl,
  windowObject = globalThis.window,
  documentObject = globalThis.document,
  timeoutMs = 10_000,
  now = Date.now,
  randomUUID = secureRandomUUID,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout,
} = {}) {
  const baseUrl = validateWebAppUrl(webAppUrl);
  if (!windowObject || !documentObject?.head) {
    throw new Error("loadCourses requires browser window and document objects");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("timeoutMs must be a positive finite number");
  }

  const callbackName = createCallbackName(windowObject, randomUUID);
  const requestUrl = buildCoursesUrl(baseUrl.toString(), callbackName, now());

  return new Promise((resolve, reject) => {
    let script;
    let timer;
    let settled = false;

    const cleanup = () => {
      if (timer !== undefined) {
        try {
          clearTimeoutFn(timer);
        } catch {
          // Cleanup must not replace the request's success or failure.
        }
      }
      if (script?.parentNode?.removeChild) {
        try {
          script.parentNode.removeChild(script);
        } catch {
          // Continue removing the callback even if the script node is detached.
        }
      } else if (script?.remove) {
        try {
          script.remove();
        } catch {
          // Continue removing the callback even if the script node is detached.
        }
      }
      try {
        delete windowObject[callbackName];
      } catch {
        // The property is installed as configurable; this is defensive only.
      }
    };

    const finish = (error, records) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(records);
    };

    try {
      Object.defineProperty(windowObject, callbackName, {
        configurable: true,
        enumerable: false,
        writable: true,
        value(payload) {
          try {
            finish(null, normalizeCourses(payload));
          } catch (error) {
            finish(error);
          }
        },
      });

      script = documentObject.createElement("script");
      script.async = true;
      script.src = requestUrl;
      script.onerror = () => {
        finish(new Error("Failed to load the public courses script"));
      };
      timer = setTimeoutFn(() => {
        finish(new Error("Timed out loading public courses"));
      }, timeoutMs);
      documentObject.head.appendChild(script);
    } catch (error) {
      finish(error);
    }
  });
}

function validateWebAppUrl(webAppUrl) {
  let url;
  try {
    url = new URL(webAppUrl);
  } catch {
    throw new Error(
      "webAppUrl must be an HTTPS URL ending in /exec with no query or fragment",
    );
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "script.google.com" ||
    !/^\/macros\/s\/[^/]+\/exec$/.test(url.pathname) ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error(
      "webAppUrl must be an HTTPS URL ending in /exec with no query or fragment",
    );
  }
  return url;
}

function secureRandomUUID() {
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    throw new Error("A cryptographically secure randomUUID function is required");
  }
  return globalThis.crypto.randomUUID();
}

function createCallbackName(windowObject, randomUUID) {
  if (typeof randomUUID !== "function") {
    throw new Error("A cryptographically secure randomUUID function is required");
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const uuid = randomUUID();
    if (typeof uuid !== "string" || uuid.length === 0) {
      throw new Error("randomUUID must return a non-empty string");
    }
    const suffix = uuid.replace(/[^0-9A-Za-z_$]/g, "");
    const callbackName = `__courseApiCallback_${suffix}`;
    if (!(callbackName in windowObject)) return callbackName;
  }
  throw new Error("Unable to create a unique JSONP callback identifier");
}

function normalizeCourses(payload) {
  if (!Array.isArray(payload)) {
    throw new Error("Invalid course data: expected an array");
  }

  return payload.map((course, index) => normalizeCourse(course, index));
}

function normalizeCourse(course, index) {
  const prefix = `courses[${index}]`;
  if (!course || typeof course !== "object" || Array.isArray(course)) {
    throw new Error(`Invalid course data: ${prefix} must be an object`);
  }
  if (typeof course.courseId !== "string" || !course.courseId.trim()) {
    throw new Error(`Invalid course data: ${prefix}.courseId must be a non-empty string`);
  }

  for (const field of REQUIRED_TEXT_FIELDS) {
    if (typeof course[field] !== "string") {
      throw new Error(`Invalid course data: ${prefix}.${field} must be a string`);
    }
  }

  let instructorBio;
  if (typeof course.instructorBio === "string") {
    instructorBio = course.instructorBio
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } else if (
    Array.isArray(course.instructorBio) &&
    course.instructorBio.every((line) => typeof line === "string")
  ) {
    instructorBio = [...course.instructorBio];
  } else {
    throw new Error(
      `Invalid course data: ${prefix}.instructorBio must be a string or string array`,
    );
  }

  if (
    !Array.isArray(course.outline) ||
    !course.outline.every((item) => typeof item === "string")
  ) {
    throw new Error(`Invalid course data: ${prefix}.outline must be a string array`);
  }
  if (!Array.isArray(course.pricing)) {
    throw new Error(`Invalid course data: ${prefix}.pricing must be an array`);
  }

  const pricing = course.pricing.map((item, itemIndex) => {
    const itemPrefix = `${prefix}.pricing[${itemIndex}]`;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`Invalid course data: ${itemPrefix} must be an object`);
    }
    if (typeof item.label !== "string") {
      throw new Error(`Invalid course data: ${itemPrefix}.label must be a string`);
    }
    const price =
      typeof item.price === "number"
        ? item.price
        : typeof item.price === "string" && item.price.trim() !== ""
          ? Number(item.price)
          : Number.NaN;
    if (!Number.isFinite(price)) {
      throw new Error(`Invalid course data: ${itemPrefix}.price must be a finite number`);
    }
    return { label: item.label, price };
  });

  return {
    id: course.courseId,
    title: course.title,
    date: course.date,
    startTime: course.startTime,
    endTime: course.endTime,
    location: course.location,
    mode: course.mode,
    image: course.image,
    description: course.description,
    instructor: course.instructor,
    instructorBio,
    outline: [...course.outline],
    pricing,
  };
}
