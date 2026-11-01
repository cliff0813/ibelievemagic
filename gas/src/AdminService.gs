/**
 * Script Properties configuration used only by the management deployment.
 * Set ADMIN_EMAIL_ALLOWLIST to comma- or newline-separated administrator emails.
 * Never return this property or the management deployment URL from public APIs.
 */
var ADMIN_EMAIL_ALLOWLIST_PROPERTY_ = "ADMIN_EMAIL_ALLOWLIST";

/**
 * Resolves the accessing Google user and checks the private Script Properties
 * allowlist. Management deployment must execute as the accessing user.
 *
 * @return {string} Normalized administrator email.
 */
function requireAdmin_() {
  var activeEmail;
  try {
    activeEmail = Session.getActiveUser().getEmail();
  } catch (error) {
    throw new Error("Admin sign-in required: active user identity unavailable");
  }

  var normalizedEmail = normalizeEmail_(activeEmail);
  if (!normalizedEmail) {
    throw new Error("Admin sign-in required: active user email unavailable");
  }

  var allowlist;
  try {
    allowlist = PropertiesService.getScriptProperties().getProperty(
      ADMIN_EMAIL_ALLOWLIST_PROPERTY_,
    );
  } catch (error) {
    throw new Error("Admin access denied: allowlist configuration unavailable");
  }

  var allowedEmails =
    typeof allowlist === "string"
      ? allowlist
          .split(/[,\n;]/)
          .map(function (email) {
            return normalizeEmail_(email);
          })
          .filter(function (email) {
            return email !== "";
          })
      : [];
  if (allowedEmails.indexOf(normalizedEmail) < 0) {
    throw new Error("Admin access denied: identity is not allowlisted");
  }

  return normalizedEmail;
}

/**
 * Returns explicitly selected booking fields for the restricted admin UI.
 *
 * @return {Array<Object>}
 */
function listAdminBookings() {
  requireAdmin_();

  var bookings = getBookings_();
  var participants = getParticipants_();
  var courses = getCourses_();
  return bookings.map(function (booking) {
    var course = courses.filter(function (item) {
      return item.courseId === booking.courseId;
    })[0];
    return {
      bookingId: booking.bookingId,
      courseId: booking.courseId,
      courseTitle: course ? course.title : "",
      courseDate: booking.courseDate,
      leaderName: booking.leaderName,
      leaderPhone: booking.leaderPhone,
      leaderEmail: booking.leaderEmail,
      status: booking.status,
      createdAt: booking.createdAt,
      confirmationEmailStatus: booking.confirmationEmailStatus,
      participants: participants
        .filter(function (participant) {
          return participant.bookingId === booking.bookingId;
        })
        .map(function (participant) {
          return {
            name: participant.name,
            phone: participant.phone,
            email: participant.email,
            lineName: participant.lineName,
          };
        }),
    };
  });
}

/**
 * Returns open cancellation reviews and any completed review needing a
 * notification follow-up. Lookup codes and unrelated booking data are omitted.
 *
 * @return {Array<Object>}
 */
function listAdminCancellationRequests() {
  requireAdmin_();

  var bookings = getBookings_();
  var courses = getCourses_();
  return getCancellationRequests_()
    .filter(function (request) {
      return (
        request.status === "PENDING" ||
        CANCELLATION_IN_FLIGHT_DECISIONS_[request.status] ||
        request.notificationEmailStatus === "FAILED" ||
        (request.status !== "PENDING" &&
          request.notificationEmailStatus !== "SENT")
      );
    })
    .map(function (request) {
      var booking = bookings.filter(function (item) {
        return item.bookingId === request.bookingId;
      })[0];
      var recoveryDecision =
        CANCELLATION_IN_FLIGHT_DECISIONS_[request.status] ||
        ((request.status === "APPROVED" || request.status === "REJECTED") &&
        request.notificationEmailStatus === "PENDING"
          ? request.status
          : "");
      var course = booking
        ? courses.filter(function (item) {
            return item.courseId === booking.courseId;
          })[0]
        : null;
      return {
        requestId: request.requestId,
        bookingId: request.bookingId,
        reason: request.reason,
        status: request.status,
        requestedAt: request.requestedAt,
        reviewedAt: request.reviewedAt,
        notificationEmailStatus: request.notificationEmailStatus,
        needsRecovery: !!recoveryDecision,
        needsCreationRecovery:
          request.status === "PENDING" &&
          !!booking &&
          booking.status === "SUBMITTED",
        notificationInProgress: request.notificationEmailStatus === "SENDING",
        recoveryDecision: recoveryDecision,
        leaderName: booking ? booking.leaderName : "",
        leaderEmail: booking ? booking.leaderEmail : "",
        courseTitle: course ? course.title : "",
      };
    });
}

