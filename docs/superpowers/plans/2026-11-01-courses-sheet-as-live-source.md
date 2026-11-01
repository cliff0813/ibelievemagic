# Live Course Data from Google Sheets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Google Sheets the shared live source for public course listings, details, and registration while preserving existing registration behavior.

**Architecture:** Extend the Apps Script sheet schema with course description and instructor fields plus normalized outline and pricing sheets. Add a read-only JSONP endpoint that returns only public course fields, then have GitHub Pages load those records in the browser so Sheet edits appear after reload without rebuilding the site. Keep old detail URLs working and route new course IDs through a generic static detail page.

**Tech Stack:** Google Apps Script, Google Sheets, Next.js static export, React, TypeScript, Node.js `node:test`.

---

## File map

- Modify `gas/src/Schema.gs` and `gas/src/SheetRepository.gs` to define and safely migrate the expanded Sheets schema.
- Regenerate `gas/src/FallbackCourses.gs` from `data/courses.json` using `gas/scripts/sync-fallback.mjs`; never hand-edit the generated file.
- Modify `gas/src/WebApp.gs` to serve the public course JSONP response without changing `listOpenCourses()` registration filtering.
- Extend `gas/tests/repository.test.cjs` and `gas/tests/public-webapp.test.cjs` for migration, ordering, public-field allowlisting, JSONP validation, and error behavior.
- Add `lib/course-api.mjs` and `lib/course-api.test.mjs` for the JSONP URL builder and browser loader.
- Add a typed public course contract in `lib/course-types.ts`.
- Update `app/page.tsx`, `app/courses/page.tsx`, `app/courses/[id]/page.tsx`, `components/CourseCard.tsx`, and `components/CoursesExplorer.tsx` to render live records.
- Add `app/courses/detail/page.tsx` so a newly added course ID has a static host route.
- Add focused course UI states in `components/LiveCourseList.tsx` and `components/LiveCourseDetail.tsx`; these own loading, retry, missing-course, and request-error states.
- Add `lib/course-date.mjs` and `lib/course-date.test.mjs`; re-export its helpers from `lib/data.ts` so date-only values are independent of the build machine timezone.
- Update `gas/README.md` and root `README.md` with the expanded sheet format, live update behavior, public fields, initial GAS deployment step, and deployment verification.

## Task 1: Specify the expanded Sheets schema and migration behavior

**Files:**
- Modify: `gas/src/Schema.gs`
- Modify: `gas/tests/repository.test.cjs`

- [ ] **Step 1: Add failing schema and migration tests**

Extend `expectedHeaders` in `gas/tests/repository.test.cjs` so Courses appends `description`, `instructor`, and `instructorBio`; add:

```js
CourseOutline: ["courseId", "sortOrder", "item"],
CoursePricing: ["courseId", "sortOrder", "label", "price"],
```

Add a test that starts with an old nine-column Courses header and an existing course row, calls `initializeWorkbook_()`, and asserts the old row is unchanged, new headers are appended, and the two detail sheets are created with headers. Add an idempotency assertion by running initialization twice.

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `npm --prefix gas test -- --test-name-pattern="initialization"`

Expected: the old schema test fails because the new headers and tabs do not yet exist; the old-header migration case fails rather than preserving and extending the existing table.

- [ ] **Step 3: Add the new schema headers**

Append these fields to `Courses` in `gas/src/Schema.gs` without reordering any existing field:

```js
"description",
"instructor",
"instructorBio",
```

Add `CourseOutline` and `CoursePricing` schemas exactly as defined above. Do not add learner, booking, or administrator data to either public course-content sheet.

- [ ] **Step 4: Re-run the focused repository tests**

Run: `npm --prefix gas test -- --test-name-pattern="initialization"`

Expected: tests still fail only because `initializeWorkbook_()` does not yet migrate old headers.

## Task 2: Implement non-destructive sheet migration and seed existing details

**Files:**
- Modify: `gas/src/SheetRepository.gs`
- Modify: `gas/tests/repository.test.cjs`
- Generate: `gas/src/FallbackCourses.gs`

- [ ] **Step 1: Add failing migration and content-read tests**

In `gas/tests/repository.test.cjs`, cover:

1. An old Courses header prefix is extended in-place and existing cell values remain unchanged.
2. An unexpected or reordered existing header still throws rather than being silently accepted.
3. Missing content tabs are created once.
4. Existing non-empty description and existing outline/pricing rows are not overwritten.
5. Blank details for a matching course ID are seeded from `FALLBACK_COURSES`, with outline and pricing order matching their source array order.
6. `getCourses_()` returns description, instructor, and instructorBio while registration normalization still provides `manualRegistrationMode`.

- [ ] **Step 2: Run the focused tests and verify the expected failures**

