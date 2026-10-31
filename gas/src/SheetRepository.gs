function initializeWorkbook_() {
  var spreadsheet = getRegistrationSpreadsheet_();
  Object.keys(SHEET_SCHEMAS_).forEach(function (sheetName) {
    var sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) {
      sheet = spreadsheet.insertSheet(sheetName);
    }

    var headers = SHEET_SCHEMAS_[sheetName];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
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