/**
 * Completes a cancellation creation that stopped after its PENDING request was
 * persisted but before the booking became CANCELLATION_PENDING. Idempotent: it
 * never inserts rows, and repeating it once recovered is a no-op.
 *
 * @param {string} requestId
 * @return {{success:boolean,status:string,message:string}}
 */
function recoverAdminCancellationCreation(requestId) {
  requireAdmin_();
  if (typeof requestId !== "string" || requestId.trim() === "") {
    throw new Error("Cancellation request ID is required");
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var request = getCancellationRequests_().filter(function (item) {
      return item.requestId === requestId;
    })[0];
    if (!request) {
      throw new Error("Cancellation request not found");
    }
    if (request.status !== "PENDING") {
      throw new Error("Only a PENDING cancellation request can be recovered");
    }
    var booking = getBookings_().filter(function (item) {
      return item.bookingId === request.bookingId;
    })[0];
    if (
      !booking ||
      (booking.status !== "SUBMITTED" &&
        booking.status !== "CANCELLATION_PENDING")
    ) {
      throw new Error("Booking is not in a recoverable state for this request");
    }
    completeCancellationCreation_(booking);
    return {
      success: true,
      status: "CANCELLATION_PENDING",
      message: "Cancellation request creation completed",
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Returns editable course fields and ordered child content without booking data.
 *
 * @return {Array<Object>}
 */
function listAdminCourses() {
  requireAdmin_();

  var outlines = getSheetRecords_("CourseOutline");
  var pricing = getSheetRecords_("CoursePricing");
  var persistedIds = {};
  getPersistedAdminCourses_().forEach(function (course) {
    persistedIds[course.courseId] = true;
  });
  return getCourses_().map(function (course) {
    var pending = findPendingCourseModeIntent_(course.courseId);
    return {
      persisted: persistedIds[course.courseId] === true,
      courseId: course.courseId,
      title: course.title,
      date: course.date,
      startTime: course.startTime,
      endTime: course.endTime,
      location: course.location,
      mode: course.mode,
      image: course.image,
      manualRegistrationMode: course.manualRegistrationMode,
      description: course.description,
      instructor: course.instructor,
      instructorBio: course.instructorBio,
      outline: outlines
        .filter(function (item) {
          return item.courseId === course.courseId;
        })
        .sort(adminCourseContentOrder_)
        .map(function (item) {
          return item.item;
        }),
      pricing: pricing
        .filter(function (item) {
          return item.courseId === course.courseId;
        })
        .sort(adminCourseContentOrder_)
        .map(function (item) {
          return { label: item.label, price: item.price };
        }),
      pendingRecovery: pending ? { mode: pending.mode } : null,
    };
  });
}

/**
 * Creates a course and its linked content. The parent row is appended last so
 * the public course list cannot expose a course before its content is ready.
 *
 * @param {*} payload
 * @return {{courseId:string}}
 */
function createAdminCourse(payload) {
  requireAdmin_();
  var courseId =
    payload && typeof payload.courseId === "string"
      ? payload.courseId.trim()
      : "";
  var lock = LockService.getScriptLock();
  var acquired = false;
  try {
    lock.waitLock(30000);
    acquired = true;
    var normalized = normalizeAdminCoursePayload_(payload, courseId, "AUTO");
    var existing = getPersistedAdminCourses_().filter(function (course) {
      return course.courseId === courseId;
    });
    if (existing.length > 1) {
      throw new Error("Course ID is not unique");
    }
    if (
      existing.length === 1 &&
      !adminCourseBaseFieldsMatch_(existing[0], normalized.course)
    ) {
      throw new Error("A different course already exists with this course ID");
    }

    if (
      existing.length === 1 &&
      !adminCourseContentMatches_(courseId, normalized)
    ) {
      throw new Error(
        "A different course already exists with this course ID and linked content",
      );
    }
    if (existing.length === 1) {
      return { courseId: courseId };
    }

    replaceAdminCourseContent_(courseId, normalized);
    appendSheetRecords_("Courses", [normalized.course]);
    return { courseId: courseId };
  } catch (error) {
    throw adminCourseOperationError_("create", courseId, error);
  } finally {
    if (acquired) {
      lock.releaseLock();
    }
  }
}

/**
 * Updates a course and converges its bookings and linked content to the
 * requested state. Course ID and registration mode remain server-controlled.
 *
 * @param {string} courseId
 * @param {*} payload
 * @return {{courseId:string}}
 */
function updateAdminCourse(courseId, payload) {
  requireAdmin_();
  var normalizedId = typeof courseId === "string" ? courseId.trim() : "";
  var lock = LockService.getScriptLock();
  var acquired = false;
  try {
    lock.waitLock(30000);
    acquired = true;
    if (!normalizedId) {
      throw new Error("Course ID is required");
    }
    var current = getPersistedAdminCourses_().filter(function (course) {
      return course.courseId === normalizedId;
    })[0];
    if (!current) {
      throw new Error("Course not found");
    }

    var normalized = normalizeAdminCoursePayload_(
      payload,
      normalizedId,
      current.manualRegistrationMode,
    );
    if (current.date !== normalized.course.date) {
      getBookings_().forEach(function (booking) {
        if (
          booking.courseId === normalizedId &&
          booking.courseDate !== normalized.course.date
        ) {
          updateBooking_(booking.bookingId, {
            courseDate: normalized.course.date,
          });
        }
      });
      updateSheetRecordsByValue_(
        "Participants",
        "courseId",
        normalizedId,
        { courseDate: normalized.course.date },
      );
    }
    replaceAdminCourseContent_(normalizedId, normalized);
    var courseUpdates = {};
    ADMIN_COURSE_EDITABLE_FIELDS_.forEach(function (field) {
      if (field !== "courseId") {
        courseUpdates[field] = normalized.course[field];
      }
    });
    updateCourse_(normalizedId, courseUpdates);
    return { courseId: normalizedId };
  } catch (error) {
    throw adminCourseOperationError_("update", normalizedId, error);
  } finally {
    if (acquired) {
      lock.releaseLock();
    }
  }
}

/**
 * Deletes a course only when no booking in any status references it. A retry
 * after partial deletion removes remaining linked rows before the parent.
 *
 * @param {string} courseId
 * @return {{courseId:string}}
 */
function deleteAdminCourse(courseId) {
  requireAdmin_();
  var normalizedId = typeof courseId === "string" ? courseId.trim() : "";
  var lock = LockService.getScriptLock();
  var acquired = false;
  try {
    lock.waitLock(30000);
    acquired = true;
    if (!normalizedId) {
      throw new Error("Course ID is required");
    }
    if (
      getBookings_().some(function (booking) {
        return booking.courseId === normalizedId;
      })
    ) {
      throw new Error("Course cannot be deleted while bookings reference it");
    }

    var course = getPersistedAdminCourses_().filter(function (item) {
      return item.courseId === normalizedId;
    })[0];
    if (
      !course &&
      FALLBACK_COURSES.some(function (item) {
        return fallbackCourseId_(item) === normalizedId;
      })
    ) {
      throw new Error("Course not found");
    }
    var hasOutline = getSheetRecords_("CourseOutline").some(function (item) {
      return item.courseId === normalizedId;
    });
    var hasPricing = getSheetRecords_("CoursePricing").some(function (item) {
      return item.courseId === normalizedId;
    });
    if (!course && !hasOutline && !hasPricing) {
      return { courseId: normalizedId };
    }

    deleteSheetRecordsByValue_("CourseOutline", "courseId", normalizedId);
    deleteSheetRecordsByValue_("CoursePricing", "courseId", normalizedId);
    if (course) {
      deleteSheetRecordsByValue_("Courses", "courseId", normalizedId);
    }
    return { courseId: normalizedId };
  } catch (error) {
    throw adminCourseOperationError_("delete", normalizedId, error);
  } finally {
    if (acquired) {
      lock.releaseLock();
    }
  }
}

/**
 * Reads only Courses sheet rows. CRUD targets and duplicate checks must never
 * treat virtual FALLBACK_COURSES as persisted records.
 */
function getPersistedAdminCourses_() {
  return getSheetRecords_("Courses")
    .filter(function (course) {
      return (
        typeof course.courseId === "string" && course.courseId.trim() !== ""
      );
    })
    .map(function (course) {
      if (
        course.date &&
        Object.prototype.toString.call(course.date) === "[object Date]" &&
        isFinite(course.date.getTime())
      ) {
        course.date = Utilities.formatDate(course.date, "Asia/Taipei", "yyyy-MM-dd");
      }
      return normalizeCourse_(course);
    });
}

var ADMIN_COURSE_EDITABLE_FIELDS_ = [
  "courseId",
  "title",
  "date",
  "startTime",
  "endTime",
  "location",
  "mode",
  "image",
  "description",
  "instructor",
  "instructorBio",
];

/**
 * Validates and normalizes the editable course form before any sheet mutation.
 *
 * @param {*} payload
 * @param {string} courseId
 * @param {string} manualRegistrationMode
 * @return {{course:Object,outline:Array<Object>,pricing:Array<Object>}}
 */
function normalizeAdminCoursePayload_(payload, courseId, manualRegistrationMode) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Course payload must be an object");
  }
  if (!courseId) {
    throw new Error("Course ID is required");
  }
  if (courseId.charAt(0) === "=") {
    throw new Error("Course ID cannot begin with = because it is formula-escaped");
  }
  ["title", "date", "startTime", "endTime"].forEach(function (field) {
    if (!isNonEmptyString_(payload[field])) {
      throw new Error("Course " + field + " is required");
    }
  });
  if (!isValidCourseDate_(payload.date)) {
    throw new Error("Course date must be a valid YYYY-MM-DD calendar date");
  }
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(payload.startTime)) {
    throw new Error("Course startTime must be a valid 24-hour HH:mm time");
  }
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(payload.endTime)) {
    throw new Error("Course endTime must be a valid 24-hour HH:mm time");
  }
  if (!Array.isArray(payload.outline)) {
    throw new Error("Course outline must be an array");
  }
  if (!Array.isArray(payload.pricing)) {
    throw new Error("Course pricing must be an array");
  }
  var outline = payload.outline.map(function (item) {
    if (typeof item !== "string" || item.trim() === "") {
      throw new Error("Every course outline item must be a nonempty string");
    }
    return item.trim();
  });
  var pricing = payload.pricing.map(function (item) {
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item) ||
      typeof item.label !== "string" ||
      item.label.trim() === ""
    ) {
      throw new Error("Every course pricing item must have a nonempty label");
    }
    if (typeof item.price !== "number" || !isFinite(item.price)) {
      throw new Error("Every course price must be a finite number");
    }
    return { label: item.label.trim(), price: item.price };
  });

  var normalizedCourse = {
    courseId: courseId,
    manualRegistrationMode: manualRegistrationMode || "AUTO",
  };
  ["title", "date", "startTime", "endTime"].forEach(function (field) {
    normalizedCourse[field] = payload[field].trim();
  });
  ["location", "mode", "image", "description", "instructor", "instructorBio"]
    .forEach(function (field) {
      var value = payload[field];
      normalizedCourse[field] =
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
          ? String(value)
          : "";
    });
  if (
    normalizedCourse.image !== "" &&
    !isAbsoluteAdminCourseImageUrl_(normalizedCourse.image)
  ) {
    throw new Error("Course image must be a complete absolute HTTP(S) URL");
  }

  return {
    course: normalizedCourse,
    outline: outline.map(function (item, index) {
      return { courseId: courseId, sortOrder: index + 1, item: item };
    }),
    pricing: pricing.map(function (item, index) {
      return {
        courseId: courseId,
        sortOrder: index + 1,
        label: item.label,
        price: item.price,
      };
    }),
  };
}

