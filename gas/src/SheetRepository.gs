// Apps Script 編輯器的「執行」選單不會列出結尾為底線的私有函式，
// 因此提供公開入口供手動初始化。
function initializeWorkbook() {
  requireAdmin_();
  return initializeWorkbook_();
}

function initializeWorkbook_() {
  var spreadsheet = getRegistrationSpreadsheet_();
  Object.keys(SHEET_SCHEMAS_).forEach(function (sheetName) {
    var sheet = spreadsheet.getSheetByName(sheetName);
    if (sheet) {
      validateSheetHeaders_(sheetName, sheet, SHEET_SCHEMAS_[sheetName]);
    }
  });

  Object.keys(SHEET_SCHEMAS_).forEach(function (sheetName) {
    var sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) {
      sheet = spreadsheet.insertSheet(sheetName);
    }

    var headers = SHEET_SCHEMAS_[sheetName];
    if (sheet.getLastRow() === 0 || sheet.getLastColumn() === 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      return;
    }

    var existing = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
    if (sheetName === "Courses") {
      var existingHeaderLength = getHeaderPrefixLength_(existing);
      if (existingHeaderLength < headers.length) {
        sheet
          .getRange(
            1,
            existingHeaderLength + 1,
            1,
            headers.length - existingHeaderLength,
          )
          .setValues([headers.slice(existingHeaderLength)]);
      }
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
        if (header === "instructorBio" && Array.isArray(course[header])) {
          return course[header].join("\n");
        }
        return course[header] == null ? "" : course[header];
      });
    });
    coursesSheet
      .getRange(2, 1, rows.length, courseHeaders.length)
      .setValues(rows);
  }

  seedFallbackCourseDetails_();
}

function validateSheetHeaders_(sheetName, sheet, headers) {
  var lastColumn = sheet.getLastColumn();
  var lastRow = sheet.getLastRow();
  if (lastColumn > headers.length) {
    throw unexpectedSheetHeaderError_(sheetName, headers);
  }
  if (lastColumn === 0) {
    if (lastRow > 0) {
      throw unexpectedSheetHeaderError_(sheetName, headers);
    }
    return;
  }

  var existing = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  if (
    existing.every(function (value) {
      return value == null || value === "";
    })
  ) {
    if (lastRow > 0) {
      throw unexpectedSheetHeaderError_(sheetName, headers);
    }
    return;
  }

  if (sheetName === "Courses") {
    var prefixLength = getHeaderPrefixLength_(existing);
    if (
      prefixLength > 0 &&
      prefixLength < headers.length &&
      existing.slice(0, prefixLength).every(function (value, index) {
        return value === headers[index];
      })
    ) {
      if (lastRow > 1) {
        var unheadedValues = sheet
          .getRange(
            2,
            prefixLength + 1,
            lastRow - 1,
            headers.length - prefixLength,
          )
          .getValues();
        var hasUnheadedData = unheadedValues.some(function (row) {
          return row.some(function (value) {
            return value != null && value !== "";
          });
        });
        if (hasUnheadedData) {
          throw unexpectedSheetHeaderError_(sheetName, headers);
        }
      }
      return;
    }
  }

  var isExactHeader = headers.every(function (header, index) {
    return existing[index] === header;
  });
  if (!isExactHeader) {
    throw unexpectedSheetHeaderError_(sheetName, headers);
  }
}

function getHeaderPrefixLength_(headerRow) {
  var prefixLength = 0;
  while (
    prefixLength < headerRow.length &&
    headerRow[prefixLength] != null &&
    headerRow[prefixLength] !== ""
  ) {
    prefixLength += 1;
  }
  for (var index = prefixLength; index < headerRow.length; index += 1) {
    if (headerRow[index] != null && headerRow[index] !== "") {
      return -1;
    }
  }
  return prefixLength;
}

function unexpectedSheetHeaderError_(sheetName, headers) {
  return new Error(
    "Sheet " + sheetName + " has an unexpected header row; expected: " +
      headers.join(", "),
  );
}

