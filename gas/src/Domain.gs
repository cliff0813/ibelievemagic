/**
 * Returns whether registration is open before the Taiwan-local cutoff.
 *
 * @param {string} courseDate Course date in yyyy-MM-dd format.
 * @param {Date} now Current instant.
 * @param {string} manualMode AUTO, OPEN, or CLOSED.
 * @return {"OPEN"|"CLOSED"}
 */
function getCourseAvailability_(courseDate, now, manualMode) {
  if (
    manualMode === "CLOSED" ||
    (manualMode != null &&
      manualMode !== "" &&
      manualMode !== "AUTO" &&
      manualMode !== "OPEN")
  ) {
    return "CLOSED";
  }

  if (!isValidCourseDate_(courseDate)) {
    return "CLOSED";
  }

  var deadline = Date.parse(courseDate + "T00:00:00+08:00") - 2 * 86400000;
  var currentTime =
    now && typeof now.getTime === "function" ? now.getTime() : NaN;
  if (!isFinite(deadline) || !isFinite(currentTime) || currentTime >= deadline) {
    return "CLOSED";
  }

  return "OPEN";
}

/**
 * Removes phone formatting without converting the value to a number.
 *
 * @param {*} value Phone value.
 * @return {string} Digits only, preserving leading zeroes.
 */
function normalizePhone_(value) {
  return typeof value === "string" ? value.replace(/\D/g, "") : "";
}

/**
 * Trims and lowercases an email address.
 *
 * @param {*} value Email value.
 * @return {string}
 */
function normalizeEmail_(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/**
 * Checks active bookings for a same-course, same-date phone or email match.
 *
 * @param {string} courseId
 * @param {string} courseDate
 * @param {{phone:string, email:string}} candidate
 * @param {Array<Object>} existing Participant records with booking state.
 * @return {boolean}
 */
function isExistingDuplicate_(courseId, courseDate, candidate, existing) {
  if (!candidate || !Array.isArray(existing)) {
    return false;
  }

  var candidatePhone = normalizePhone_(candidate.phone);
  var candidateEmail = normalizeEmail_(candidate.email);
  return existing.some(function (participant) {
    if (!participant) {
      return false;
    }

    var status = participant.bookingStatus || participant.status;
    if (
      participant.courseId !== courseId ||
      participant.courseDate !== courseDate ||
      (status !== "SUBMITTED" && status !== "CANCELLATION_PENDING")
    ) {
      return false;
    }

    var samePhone =
      candidatePhone !== "" &&
      normalizePhone_(participant.phone) === candidatePhone;
    var sameEmail =
      candidateEmail !== "" &&
      normalizeEmail_(participant.email) === candidateEmail;
    return samePhone || sameEmail;
  });
}

/**
 * Detects a participant already present in this submission by all participant
 * fields, not by contact details alone.
 *
 * @param {Object} candidate Participant being checked.
 * @param {Array<Object>} earlierParticipants Participants already accepted.
 * @return {boolean}
 */
function isDuplicateWithinSubmission_(candidate, earlierParticipants) {
  if (!candidate || !Array.isArray(earlierParticipants)) {
    return false;
  }

  var candidateKey = participantKey_(candidate);
  return earlierParticipants.some(function (participant) {
    return participant && participantKey_(participant) === candidateKey;
  });
}

/**
 * Validates booking metadata, leader contacts, registration size, and
 * participant records. Returns stable error codes for callers to translate.
 *
 * @param {*} payload Booking input.
 * @return {{valid:boolean, errors:Array<string>}}
 */
function validateBookingInput_(payload) {
  var errors = [];
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { valid: false, errors: ["INVALID_PAYLOAD"] };
  }

  if (!isNonEmptyString_(payload.courseId)) {
    errors.push("INVALID_COURSE_ID");
  }
  if (!isValidCourseDate_(payload.courseDate)) {
    errors.push("INVALID_COURSE_DATE");
  }
  if (
    payload.registrationType !== "INDIVIDUAL" &&
    payload.registrationType !== "GROUP"
  ) {
    errors.push("INVALID_REGISTRATION_TYPE");
  }
  if (!isNonEmptyString_(payload.leaderName)) {
    errors.push("INVALID_LEADER_NAME");
  }
  if (!isValidPhone_(payload.leaderPhone)) {
    errors.push("INVALID_LEADER_PHONE");
  }
  if (!isValidEmail_(payload.leaderEmail)) {
    errors.push("INVALID_LEADER_EMAIL");
  }
  if (!Array.isArray(payload.participants)) {
    errors.push("INVALID_PARTICIPANTS");
    return { valid: false, errors: errors };
  }

  if (
    payload.registrationType === "INDIVIDUAL" &&
    payload.participants.length !== 1
  ) {
    errors.push("INDIVIDUAL_REQUIRES_ONE_PARTICIPANT");
  }
  if (
    payload.registrationType === "GROUP" &&
    payload.participants.length < 3
  ) {
    errors.push("GROUP_REQUIRES_THREE_PARTICIPANTS");
  }
  if (payload.participants.length === 0) {
    errors.push("INVALID_PARTICIPANTS");
  }

  var earlierParticipants = [];
  payload.participants.forEach(function (participant) {
    if (
      !participant ||
      typeof participant !== "object" ||
      Array.isArray(participant) ||
      !isNonEmptyString_(participant.name) ||
      !isValidPhone_(participant.phone) ||
      !isValidEmail_(participant.email) ||
      (participant.lineName != null &&
        typeof participant.lineName !== "string")
    ) {
      errors.push("INVALID_PARTICIPANT");
      return;
    }

    if (isDuplicateWithinSubmission_(participant, earlierParticipants)) {
      errors.push("DUPLICATE_PARTICIPANT");
    } else {
      earlierParticipants.push(participant);
    }
  });

  return { valid: errors.length === 0, errors: errors };
}

/**
 * @param {*} value
 * @return {boolean}
 */
function isNonEmptyString_(value) {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * @param {*} value
 * @return {boolean}
 */
function isValidPhone_(value) {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    !/^\+?[0-9\s().-]+$/.test(value)
  ) {
    return false;
  }

  var phone = normalizePhone_(value);
  return phone.length >= 8 && phone.length <= 15;
}

/**
 * @param {*} value
 * @return {boolean}
 */
function isValidEmail_(value) {
  var email = normalizeEmail_(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * @param {*} value
 * @return {boolean}
 */
function isValidCourseDate_(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  var parts = value.split("-").map(Number);
  var date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return (
    date.getUTCFullYear() === parts[0] &&
    date.getUTCMonth() === parts[1] - 1 &&
    date.getUTCDate() === parts[2]
  );
}

/**
 * @param {Object} participant
 * @return {string}
 */
function participantKey_(participant) {
  return JSON.stringify([
    typeof participant.name === "string"
      ? participant.name.trim().replace(/\s+/g, " ")
      : "",
    normalizePhone_(participant.phone),
    normalizeEmail_(participant.email),
    typeof participant.lineName === "string" ? participant.lineName.trim() : "",
  ]);
}