function initializeWorkbook_() {
  var spreadsheet = getRegistrationSpreadsheet_();
  Object.keys(SHEET_SCHEMAS_).forEach(function (sheetName) {
    var sheet = spreadsheet.getSheetByName(sheetName);
    var headers = SHEET_SCHEMAS_[sheetName];
    if (sheet && sheet.getLastColumn() > headers.length) {
      throw new Error(
        "Sheet " + sheetName + " has an unexpected header row; expected: " +
          headers.join(", "),
      );
    }
  });

  Object.keys(SHEET_SCHEMAS_).forEach(function (sheetName) {
    var sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) {
      sheet = spreadsheet.insertSheet(sheetName);
    }

    var headers = SHEET_SCHEMAS_[sheetName];
    var width = Math.max(sheet.getLastColumn(), headers.length);
    var headerRange = sheet.getRange(1, 1, 1, width);
    if (sheet.getLastRow() === 0 || sheet.getLastColumn() === 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      return;
    }

    var existing = headerRange.getValues()[0];
    if (
      existing.some(function (value, index) {
        return value !== (index < headers.length ? headers[index] : "");
      })
    ) {
      throw new Error(
        "Sheet " + sheetName + " has an unexpected header row; expected: " +
          headers.join(", "),
      );
    }
  });

  var coursesSheet = spreadsheet.getSheetByName("Courses");
  if (coursesSheet.getLastRow() <= 1 && FALLBACK_COURSES.length > 0) {
    var courseHeaders = SHEET_SCHEMAS_.Courses;
    var rows = FALLBACK_COURSES.map(function (course) {
      return courseHeaders.map(function (header) {
        if (header === "courseId") {
          return course.courseId || course.id || "";
        }
        if (header === "manualRegistrationMode") {
          return course.manualRegistrationMode || "AUTO";
        }
        return course[header] == null ? "" : course[header];
      });
    });
    coursesSheet
      .getRange(2, 1, rows.length, courseHeaders.length)
      .setValues(rows);
  }
}

function getCourses_() {
  var sheet = getRegistrationSpreadsheet_().getSheetByName("Courses");
  var lastRow = sheet ? sheet.getLastRow() : 0;
  if (lastRow < 2) {
    return FALLBACK_COURSES.map(normalizeCourse_);
  }

  var headers = SHEET_SCHEMAS_.Courses;
  var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  var courses = values
    .map(function (row) {
      var course = {};
      headers.forEach(function (header, column) {
        var value = row[column];
        if (
          header === "date" &&
          value &&
          Object.prototype.toString.call(value) === "[object Date]" &&
          isFinite(value.getTime())
        ) {
          value = Utilities.formatDate(value, "Asia/Taipei", "yyyy-MM-dd");
        }
        course[header] = value == null ? "" : value;
      });
      return course;
    })
    .filter(function (course) {
      return (
        typeof course.courseId === "string" &&
        course.courseId.trim() !== "" &&
        typeof course.title === "string" &&
        course.title.trim() !== ""
      );
    });

  return courses.length > 0
    ? courses.map(normalizeCourse_)
    : FALLBACK_COURSES.map(normalizeCourse_);
}

function normalizeCourse_(course) {
  var normalized = {};
  SHEET_SCHEMAS_.Courses.forEach(function (header) {
    var value =
      header === "courseId"
        ? course.courseId || course.id || ""
        : course[header];
    normalized[header] = value == null ? "" : value;
  });

  var manualMode = normalized.manualRegistrationMode;
  if (
    manualMode == null ||
    (typeof manualMode === "string" && manualMode.trim() === "")
  ) {
    manualMode = "AUTO";
    normalized.manualRegistrationMode = manualMode;
  }
  if (
    manualMode !== "AUTO" &&
    manualMode !== "OPEN" &&
    manualMode !== "CLOSED"
  ) {
    var error = new Error(
      "Invalid manualRegistrationMode for course " +
        normalized.courseId +
        ": " +
        manualMode,
    );
    error.name = "CourseDataError";
    error.code = "INVALID_MANUAL_REGISTRATION_MODE";
    throw error;
  }

  return normalized;
}

