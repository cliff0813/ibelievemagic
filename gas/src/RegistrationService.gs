function submitBooking(payload) {
  var validation = validateBookingInput_(payload);
  if (
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    payload.consentAccepted !== true
  ) {
    validation.valid = false;
    validation.errors.push("CONSENT_REQUIRED");
  }
  if (!validation.valid) {
    return {
      success: false,
      errors: validation.errors,
      message: "",
    };
  }

  var bookingId = Utilities.getUuid();
  var lookupCode = Utilities.getUuid();
  var lock = LockService.getScriptLock();
  var confirmationEmailStatus = "";
  var confirmationEmailStatusRecorded = true;
  var confirmationEmailStatusError = null;
  var sendConfirmationEmail = false;
  lock.waitLock(30000);
  try {
    var course = getCourses_().filter(function (item) {
      return item.courseId === payload.courseId;
    })[0];
    if (!course || course.date !== payload.courseDate) {
      throw new Error("Course or course date not found");
    }
    if (
      getCourseAvailability_(
        course.date,
        new Date(),
        course.manualRegistrationMode,
      ) !== "OPEN"
    ) {
      throw new Error("Registration is closed for this course");
    }

    var bookings = getBookings_();
    var existingParticipants = getParticipants_().map(function (participant) {
      var booking = bookings.filter(function (item) {
        return item.bookingId === participant.bookingId;
      })[0];
      return Object.assign({}, participant, {
        bookingStatus: booking ? booking.status : participant.bookingStatus,
      });
    });
    var duplicate = payload.participants.some(function (participant) {
      return isExistingDuplicate_(
        payload.courseId,
        payload.courseDate,
        participant,
        existingParticipants,
      );
    });
    if (duplicate) {
      throw new Error("Duplicate registration: this contact is already registered");
    }

    var booking = {
      bookingId: bookingId,
      lookupCode: lookupCode,
      courseId: payload.courseId,
      courseDate: payload.courseDate,
      leaderName: payload.leaderName,
      leaderPhone: payload.leaderPhone,
      leaderEmail: payload.leaderEmail,
      status: "PROCESSING",
      createdAt: new Date().toISOString(),
      confirmationEmailStatus: "PENDING",
    };

    try {
      insertBooking_(booking);
      insertParticipants_(
        payload.participants.map(function (participant) {
          return {
            bookingId: bookingId,
            courseId: payload.courseId,
            courseDate: payload.courseDate,
            name: participant.name,
            phone: participant.phone,
            email: participant.email,
            lineName: participant.lineName || "",
          };
        }),
      );
      updateBooking_(bookingId, { status: "SUBMITTED" });
    } catch (error) {
      try {
        updateBooking_(bookingId, { status: "FAILED" });
      } catch (markError) {
        throw new Error(
          "Registration persistence failed: " +
            error.message +
            "; could not mark booking FAILED: " +
            markError.message,
        );
      }
      throw new Error("Registration persistence failed: " + error.message);
    }

    var reservation = reserveConfirmationEmailAttempt_(payload.leaderEmail);
    if (reservation === "RESERVED") {
      sendConfirmationEmail = true;
    } else {
      confirmationEmailStatus = reservation;
      try {
        updateBooking_(bookingId, {
          confirmationEmailStatus: confirmationEmailStatus,
        });
      } catch (statusError) {
        confirmationEmailStatusRecorded = false;
        confirmationEmailStatusError = statusError;
      }
    }
  } finally {
    lock.releaseLock();
  }

  if (sendConfirmationEmail) {
    confirmationEmailStatus = "SENT";
    try {
      MailApp.sendEmail({
        to: payload.leaderEmail,
        subject: "課程報名確認",
        body:
          "您的報名已完成。\n報名查詢代碼：" +
          lookupCode +
          "\n請保存此代碼以查詢或申請取消。",
      });
    } catch (mailError) {
      confirmationEmailStatus = "FAILED";
    }

    var statusLock = null;
    try {
      statusLock = LockService.getScriptLock();
      statusLock.waitLock(30000);
      updateBooking_(bookingId, {
        confirmationEmailStatus: confirmationEmailStatus,
      });
    } catch (error) {
      confirmationEmailStatusRecorded = false;
      confirmationEmailStatusError = error;
    } finally {
      if (statusLock) {
        try {
          statusLock.releaseLock();
        } catch (releaseError) {}
      }
    }
  }

  var messages = {
    SENT: "Registration submitted",
    FAILED:
      "Registration submitted, but confirmation email delivery failed",
    RATE_LIMITED:
      "Registration submitted. Confirmation email was suppressed by the hourly rate limit; please copy and save your lookup code.",
    RATE_LIMIT_UNAVAILABLE:
      "Registration submitted. The email rate limit could not be checked, so confirmation email was not sent; please copy and save your lookup code.",
  };
  var message = messages[confirmationEmailStatus];
  if (!confirmationEmailStatusRecorded) {
    message +=
      ". Warning: confirmation email status could not be recorded: " +
      confirmationEmailStatusError.message +
      ". Please save the lookup code.";
  }
  return {
    success: true,
    lookupCode: lookupCode,
    confirmationEmailStatus: confirmationEmailStatus,
    confirmationEmailStatusRecorded: confirmationEmailStatusRecorded,
    message: message,
  };
}