function seedFallbackCourseDetails_() {
  if (!Array.isArray(FALLBACK_COURSES) || FALLBACK_COURSES.length === 0) {
    return;
  }

  var spreadsheet = getRegistrationSpreadsheet_();
  var coursesSheet = spreadsheet.getSheetByName("Courses");
  if (!coursesSheet || coursesSheet.getLastRow() < 2) {
    return;
  }

  var courseHeaders = SHEET_SCHEMAS_.Courses;
  var courseRows = coursesSheet
    .getRange(2, 1, coursesSheet.getLastRow() - 1, courseHeaders.length)
    .getValues();
  var fallbackById = Object.create(null);
  FALLBACK_COURSES.forEach(function (fallback) {
    var courseId = fallbackCourseId_(fallback);
    if (
      courseId !== "" &&
      !Object.prototype.hasOwnProperty.call(fallbackById, courseId)
    ) {
      fallbackById[courseId] = fallback;
    }
  });

  var seededCourseIds = Object.create(null);
  courseRows.forEach(function (row, rowIndex) {
    var courseId = row[courseHeaders.indexOf("courseId")];
    var fallback = fallbackById[courseId];
    if (!fallback) {
      return;
    }

    seededCourseIds[courseId] = true;
    ["description", "instructor", "instructorBio"].forEach(function (field) {
      var column = courseHeaders.indexOf(field);
      if (row[column] != null && row[column] !== "") {
        return;
      }

      var value = fallback[field];
      if (field === "instructorBio" && Array.isArray(value)) {
        value = value.join("\n");
      }
      if (value == null || value === "") {
        return;
      }

      coursesSheet
        .getRange(rowIndex + 2, column + 1, 1, 1)
        .setValues([[escapeSheetValue_(value)]]);
    });
  });

  seedFallbackContentSheet_(
    spreadsheet.getSheetByName("CourseOutline"),
    "CourseOutline",
    seededCourseIds,
    fallbackById,
  );
  seedFallbackContentSheet_(
    spreadsheet.getSheetByName("CoursePricing"),
    "CoursePricing",
    seededCourseIds,
    fallbackById,
  );
}

function seedFallbackContentSheet_(
  sheet,
  sheetName,
  seededCourseIds,
  fallbackById,
) {
  if (!sheet) {
    return;
  }

  var existingCourseIds = Object.create(null);
  getSheetRecords_(sheetName).forEach(function (record) {
    if (record.courseId !== "") {
      existingCourseIds[record.courseId] = true;
    }
  });

  var records = [];
  Object.keys(seededCourseIds).forEach(function (courseId) {
    if (existingCourseIds[courseId]) {
      return;
    }

    var fallback = fallbackById[courseId];
    var content =
      sheetName === "CourseOutline" ? fallback.outline : fallback.pricing;
    if (!Array.isArray(content)) {
      return;
    }

    content.forEach(function (item, index) {
      if (sheetName === "CourseOutline") {
        records.push({
          courseId: courseId,
          sortOrder: index + 1,
          item: item,
        });
      } else {
        records.push({
          courseId: courseId,
          sortOrder: index + 1,
          label: item && item.label,
          price: item && item.price,
        });
      }
    });
  });

  appendSheetRecords_(sheetName, records);
}

function fallbackCourseId_(course) {
  return course ? course.courseId || course.id || "" : "";
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

function deleteAuditLog_(eventId) {
  var sheet = getRegistrationSpreadsheet_().getSheetByName("AuditLog");
  if (!sheet) {
    throw new Error("Sheet AuditLog is not initialized");
  }
  var headers = SHEET_SCHEMAS_.AuditLog;
  var eventIdColumn = headers.indexOf("eventId");
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return false;
  }

  var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  var rowIndex = values.findIndex(function (row) {
    return row[eventIdColumn] === eventId;
  });
  if (rowIndex < 0) {
    return false;
  }

  sheet.deleteRow(rowIndex + 2);
  return true;
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