function getRegistrationSpreadsheet_() {
  if (typeof PropertiesService !== "undefined") {
    var spreadsheetId = PropertiesService.getScriptProperties().getProperty(
      "SPREADSHEET_ID",
    );
    if (spreadsheetId) {
      return SpreadsheetApp.openById(spreadsheetId);
    }
  }
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getBookings_() {
  return getSheetRecords_("Bookings");
}

function getParticipants_() {
  return getSheetRecords_("Participants");
}

function getCancellationRequests_() {
  return getSheetRecords_("CancellationRequests");
}

function insertBooking_(booking) {
  appendSheetRecords_("Bookings", [booking]);
}

function insertParticipants_(participants) {
  appendSheetRecords_("Participants", participants);
}

function updateBooking_(bookingId, updates) {
  updateSheetRecord_("Bookings", "bookingId", bookingId, updates);
}

function updateCancellationRequest_(requestId, updates) {
  updateSheetRecord_(
    "CancellationRequests",
    "requestId",
    requestId,
    updates,
  );
}

function updateCourse_(courseId, updates) {
  updateSheetRecord_("Courses", "courseId", courseId, updates);
}

function insertCancellationRequest_(request) {
  appendSheetRecords_("CancellationRequests", [request]);
}

function getAuditLogs_() {
  return getSheetRecords_("AuditLog");
}

function insertAuditLog_(entry) {
  appendSheetRecords_("AuditLog", [entry]);
}

function getSheetRecords_(sheetName) {
  var sheet = getRegistrationSpreadsheet_().getSheetByName(sheetName);
  if (!sheet) {
    var error = new Error(
      "Required sheet " +
        sheetName +
        " is missing; run initializeWorkbook_() to create it.",
    );
    error.name = "ConfigurationError";
    error.code = "REQUIRED_SHEET_MISSING";
    throw error;
  }
  if (sheet.getLastRow() < 2) {
    return [];
  }

  var headers = SHEET_SCHEMAS_[sheetName];
  return sheet
    .getRange(2, 1, sheet.getLastRow() - 1, headers.length)
    .getValues()
    .map(function (row) {
      var record = {};
      headers.forEach(function (header, column) {
        record[header] = row[column] == null ? "" : row[column];
      });
      return record;
    });
}

function appendSheetRecords_(sheetName, records) {
  if (!Array.isArray(records) || records.length === 0) {
    return;
  }

  var sheet = getRegistrationSpreadsheet_().getSheetByName(sheetName);
  if (!sheet) {
    throw new Error("Sheet " + sheetName + " is not initialized");
  }
  var headers = SHEET_SCHEMAS_[sheetName];
  var rows = records.map(function (record) {
    return headers.map(function (header) {
      return escapeSheetValue_(record[header]);
    });
  });
  sheet
    .getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length)
    .setValues(rows);
}

function updateSheetRecord_(sheetName, key, keyValue, updates) {
  var sheet = getRegistrationSpreadsheet_().getSheetByName(sheetName);
  if (!sheet) {
    throw new Error("Sheet " + sheetName + " is not initialized");
  }
  var headers = SHEET_SCHEMAS_[sheetName];
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    throw new Error(sheetName + " record not found");
  }

  var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  var keyColumn = headers.indexOf(key);
  var rowIndex = values.findIndex(function (row) {
    return row[keyColumn] === keyValue;
  });
  if (rowIndex < 0) {
    throw new Error(sheetName + " record not found");
  }

  var updated = values[rowIndex].slice();
  headers.forEach(function (header, column) {
    if (Object.prototype.hasOwnProperty.call(updates, header)) {
      updated[column] = escapeSheetValue_(updates[header]);
    }
  });
  sheet
    .getRange(rowIndex + 2, 1, 1, headers.length)
    .setValues([updated]);
}

function escapeSheetValue_(value) {
  if (value == null) {
    return "";
  }
  if (typeof value === "string" && value.charAt(0) === "=") {
    return "'" + value;
  }
  return value;
}