Run: `npm --prefix gas test -- --test-name-pattern="initialization|fallback|course"`

Expected: migration and detail-content assertions fail before implementation; existing registration validation tests continue to run.

- [ ] **Step 3: Implement the safe, repeatable migration**

Update `initializeWorkbook_()` so it accepts an exact prefix of the new Courses schema, appends only the missing trailing header cells, and continues rejecting mismatched or reordered existing headers. Create the new content tabs through the same shared schema loop. Never clear rows or rewrite existing values during header extension.

Add a private, idempotent seed helper that matches fallback records by `courseId`/`id`. Fill only blank `description`, `instructor`, and `instructorBio` cells. Add missing outline/pricing records only where the matching course does not already have those records; use 1-based `sortOrder`. Preserve all existing location, title, date, and content values.

- [ ] **Step 4: Regenerate fallback data and run repository tests**

Run:

```powershell
npm --prefix gas run sync:fallback
npm --prefix gas test
```

Expected: the generated fallback contains current course details and the complete GAS suite passes.

## Task 3: Add the public JSONP course endpoint

**Files:**
- Modify: `gas/src/WebApp.gs`
- Modify: `gas/tests/public-webapp.test.cjs`

- [ ] **Step 1: Write failing endpoint tests**

Extend `loadWebApp()` with `ContentService` and content-sheet stubs. Test that `doGet({parameter:{format:"courses",callback:"courseCallback"}})` returns JavaScript calling the validated callback with a payload containing `courseId`, title, dates/times, location, mode, image, description, instructor, instructorBio, outline, and pricing.

Assert that:

- closed and expired courses are included in the public display response;
- `manualRegistrationMode`, spreadsheet IDs, bookings, and other non-allowlisted fields are absent;
- outline and pricing rows are sorted by `sortOrder`;
- callbacks outside `/^[A-Za-z_$][0-9A-Za-z_$]*$/` are rejected;
- sheet read failures propagate as endpoint failures;
- existing `listOpenCourses()` still returns only currently open registration fields.

- [ ] **Step 2: Run the focused endpoint tests and confirm they fail**

Run: `npm --prefix gas test -- --test-name-pattern="public course|public doGet|approved public APIs"`

Expected: the course-format route and JSONP response assertions fail; existing registration API tests identify any accidental behavior change.

- [ ] **Step 3: Implement a separate allowlisted course-display response**

Add a private helper in `WebApp.gs` that reads all valid courses, reads `CourseOutline` and `CoursePricing`, associates rows by course ID, sorts by `sortOrder`, and constructs only the approved public fields. Handle missing content sheets as empty content, but allow actual spreadsheet read errors to surface.

Add a `doGet` format branch before normal page rendering. Require a valid callback, serialize the payload with `JSON.stringify`, and return it through `ContentService` with JavaScript MIME type. Keep `listOpenCourses()` unchanged for registration availability.

- [ ] **Step 4: Verify endpoint and registration tests**

Run: `npm --prefix gas test`

Expected: all public endpoint, repository, domain, service, fallback, and client tests pass.

## Task 4: Add and test the browser JSONP client

**Files:**
- Create: `lib/course-api.mjs`
- Create: `lib/course-api.test.mjs`
- Create: `lib/course-types.ts`

- [ ] **Step 1: Write client tests before implementation**

Add Node tests for a JSONP URL built from `data/gas-registration.json`'s public `webAppUrl`, including a valid callback and cache-busting value. Use a DOM harness to assert successful callback resolves records; script load error, malformed payload, and timeout reject with explicit errors; and cleanup removes the script and callback.

- [ ] **Step 2: Run the client test and verify it fails**

Run: `node --test lib/course-api.test.mjs`

Expected: module-not-found or missing-export failure before the helper exists.

- [ ] **Step 3: Implement the API client and data contract**

Define `Course` using the browser-facing fields and arrays:

```ts
export type CoursePrice = { label: string; price: number };
export type Course = {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  mode: string;
  image: string;
  description: string;
  instructor: string;
  instructorBio: string[];
  outline: string[];
  pricing: CoursePrice[];
};
```

The `.mjs` client maps API `courseId` to UI `id`, validates required fields and array shapes, validates the HTTPS `/exec` base URL, uses an unpredictable callback identifier, and always removes the callback/script on success or failure. Reject malformed data; do not silently substitute `courses.json`.

- [ ] **Step 4: Run API client tests**

Run: `node --test lib/course-api.test.mjs`

Expected: all URL, normalization, callback cleanup, invalid-response, script-error, and timeout tests pass.

## Task 5: Render live courses on the home, list, and detail routes

