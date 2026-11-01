/**
 * Serves the public registration and self-service page.
 *
 * @param {{parameter:Object}} e Web app request.
 * @return {GoogleAppsScript.HTML.HtmlOutput}
 */
function doGet(e) {
  var parameters = e && e.parameter ? e.parameter : {};
  if (parameters.page === "admin") {
    // Configure the public deployment to execute as owner. Deploy this management
    // route separately with authenticated access and "Execute as: user accessing
    // the web app"; each administrator also needs Sheet access and authorization.
    requireAdmin_();
    return HtmlService.createTemplateFromFile("Admin")
      .evaluate()
      .setTitle("課程報名管理");
  }

  if (parameters.format === "courses") {
    var callback = parameters.callback;
    if (
      typeof callback !== "string" ||
      !/^[A-Za-z_$][0-9A-Za-z_$]*$/.test(callback)
    ) {
      throw new Error("Invalid JSONP callback");
    }

    return ContentService.createTextOutput(
      callback + "(" + JSON.stringify(listPublicCourses_()) + ");",
    ).setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  var template = HtmlService.createTemplateFromFile("Public");
  template.initialCourseId =
    typeof parameters.courseId === "string" ? parameters.courseId : "";
  return template.evaluate().setTitle("課程報名與查詢");
}

/**
 * Returns all valid public course display fields and their ordered content.
 *
 * @return {Array<Object>}
 */
function listPublicCourses_() {
  var outlines = groupCourseContent_(readOptionalCourseContent_("CourseOutline"));
  var pricing = groupCourseContent_(readOptionalCourseContent_("CoursePricing"));
  var displayFields = [
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

  return getCourses_()
    .filter(function (course) {
      return (
        course &&
        typeof course.courseId === "string" &&
        course.courseId.trim() !== "" &&
        typeof course.title === "string" &&
        course.title.trim() !== ""
      );
    })
    .map(function (course) {
      var visibleCourse = {};
      displayFields.forEach(function (field) {
        visibleCourse[field] = publicCourseText_(course[field]);
      });
      visibleCourse.outline = (outlines[course.courseId] || []).map(
        function (item) {
          return publicCourseText_(item.item);
        },
      );
      visibleCourse.pricing = (pricing[course.courseId] || []).map(
        function (item) {
          return {
            label: publicCourseText_(item.label),
            price: publicCourseValue_(item.price),
          };
        },
      );
      return visibleCourse;
    });
}

/**
 * Reads optional public course content. Missing tabs are empty; sheet failures propagate.
 *
 * @param {string} sheetName Content sheet name.
 * @return {Array<Object>}
 */
function readOptionalCourseContent_(sheetName) {
  var sheet = getRegistrationSpreadsheet_().getSheetByName(sheetName);
  return sheet ? getSheetRecords_(sheetName) : [];
}

/**
 * Groups content records by course and orders each group by sortOrder.
 *
 * @param {Array<Object>} records Sheet records.
 * @return {Object}
 */
function groupCourseContent_(records) {
  var grouped = Object.create(null);
  records.forEach(function (record) {
    if (
      !record ||
      typeof record.courseId !== "string" ||
      record.courseId.trim() === ""
    ) {
      return;
    }
    if (!grouped[record.courseId]) {
      grouped[record.courseId] = [];
    }
    grouped[record.courseId].push(record);
  });

  Object.keys(grouped).forEach(function (courseId) {
    grouped[courseId].sort(function (left, right) {
      var leftOrder = Number(left.sortOrder);
      var rightOrder = Number(right.sortOrder);
      if (!isFinite(leftOrder)) leftOrder = 0;
      if (!isFinite(rightOrder)) rightOrder = 0;
      return leftOrder - rightOrder;
    });
  });
  return grouped;
}

function publicCourseText_(value) {
  if (Array.isArray(value)) {
    return value.join("\n");
  }
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}

function publicCourseValue_(value) {
  return typeof value === "string" || typeof value === "number" ? value : "";
}

/**
 * Returns only currently open course fields intended for public display.
 *
 * @return {Array<Object>}
 */
function listOpenCourses() {
  var now = new Date();
  var displayFields = [
    "courseId",
    "title",
    "date",
    "startTime",
    "endTime",
    "location",
    "mode",
    "image",
  ];
  return getCourses_()
    .filter(function (course) {
      return (
        getCourseAvailability_(
          course.date,
          now,
          course.manualRegistrationMode,
        ) === "OPEN"
      );
    })
    .map(function (course) {
      var visibleCourse = {};
      displayFields.forEach(function (field) {
        var value = course[field];
        visibleCourse[field] =
          typeof value === "string" || typeof value === "number"
            ? String(value)
            : "";
      });
      return visibleCourse;
    });
}

/**
 * Includes a trusted, repository-owned HTML partial.
 *
 * @param {string} filename Partial filename without the extension.
 * @return {string}
 */
function include_(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