function isAbsoluteAdminCourseImageUrl_(value) {
  if (
    value !== value.trim() ||
    /[\s\\\u0000-\u001f\u007f]/.test(value)
  ) {
    return false;
  }
  var match = /^https?:\/\/([^/?#]+)(?:[/?#][^\s]*)?$/i.exec(value);
  if (!match || match[1].indexOf("@") >= 0) {
    return false;
  }

  var authority = match[1];
  var hostname;
  var port = "";
  var hasPort = false;
  if (authority.charAt(0) === "[") {
    var closeBracket = authority.indexOf("]");
    if (closeBracket < 0) {
      return false;
    }
    hostname = authority.slice(1, closeBracket);
    var remainder = authority.slice(closeBracket + 1);
    if (remainder !== "") {
      if (remainder.charAt(0) !== ":") {
        return false;
      }
      hasPort = true;
      port = remainder.slice(1);
    }
    if (!isValidAdminCourseIpv6_(hostname)) {
      return false;
    }
  } else {
    var colon = authority.lastIndexOf(":");
    if (colon >= 0) {
      if (authority.indexOf(":") !== colon) {
        return false;
      }
      hasPort = true;
      hostname = authority.slice(0, colon);
      port = authority.slice(colon + 1);
    } else {
      hostname = authority;
    }
    if (!isValidAdminCourseHostname_(hostname)) {
      return false;
    }
  }

  return (
    !hasPort ||
    (/^\d{1,5}$/.test(port) && Number(port) <= 65535)
  );
}

function isValidAdminCourseHostname_(hostname) {
  if (
    hostname === "" ||
    hostname.length > 253 ||
    hostname.indexOf("%") >= 0
  ) {
    return false;
  }
  if (/^\d+(?:\.\d+){3}$/.test(hostname)) {
    return hostname.split(".").every(function (part) {
      return Number(part) <= 255;
    });
  }

  var normalized = hostname.charAt(hostname.length - 1) === "."
    ? hostname.slice(0, -1)
    : hostname;
  if (normalized === "") {
    return false;
  }
  return normalized.split(".").every(function (label) {
    return (
      label.length <= 63 &&
      /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label)
    );
  });
}

function isValidAdminCourseIpv6_(hostname) {
  if (
    hostname.indexOf(":") < 0 ||
    !/^[0-9A-Fa-f:.]+$/.test(hostname)
  ) {
    return false;
  }
  var compressionIndex = hostname.indexOf("::");
  var compressed = compressionIndex >= 0;
  if (
    compressed &&
    compressionIndex !== hostname.lastIndexOf("::")
  ) {
    return false;
  }
  var groups;
  var leftGroups = [];
  if (compressed) {
    var left = hostname.slice(0, compressionIndex);
    var right = hostname.slice(compressionIndex + 2);
    leftGroups = left ? left.split(":") : [];
    groups = leftGroups.concat(right ? right.split(":") : []);
  } else {
    groups = hostname.split(":");
  }
  if (groups.some(function (group) { return group === ""; })) {
    return false;
  }
  var count = 0;
  for (var index = 0; index < groups.length; index += 1) {
    if (groups[index].indexOf(".") >= 0) {
      if (
        index !== groups.length - 1 ||
        (compressed && index < leftGroups.length) ||
        !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(groups[index]) ||
        groups[index].split(".").some(function (part) {
          return Number(part) > 255;
        })
      ) {
        return false;
      }
      count += 2;
    } else {
      if (!/^[0-9A-Fa-f]{1,4}$/.test(groups[index])) {
        return false;
      }
      count += 1;
    }
  }
  return compressed ? count < 8 : count === 8;
}

function replaceAdminCourseContent_(courseId, normalized) {
  replaceSheetRecordsByValue_(
    "CourseOutline",
    "courseId",
    courseId,
    normalized.outline,
  );
  replaceSheetRecordsByValue_(
    "CoursePricing",
    "courseId",
    courseId,
    normalized.pricing,
  );
}

function adminCourseContentMatches_(courseId, normalized) {
  return [
    ["CourseOutline", normalized.outline],
    ["CoursePricing", normalized.pricing],
  ].every(function (entry) {
    var existing = getSheetRecords_(entry[0])
      .filter(function (record) {
        return record.courseId === courseId;
      })
      .sort(adminCourseContentOrder_);
    var requested = entry[1];
    return (
      existing.length === requested.length &&
      existing.every(function (record, index) {
        return Object.keys(requested[index]).every(function (field) {
          return (
            record[field] === requested[index][field] ||
            record[field] === escapeSheetValue_(requested[index][field])
          );
        });
      })
    );
  });
}

function adminCourseBaseFieldsMatch_(existing, requested) {
  return ADMIN_COURSE_EDITABLE_FIELDS_.every(function (field) {
    return (
      existing[field] === requested[field] ||
      existing[field] === escapeSheetValue_(requested[field])
    );
  });
}

function adminCourseOperationError_(operation, courseId, cause) {
  var message =
    operation +
    " course " +
    (courseId || "(unknown)") +
    " failed: " +
    (cause && cause.message ? cause.message : String(cause));
  var error = new Error(message);
  error.name = "AdminCourseOperationError";
  error.code = "ADMIN_COURSE_" + operation.toUpperCase() + "_FAILED";
  error.operation = operation;
  error.courseId = courseId || "";
  error.cause = cause;
  return error;
}

function adminCourseContentOrder_(left, right) {
  return Number(left.sortOrder) - Number(right.sortOrder);
}

var CANCELLATION_IN_FLIGHT_DECISIONS_ = {
  APPROVING: "APPROVED",
  REJECTING: "REJECTED",
};

/**
 * Builds the explicit error returned when a multi-sheet admin operation stopped
 * after its durable intent was recorded. Google Sheets has no cross-sheet
 * transaction, so nothing is rolled back: the same operation is resumed
 * idempotently instead.
 */
function recoveryRequiredError_(operationName, cause) {
  var error = new Error(
    operationName +
      " was recorded but not fully applied; it is in-flight and must be resumed " +
      "by repeating the same action. Cause: " +
      (cause && cause.message ? cause.message : String(cause)),
  );
  error.name = "RecoveryRequiredError";
  error.code = "RECOVERY_REQUIRED";
  return error;
}

/**
 * Approves or rejects one pending cancellation request, preserving all rows.
 *
 * Sheets offers no cross-sheet transaction, so the decision is first recorded
 * durably on the request as an in-flight intent (status APPROVING/REJECTING).
 * Every later step (booking status, one audit row with a stable event ID, final
 * request status) is idempotent. If any step fails the intent stays in place
 * and repeating the same decision resumes it; a different decision is refused.
 *
 * @param {string} requestId
 * @param {"APPROVED"|"REJECTED"} decision
 * @return {{success:boolean,status:string,notificationEmailStatus:string,message:string}}
 */
function decideAdminCancellation(requestId, decision) {
  var actorEmail = requireAdmin_();
  if (decision !== "APPROVED" && decision !== "REJECTED") {
    throw new Error("Cancellation decision must be APPROVED or REJECTED");
  }
  if (typeof requestId !== "string" || requestId.trim() === "") {
    throw new Error("Cancellation request ID is required");
  }

  var lock = LockService.getScriptLock();
  var request;
  var booking;
  var reviewedBy = actorEmail;
  var reviewedAt = new Date().toISOString();
  var intentStatus = decision === "APPROVED" ? "APPROVING" : "REJECTING";
  lock.waitLock(30000);
  try {
    request = getCancellationRequests_().filter(function (item) {
      return item.requestId === requestId;
    })[0];
    if (!request) {
      throw new Error("Cancellation request not found");
    }

    var inFlightDecision = CANCELLATION_IN_FLIGHT_DECISIONS_[request.status];
    if (inFlightDecision) {
      if (inFlightDecision !== decision) {
        throw new Error(
          "Cancellation request has an in-flight " +
            inFlightDecision +
            " decision that must be resumed first; it cannot be changed to " +
            decision,
        );
      }
      // Resume: keep the original reviewer and timestamp of the intent.
      reviewedBy = request.reviewedBy || actorEmail;
      reviewedAt = request.reviewedAt || reviewedAt;
      booking = getBookings_().filter(function (item) {
        return item.bookingId === request.bookingId;
      })[0];
    } else if (request.status === "PENDING") {
      booking = getBookings_().filter(function (item) {
        return item.bookingId === request.bookingId;
      })[0];
      if (!booking || booking.status !== "CANCELLATION_PENDING") {
        throw new Error("Booking is not awaiting cancellation review");
      }
      try {
        updateCancellationRequest_(request.requestId, {
          status: intentStatus,
          reviewedBy: reviewedBy,
          reviewedAt: reviewedAt,
          notificationEmailStatus: "PENDING",
        });
      } catch (error) {
        // The write may have reached the sheet before the service errored, so
        // the intent might exist; the caller must repeat the same decision.
        throw recoveryRequiredError_("Cancellation decision", error);
      }
    } else if (
      request.status === decision &&
      request.notificationEmailStatus === "PENDING"
    ) {
      // The final request write landed but the notification step did not
      // complete; resume to finish idempotently and send the notification.
      reviewedBy = request.reviewedBy || actorEmail;
      reviewedAt = request.reviewedAt || reviewedAt;
      booking = getBookings_().filter(function (item) {
        return item.bookingId === request.bookingId;
      })[0];
    } else if (
      request.status === decision &&
      request.notificationEmailStatus === "SENDING"
    ) {
      // Another invocation claimed the notification. MailApp may or may not
      // have delivered it, so never send again; surface it for manual follow-up.
      return {
        success: false,
        status: decision,
        notificationEmailStatus: "SENDING",
        message:
          "Cancellation decision is saved, but its notification is in progress or " +
          "its delivery is uncertain (an earlier attempt may have been interrupted); " +
          "it was not resent. Check with the leader manually before any follow-up",
      };
    } else {
      throw new Error("Only a PENDING cancellation request can be decided");
    }

    try {
      var targetBookingStatus =
        decision === "APPROVED" ? "CANCELLED" : "SUBMITTED";
      if (!booking) {
        throw new Error("Booking for the cancellation request was not found");
      }
      if (
        booking.status !== "CANCELLATION_PENDING" &&
        booking.status !== targetBookingStatus
      ) {
        throw new Error(
          "Booking status " +
            booking.status +
            " is inconsistent with the in-flight decision",
        );
      }
      if (booking.status !== targetBookingStatus) {
        updateBooking_(booking.bookingId, { status: targetBookingStatus });
      }

      var auditEventId = "cancellation:" + request.requestId + ":" + decision;
      var auditExists = getAuditLogs_().some(function (entry) {
        return entry.eventId === auditEventId;
      });
      if (!auditExists) {
        insertAuditLog_({
          eventId: auditEventId,
          actorEmail: reviewedBy,
          action: "CANCELLATION_" + decision,
          recordId: request.requestId,
          createdAt: reviewedAt,
        });
      }

      updateCancellationRequest_(request.requestId, {
        status: decision,
        reviewedBy: reviewedBy,
        reviewedAt: reviewedAt,
        notificationEmailStatus: "PENDING",
      });
      // At-most-once claim, persisted while the Script Lock is still held. Only
      // the invocation that writes SENDING may call MailApp. If this write
      // fails, nothing was sent; the same decision can be repeated safely.
      updateCancellationRequest_(request.requestId, {
        notificationEmailStatus: "SENDING",
      });
    } catch (error) {
      throw recoveryRequiredError_("Cancellation decision", error);
    }
  } finally {
    lock.releaseLock();
  }

  var notificationStatus = "SENT";
  try {
    MailApp.sendEmail({
      to: booking.leaderEmail,
      subject:
        decision === "APPROVED" ? "課程取消申請已核准" : "課程取消申請未核准",
      body:
        decision === "APPROVED"
          ? "您的課程取消申請已核准。"
          : "您的課程取消申請未核准，原報名仍有效。",
    });
  } catch (error) {
    notificationStatus = "FAILED";
  }

  updateCancellationRequest_(request.requestId, {
    notificationEmailStatus: notificationStatus,
  });
  return {
    success: true,
    status: decision,
    notificationEmailStatus: notificationStatus,
    message:
      notificationStatus === "SENT"
        ? "Cancellation decision saved and leader notified"
        : "Cancellation decision saved, but notification failed; follow up is required",
  };
}

/**
 * Returns the not-yet-completed course mode change journaled in AuditLog, if
 * any. An intent row (action COURSE_REGISTRATION_<MODE>_INTENT) is complete once
 * a row with eventId "<intentEventId>:applied" exists.
 *
 * @param {string} courseId
 * @return {?{eventId:string,actorEmail:string,createdAt:string,mode:string}}
 */
function findPendingCourseModeIntent_(courseId) {
  var logs = getAuditLogs_();
  var applied = {};
  logs.forEach(function (entry) {
    applied[entry.eventId] = true;
  });
  var intent = logs.filter(function (entry) {
    return (
      entry.recordId === courseId &&
      /^COURSE_REGISTRATION_(OPEN|CLOSED)_INTENT$/.test(entry.action) &&
      !applied[entry.eventId + ":applied"]
    );
  })[0];
  return intent
    ? {
        eventId: intent.eventId,
        actorEmail: intent.actorEmail,
        createdAt: intent.createdAt,
        mode: intent.action.split("_")[2],
      }
    : null;
}

/**
 * Opens or closes a course's registration without exposing generic sheet APIs.
 *
 * The change is journaled in AuditLog first (an INTENT row), then applied, then
 * finalized with exactly one audit event whose ID derives from the intent. A
 * failure after the intent leaves it pending; repeating the same mode resumes
 * it idempotently and a different mode is refused until it is resumed.
 *
 * @param {string} courseId
 * @param {"OPEN"|"CLOSED"} mode
 * @return {Object}
 */
function setCourseRegistrationMode(courseId, mode) {
  var actorEmail = requireAdmin_();
  if (typeof courseId !== "string" || courseId.trim() === "") {
    throw new Error("Course ID is required");
  }
  if (mode !== "OPEN" && mode !== "CLOSED") {
    throw new Error("Registration mode must be OPEN or CLOSED");
  }

  var lock = LockService.getScriptLock();
  var course;
  lock.waitLock(30000);
  try {
    course = getCourses_().filter(function (item) {
      return item.courseId === courseId;
    })[0];
    if (!course) {
      throw new Error("Course not found");
    }

    var intent = findPendingCourseModeIntent_(course.courseId);
    if (!intent && course.manualRegistrationMode === mode) {
      // Already applied and finalized (for example by a resumed attempt): no-op.
      return { courseId: course.courseId, manualRegistrationMode: mode };
    }
    if (intent) {
      if (intent.mode !== mode) {
        throw new Error(
          "Course has an in-flight " +
            intent.mode +
            " registration change that must be resumed first; it cannot be changed to " +
            mode,
        );
      }
    } else {
      if (
        mode === "OPEN" &&
        getCourseAvailability_(course.date, new Date(), "AUTO") !== "OPEN"
      ) {
        throw new Error(
          "Cannot manually open registration after the automatic deadline",
        );
      }
      intent = {
        eventId: "course-mode:" + Utilities.getUuid(),
        actorEmail: actorEmail,
        createdAt: new Date().toISOString(),
        mode: mode,
      };
      try {
        insertAuditLog_({
          eventId: intent.eventId,
          actorEmail: intent.actorEmail,
          action: "COURSE_REGISTRATION_" + mode + "_INTENT",
          recordId: course.courseId,
          createdAt: intent.createdAt,
        });
      } catch (error) {
        throw recoveryRequiredError_("Course registration mode change", error);
      }
    }

    try {
      if (course.manualRegistrationMode !== mode) {
        updateCourse_(course.courseId, { manualRegistrationMode: mode });
      }
      var appliedEventId = intent.eventId + ":applied";
      var applied = getAuditLogs_().some(function (entry) {
        return entry.eventId === appliedEventId;
      });
      if (!applied) {
        insertAuditLog_({
          eventId: appliedEventId,
          actorEmail: intent.actorEmail,
          action: "COURSE_REGISTRATION_" + mode,
          recordId: course.courseId,
          createdAt: intent.createdAt,
        });
      }
    } catch (error) {
      throw recoveryRequiredError_("Course registration mode change", error);
    }
  } finally {
    lock.releaseLock();
  }

  return {
    courseId: course.courseId,
    manualRegistrationMode: mode,
  };
}