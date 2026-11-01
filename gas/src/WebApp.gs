/**
 * Serves the public registration and self-service page.
 *
 * @param {{parameter:Object}} e Web app request.
 * @return {GoogleAppsScript.HTML.HtmlOutput}
 */
function doGet(e) {
  var template = HtmlService.createTemplateFromFile("Public");
  var parameters = e && e.parameter ? e.parameter : {};
  template.initialCourseId =
    typeof parameters.courseId === "string" ? parameters.courseId : "";
  return template.evaluate().setTitle("課程報名與查詢");
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
