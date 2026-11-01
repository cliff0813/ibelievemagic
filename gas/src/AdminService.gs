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
  var reviewedAt = new Date().toISOString();
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

    updateBooking_(booking.bookingId, {
      status: decision === "APPROVED" ? "CANCELLED" : "SUBMITTED",
    });
    updateCancellationRequest_(request.requestId, {
      status: decision,
      reviewedBy: actorEmail,
      reviewedAt: reviewedAt,
      notificationEmailStatus: "PENDING",
    });
    insertAuditLog_({
      eventId: Utilities.getUuid(),
      actorEmail: actorEmail,
      action: "CANCELLATION_" + decision,
      recordId: request.requestId,
      createdAt: reviewedAt,
    });
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
  var changedAt = new Date().toISOString();
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

    updateCourse_(course.courseId, { manualRegistrationMode: mode });
    insertAuditLog_({
      eventId: Utilities.getUuid(),
      actorEmail: actorEmail,
      action: "COURSE_REGISTRATION_" + mode,
      recordId: course.courseId,
      createdAt: changedAt,
    });
  } finally {
    lock.releaseLock();
  }

  return {
    courseId: course.courseId,
    manualRegistrationMode: mode,
  };
}
