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
        recoveryDecision: recoveryDecision,
        leaderName: booking ? booking.leaderName : "",
        leaderEmail: booking ? booking.leaderEmail : "",
        courseTitle: course ? course.title : "",
      };
    });
}

/**
 * Returns the course details needed to operate the registration switch.
 *
 * @return {Array<Object>}
 */
function listAdminCourses() {
  requireAdmin_();

  return getCourses_().map(function (course) {
    var pending = findPendingCourseModeIntent_(course.courseId);
    return {
      courseId: course.courseId,
      title: course.title,
      date: course.date,
      manualRegistrationMode: course.manualRegistrationMode,
      pendingRecovery: pending ? { mode: pending.mode } : null,
    };
  });
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