function reserveConfirmationEmailAttempt_(leaderEmail) {
  var windowMilliseconds = 60 * 60 * 1000;
  try {
    var normalizedEmail = normalizeEmail_(leaderEmail);
    var digest = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      normalizedEmail,
    );
    var emailHash = Utilities.base64EncodeWebSafe(digest).replace(/=+$/g, "");
    var cacheKey = "confirmation-email:" + emailHash;
    var cache = CacheService.getScriptCache();
    var now = Date.now();
    var cachedAttempts = cache.get(cacheKey);
    var attempts = cachedAttempts == null ? [] : JSON.parse(cachedAttempts);
    if (
      !Array.isArray(attempts) ||
      attempts.some(function (timestamp) {
        return (
          typeof timestamp !== "number" ||
          !isFinite(timestamp) ||
          timestamp > now
        );
      })
    ) {
      throw new Error("Invalid confirmation email rate limit data");
    }

    attempts = attempts.filter(function (timestamp) {
      return now - timestamp < windowMilliseconds;
    });
    if (attempts.length >= 3) {
      return "RATE_LIMITED";
    }

    attempts.push(now);
    var expiresInSeconds = Math.max(
      1,
      Math.ceil((attempts[0] + windowMilliseconds - now) / 1000),
    );
    cache.put(cacheKey, JSON.stringify(attempts), expiresInSeconds);
    return "RESERVED";
  } catch (error) {
    return "RATE_LIMIT_UNAVAILABLE";
  }
}

function lookupBooking(lookupCode, leaderPhone) {
  var booking = findBookingByCodeAndPhone_(lookupCode, leaderPhone);
  if (!booking) {
    return { found: false, message: "booking not found" };
  }

  var visibleBooking = {
    courseId: booking.courseId,
    courseDate: booking.courseDate,
    leaderName: booking.leaderName,
    status: booking.status,
  };
  var visibleParticipants = getParticipants_()
    .filter(function (participant) {
      return participant.bookingId === booking.bookingId;
    })
    .map(function (participant) {
      return {
        name: participant.name,
        phone: participant.phone,
      };
    });
  return {
    found: true,
    booking: visibleBooking,
    participants: visibleParticipants,
  };
}

function requestCancellation(lookupCode, leaderPhone, reason) {
  if (reason != null && typeof reason !== "string") {
    throw new Error("Cancellation reason must be a string");
  }
  var normalizedReason =
    typeof reason === "string" ? reason.trim() : "";

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var booking = findBookingByCodeAndPhone_(lookupCode, leaderPhone);
    if (!booking) {
      throw new Error("Booking not found");
    }
    if (booking.status !== "SUBMITTED" && booking.status !== "CANCELLATION_PENDING") {
      throw new Error("Cancellation cannot be requested for this booking");
    }
    var openRequests = getCancellationRequests_().filter(function (request) {
      return (
        request.bookingId === booking.bookingId &&
        (request.status === "PENDING" ||
          request.status === "APPROVING" ||
          request.status === "REJECTING")
      );
    });
    // A persisted PENDING request is the durable intent to cancel. While the
    // booking is still SUBMITTED it means an earlier attempt stopped before the
    // booking write, so the same public request resumes it instead of failing
    // or creating a duplicate.
    var intent = openRequests.filter(function (request) {
      return request.status === "PENDING";
    })[0];
    if (openRequests.length > 1 || (openRequests.length === 1 && !intent)) {
      throw new Error("A cancellation request is already pending");
    }

    // Booking CANCELLATION_PENDING is only valid with its existing PENDING intent
    // (idempotent retry); a new request may only be created from SUBMITTED.
    if (booking.status !== "SUBMITTED" && !intent) {
      throw new Error("Cancellation cannot be requested for this booking");
    }

    if (!intent) {
      intent = {
        requestId: Utilities.getUuid(),
        bookingId: booking.bookingId,
        reason: normalizedReason,
        status: "PENDING",
        requestedAt: new Date().toISOString(),
        reviewedBy: "",
        reviewedAt: "",
        notificationEmailStatus: "PENDING",
      };
      try {
        insertCancellationRequest_(intent);
      } catch (insertError) {
        // The row may have been persisted before the error was reported; repeating
        // the same request finds it and resumes, so nothing is rolled back.
        throw recoveryRequiredError_("Cancellation request creation", insertError);
      }
    }
    completeCancellationCreation_(booking);
    return { success: true, status: "CANCELLATION_PENDING" };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Moves a booking whose PENDING cancellation request is already durable to
 * CANCELLATION_PENDING. Idempotent; the caller must hold the Script Lock.
 * Nothing is rolled back on failure: the PENDING request stays as the intent.
 */
function completeCancellationCreation_(booking) {
  if (booking.status === "CANCELLATION_PENDING") {
    return;
  }
  try {
    updateBooking_(booking.bookingId, { status: "CANCELLATION_PENDING" });
  } catch (statusError) {
    throw recoveryRequiredError_("Cancellation request creation", statusError);
  }
}

function findBookingByCodeAndPhone_(lookupCode, leaderPhone) {
  if (
    typeof lookupCode !== "string" ||
    typeof leaderPhone !== "string" ||
    normalizePhone_(leaderPhone) === ""
  ) {
    return null;
  }

  return (
    getBookings_().filter(function (booking) {
      return (
        booking.lookupCode === lookupCode &&
        normalizePhone_(booking.leaderPhone) === normalizePhone_(leaderPhone) &&
        (booking.status === "SUBMITTED" ||
          booking.status === "CANCELLATION_PENDING" ||
          booking.status === "CANCELLED")
      );
    })[0] || null
  );
}