**Files:**
- Create: `components/LiveCourseList.tsx`
- Create: `components/LiveCourseDetail.tsx`
- Create: `app/courses/detail/page.tsx`
- Modify: `app/page.tsx`
- Modify: `app/courses/page.tsx`
- Modify: `app/courses/[id]/page.tsx`
- Modify: `components/CourseCard.tsx`
- Modify: `components/CoursesExplorer.tsx`

- [ ] **Step 1: Add failing UI/API integration checks**

Add focused tests using the repository's `node:test` DOM harness pattern to assert that:

- list loading, retry, no-courses, and API error states are distinguishable;
- home and course list render endpoint course records and search title/instructor/description;
- course cards use the generic detail route with the ID query parameter;
- detail renders description, sorted outline, instructor, location, mode, and all price tiers;
- an unknown ID shows a course-not-found message;
- existing `/courses/<id>/` pages continue to load the matching ID from the endpoint.

- [ ] **Step 2: Run the focused integration checks and confirm failures**

Run: `node --test lib/course-api.test.mjs` and the new UI test file.

Expected: missing live components or outdated static course inputs fail the new assertions.

- [ ] **Step 3: Implement shared live list and detail components**

Create client components that call the tested API client on mount, show loading/error/retry states, and render live data only after validation. `CourseCard` must link to `/courses/detail/?id=<encoded course ID>`. `CoursesExplorer` must search against the live array without assuming optional strings are present.

Use the list component on the home page and `/courses`. Keep the existing detail route as a compatibility shell that passes its route ID to `LiveCourseDetail`; add `/courses/detail/` to read the query ID and render the same component. Remove server-side course-data generation from these course surfaces so JSON is not presented as current Sheet data.

- [ ] **Step 4: Run focused checks and static build**

Run:

```powershell
node --test lib/course-api.test.mjs
npm run build
```

Expected: live UI checks pass and Next.js exports both existing course paths and `/courses/detail/index.html`.

## Task 6: Fix date parsing across build and browser timezones

**Files:**
- Modify: `lib/data.ts`
- Create: `lib/course-date.mjs`
- Create: `lib/course-date.test.mjs`

- [ ] **Step 1: Write failing timezone-independent date tests**

Test the pure helpers imported from `lib/course-date.mjs` with a `YYYY-MM-DD` value such as `2026-11-17`; assert the formatted date is November 17 in both `UTC` and `Asia/Taipei` process timezones.

- [ ] **Step 2: Run the test and verify the current offset bug**

Run:

```powershell
$env:TZ = "UTC"; node --test lib/course-date.test.mjs
$env:TZ = "Asia/Taipei"; node --test lib/course-date.test.mjs
```

Expected: at least the UTC assertion fails because constructing midnight with `+08:00` and then using local getters shifts the displayed calendar day.

- [ ] **Step 3: Format date-only values using their calendar components**

Implement `formatCourseDate()` and `formatCourseDateLong()` in `lib/course-date.mjs` by parsing year, month, and day components without converting the date-only value through a timezone-shifted instant. Re-export them from `lib/data.ts` and preserve the existing localized output strings.

- [ ] **Step 4: Re-run date tests and build**

Run both timezone test commands above and `npm run build`.

Expected: both timezone runs show November 17 and the production build passes.

## Task 7: Document setup, migration, privacy, and deployment acceptance

**Files:**
- Modify: `gas/README.md`
- Modify: `README.md`

- [ ] **Step 1: Document the new editable course fields**

Update the Sheets schema section with the new Courses fields and exact `CourseOutline` / `CoursePricing` headers, sorting rules, and courseId relationship. Explain that all fields sent by the public endpoint are publicly readable and must not contain personal or administrative data.

- [ ] **Step 2: Document the safe migration and live update flow**

Add precise instructions to run `initializeWorkbook` after pushing the expanded GAS code, publish a new version of the existing public deployment once, and verify that changing location, description, outline, and pricing then appears on website reload without a Pages deployment. State explicitly that routine Sheet edits do not require pushing code.

- [ ] **Step 3: Run all relevant checks and inspect the diff**

Run:

```powershell
npm --prefix gas test
node --test lib/course-api.test.mjs lib/course-date.test.mjs lib/gas-registration-url.test.mjs
npm run build
git diff --check
```

Expected: all automated tests, static build, and whitespace checks pass. Record live Google deployment verification as pending unless the actual GAS deployment and Sheets account are available.

## Execution notes

- Do not overwrite or delete the user's existing spreadsheet values during migration.
- Do not hand-edit `gas/src/FallbackCourses.gs`; regenerate it with the documented command.
- Do not claim live synchronization is deployed until the GAS source has been pushed, the public Web App has a new version, and a real Sheet edit has been verified on GitHub Pages.
- The approved design document is `docs/superpowers/specs/2026-11-01-courses-sheet-as-live-source-design.md`.
