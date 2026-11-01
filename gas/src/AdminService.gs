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
        request.notificationEmailStatus === "FAILED" ||
        (request.status !== "PENDING" &&
          request.notificationEmailStatus !== "SENT")
      );
    })
    .map(function (request) {
      var booking = bookings.filter(function (item) {
        return item.bookingId === request.bookingId;
      })[0];
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
    return {
      courseId: course.courseId,
      title: course.title,
      date: course.date,
      manualRegistrationMode: course.manualRegistrationMode,
    };
  });
}

/**
 * Approves or rejects one pending cancellation request, preserving all rows.
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
  var originalBookingStatus;
  var originalRequest;
  var reviewedAt = new Date().toISOString();
  var rollbackActions = [];
  lock.waitLock(30000);
  try {
    request = getCancellationRequests_().filter(function (item) {
      return item.requestId === requestId;
    })[0];
    if (!request || request.status !== "PENDING") {
      throw new Error("Only a PENDING cancellation request can be decided");
    }

    booking = getBookings_().filter(function (item) {
      return item.bookingId === request.bookingId;
    })[0];
    if (!booking || booking.status !== "CANCELLATION_PENDING") {
      throw new Error("Booking is not awaiting cancellation review");
    }
    originalBookingStatus = booking.status;
    originalRequest = {
      status: request.status,
      reviewedBy: request.reviewedBy,
      reviewedAt: request.reviewedAt,
      notificationEmailStatus: request.notificationEmailStatus,
    };

    rollbackActions.push({
      description: "Booking " + booking.bookingId,
      restore: function () {
        updateBooking_(booking.bookingId, { status: originalBookingStatus });
      },
    });
    updateBooking_(booking.bookingId, {
      status: decision === "APPROVED" ? "CANCELLED" : "SUBMITTED",
    });
    rollbackActions.push({
      description: "Cancellation request " + request.requestId,
      restore: function () {
        updateCancellationRequest_(request.requestId, {
          status: originalRequest.status,
          reviewedBy: originalRequest.reviewedBy,
          reviewedAt: originalRequest.reviewedAt,
          notificationEmailStatus: originalRequest.notificationEmailStatus,
        });
      },
    });
    updateCancellationRequest_(request.requestId, {
      status: decision,
      reviewedBy: actorEmail,
      reviewedAt: reviewedAt,
      notificationEmailStatus: "PENDING",
    });
    var auditEntry = {
      eventId: Utilities.getUuid(),
      actorEmail: actorEmail,
      action: "CANCELLATION_" + decision,
      recordId: request.requestId,
      createdAt: reviewedAt,
    };
    rollbackActions.push({
      description: "Audit event " + auditEntry.eventId,
      restore: function () {
        deleteAuditLog_(auditEntry.eventId);
      },
    });
    insertAuditLog_(auditEntry);
  } catch (error) {
    rollbackAdminWrites_("Cancellation decision", error, rollbackActions);
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
 * Opens or closes a course's registration without exposing generic sheet APIs.
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
  var originalCourseMode;
  var changedAt = new Date().toISOString();
  var rollbackActions = [];
  lock.waitLock(30000);
  try {
    course = getCourses_().filter(function (item) {
      return item.courseId === courseId;
    })[0];
    if (!course) {
      throw new Error("Course not found");
    }
    if (
      mode === "OPEN" &&
      getCourseAvailability_(course.date, new Date(), "AUTO") !== "OPEN"
    ) {
      throw new Error(
        "Cannot manually open registration after the automatic deadline",
      );
    }
    originalCourseMode = course.manualRegistrationMode;

    rollbackActions.push({
      description: "Course " + course.courseId,
      restore: function () {
        updateCourse_(course.courseId, {
          manualRegistrationMode: originalCourseMode,
        });
      },
    });
    updateCourse_(course.courseId, { manualRegistrationMode: mode });
    var auditEntry = {
      eventId: Utilities.getUuid(),
      actorEmail: actorEmail,
      action: "COURSE_REGISTRATION_" + mode,
      recordId: course.courseId,
      createdAt: changedAt,
    };
    rollbackActions.push({
      description: "Audit event " + auditEntry.eventId,
      restore: function () {
        deleteAuditLog_(auditEntry.eventId);
      },
    });
    insertAuditLog_(auditEntry);
  } catch (error) {
    rollbackAdminWrites_(
      "Course registration mode change",
      error,
      rollbackActions,
    );
  } finally {
    lock.releaseLock();
  }

  return {
    courseId: course.courseId,
    manualRegistrationMode: mode,
  };
}

/**
 * Compensates attempted writes in reverse order when a multi-sheet admin
 * operation fails. Restore actions are registered before each write because a
 * Sheets service error can occur after the write reached the spreadsheet.
 *
 * @param {string} operationName
 * @param {Error} originalError
 * @param {Array<Object>} rollbackActions
 */
function rollbackAdminWrites_(operationName, originalError, rollbackActions) {
  var rollbackFailures = [];
  for (var index = rollbackActions.length - 1; index >= 0; index--) {
    try {
      rollbackActions[index].restore();
    } catch (rollbackError) {
      rollbackFailures.push(
        rollbackActions[index].description +
          ": " +
          (rollbackError && rollbackError.message
            ? rollbackError.message
            : String(rollbackError)),
      );
    }
  }

  if (rollbackFailures.length > 0) {
    var partialCommitError = new Error(
      operationName +
        " failed and rollback was incomplete; manual reconciliation is required. " +
        "Rollback failures: " +
        rollbackFailures.join("; ") +
        ". Original error: " +
        (originalError && originalError.message
          ? originalError.message
          : String(originalError)),
    );
    partialCommitError.name = "PartialCommitError";
    partialCommitError.code = "PARTIAL_COMMIT";
    partialCommitError.rollbackFailures = rollbackFailures;
    throw partialCommitError;
  }

  throw originalError;
}
