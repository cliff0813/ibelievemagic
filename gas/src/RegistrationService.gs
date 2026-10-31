function submitBooking(payload) {
  var validation = validateBookingInput_(payload);
  if (!validation.valid) {
    throw new Error("Invalid booking input: " + validation.errors.join(", "));
  }

  var bookingId = Utilities.getUuid();
  var lookupCode = Utilities.getUuid();
  var lock = LockService.getScriptLock();
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
  } finally {
    lock.releaseLock();
  }

  var confirmationEmailStatus = "SENT";
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

  var emailStatusRecorded = true;
  var statusError = null;
  var statusLock = null;
  try {
    statusLock = LockService.getScriptLock();
    statusLock.waitLock(30000);
    updateBooking_(bookingId, {
      confirmationEmailStatus: confirmationEmailStatus,
    });
  } catch (error) {
    emailStatusRecorded = false;
    statusError = error;
  } finally {
    if (statusLock) {
      try {
        statusLock.releaseLock();
      } catch (releaseError) {}
    }
  }

  var message =
    confirmationEmailStatus === "SENT"
      ? "Registration submitted"
      : "Registration submitted, but confirmation email delivery failed";
  if (!emailStatusRecorded) {
    message +=
      ". Warning: confirmation email status could not be recorded: " +
      statusError.message +
      ". Please save the lookup code.";
  }
  return {
    success: true,
    lookupCode: lookupCode,
    confirmationEmailStatus: confirmationEmailStatus,
    confirmationEmailStatusRecorded: emailStatusRecorded,
    message: message,
  };
}

function lookupBooking(lookupCode, leaderPhone) {
  var booking = findBookingByCodeAndPhone_(lookupCode, leaderPhone);
  if (!booking) {
    return { found: false, message: "booking not found" };
  }

  var visibleBooking = {
    lookupCode: booking.lookupCode,
    courseId: booking.courseId,
    courseDate: booking.courseDate,
    leaderName: booking.leaderName,
    leaderPhone: booking.leaderPhone,
    leaderEmail: booking.leaderEmail,
    status: booking.status,
    createdAt: booking.createdAt,
    confirmationEmailStatus: booking.confirmationEmailStatus,
  };
  var visibleParticipants = getParticipants_()
    .filter(function (participant) {
      return participant.bookingId === booking.bookingId;
    })
    .map(function (participant) {
      return {
        courseId: participant.courseId,
        courseDate: participant.courseDate,
        name: participant.name,
        phone: participant.phone,
        email: participant.email,
        lineName: participant.lineName,
      };
    });
  return {
    found: true,
    booking: visibleBooking,
    participants: visibleParticipants,
  };
}

function requestCancellation(lookupCode, leaderPhone, reason) {
  if (typeof reason !== "string" || reason.trim() === "") {
    throw new Error("Cancellation reason is required");
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var booking = findBookingByCodeAndPhone_(lookupCode, leaderPhone);
    if (!booking) {
      throw new Error("Booking not found");
    }
    if (booking.status !== "SUBMITTED") {
      throw new Error("Cancellation cannot be requested for this booking");
    }
    var pendingRequest = getCancellationRequests_().some(function (request) {
      return (
        request.bookingId === booking.bookingId && request.status === "PENDING"
      );
    });
    if (pendingRequest) {
      throw new Error("A cancellation request is already pending");
    }

    var request = {
      requestId: Utilities.getUuid(),
      bookingId: booking.bookingId,
      reason: reason.trim(),
      status: "PENDING",
      requestedAt: new Date().toISOString(),
      reviewedBy: "",
      reviewedAt: "",
      notificationEmailStatus: "PENDING",
    };
    insertCancellationRequest_(request);
    try {
      updateBooking_(booking.bookingId, { status: "CANCELLATION_PENDING" });
    } catch (statusError) {
      var persistenceFailure =
        "Cancellation persistence failed: " + statusError.message;
      try {
        updateBooking_(booking.bookingId, { status: "SUBMITTED" });
      } catch (rollbackError) {
        persistenceFailure +=
          "; could not restore booking status: " + rollbackError.message;
      }
      try {
        updateCancellationRequest_(request.requestId, { status: "FAILED" });
      } catch (requestError) {
        persistenceFailure +=
          "; could not mark cancellation request FAILED: " + requestError.message;
      }
      throw new Error(persistenceFailure);
    }
    return { success: true, status: "CANCELLATION_PENDING" };
  } finally {
    lock.releaseLock();
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
