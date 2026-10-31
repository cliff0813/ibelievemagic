# Google Sheets 課程報名系統 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立以 Google Sheets 為資料來源的 GAS 課程報名、查詢、取消申請及管理系統，並將現有課程詳情頁連至公開報名部署。

**Architecture:** GAS 程式碼放在 repo 的 `gas/`，以 Sheet repository 隔離 Google 服務，Domain functions 保持可由 Node.js 測試。公開報名部署以擁有者身分執行；管理端使用獨立的登入者身分部署及 Gmail 白名單。GitHub Pages 繼續以 `data/courses.json` 顯示課程，GAS Sheet 優先提供報名課程，空表時使用同步的 JSON 備援。

**Tech Stack:** Google Apps Script V8、HTML Service、Google Sheets、`LockService`、`MailApp`、Node.js 內建 `node:test`、`@google/clasp`、Next.js 靜態匯出。

---

## 檔案與責任

- `gas/src/appsscript.json`：Apps Script V8、Asia/Taipei 時區及必要授權範圍。
- `gas/src/Domain.gs`：純商業規則：截止時間、聯絡資料正規化、重複判斷及表單驗證。
- `gas/src/Schema.gs`、`gas/src/SheetRepository.gs`：試算表分頁／欄位初始化、課程讀取、報名與稽核資料讀寫。
- `gas/src/RegistrationService.gs`：送出報名、查詢 booking、提出取消申請與寄送通知。
- `gas/src/AdminService.gs`：管理員驗證、報名檢視、取消審核、手動開關及稽核紀錄。
- `gas/src/WebApp.gs`：GAS 網頁路由、公開頁與管理頁服務。
- `gas/src/Public.html`、`gas/src/Admin.html`、`gas/src/Styles.html`、`gas/src/Client.html`：單頁報名／查詢／取消 UI、管理 UI、共用樣式及瀏覽器端行為。
- `gas/src/FallbackCourses.gs`：由現有 JSON 產生的 GAS 備援資料，不手動編輯。
- `gas/scripts/sync-fallback.mjs`：將 `data/courses.json` 確定性地產生為 GAS 可讀的 fallback。
- `gas/tests/domain.test.cjs`、`gas/tests/repository.test.cjs`、`gas/tests/services.test.cjs`、`gas/tests/fallback.test.cjs`：Node 內建測試及 GAS 服務 mock。
- `gas/package.json`、`gas/package-lock.json`、`gas/.gitignore`、`gas/.clasp.json.example`：本地測試／部署指令、忽略本機 Script ID、部署設定範例。
- `data/gas-registration.json`：公開 GAS 部署網址；不含管理端網址或秘密。
- `lib/gas-registration-url.mjs`、`lib/gas-registration-url.test.mjs`：可測試的公開報名網址組合函式。
- `app/courses/[id]/page.tsx`：加入帶 `courseId` 的 GAS 線上報名連結；保留 LINE 聯絡入口。
- `gas/README.md`、`README.md`：建立試算表、設定權限、部署及驗收說明。

不要修改已存在的 `data/course-info.json` 或 `.github/workflows/deploy.yml`；GAS 報名 CTA 的公開網址放在獨立的 `data/gas-registration.json`，不把管理端網址、付款或聯絡設定放入前端。

## Task 1：建立 GAS 專案骨架與可測試的領域規則

**Files:**
- Create: `gas/package.json`
- Create: `gas/.gitignore`
- Create: `gas/.clasp.json.example`
- Create: `gas/src/appsscript.json`
- Create: `gas/src/Domain.gs`
- Create: `gas/tests/domain.test.cjs`

- [ ] **Step 1：建立測試命令並先寫截止與聯絡資料正規化測試**

先建立最小 `gas/package.json`，其中 `test` script 為 `node --test tests/*.test.cjs`；建立空的 `gas/src/Domain.gs`，再於 `gas/tests/domain.test.cjs` 用 `node:test` 與 `vm` 載入它。第一批測試至少使用以下情境：

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const domain = {};
vm.runInNewContext(
  fs.readFileSync(path.join(__dirname, "../src/Domain.gs"), "utf8"),
  domain,
);

test("自動截止為開課日前兩天台灣時間 00:00，人工開放不能越過截止", () => {
  assert.equal(
    domain.getCourseAvailability_("2026-11-17", new Date("2026-11-14T23:59:59+08:00"), "AUTO"),
    "OPEN",
  );
  assert.equal(
    domain.getCourseAvailability_("2026-11-17", new Date("2026-11-15T00:00:00+08:00"), "AUTO"),
    "CLOSED",
  );
  assert.equal(
    domain.getCourseAvailability_("2026-11-17", new Date("2026-11-15T00:00:00+08:00"), "OPEN"),
    "CLOSED",
  );
});

test("關閉狀態可提早停止；手機保留前導零並移除格式符號；Email 忽略大小寫", () => {
  assert.equal(
    domain.getCourseAvailability_("2026-11-17", new Date("2026-11-10T12:00:00+08:00"), "CLOSED"),
    "CLOSED",
  );
  assert.equal(domain.normalizePhone_("0912-345 678"), "0912345678");
  assert.equal(domain.normalizeEmail_("  User@Example.COM "), "user@example.com");
});
```

- [ ] **Step 2：執行測試確認失敗**

Run: `node --test --test-name-pattern="自動截止|關閉狀態" gas\tests\domain.test.cjs`

Expected: FAIL，測試可載入空的 `Domain.gs`，但被測函式尚未定義。

- [ ] **Step 3：補齊 GAS 與測試設定**

補上 `test`、`push` scripts（`sync:fallback` 留待 Task 2 隨 fallback 產生器加入），並將 `@google/clasp` 列為本地開發依賴。`gas/src/appsscript.json` 設定 `runtimeVersion: "V8"`、`timeZone: "Asia/Taipei"`、必要的 Sheets、Email 及登入者 Email scopes。`gas/.gitignore` 忽略 `/.clasp.json`；範例檔只說明 `rootDir` 指向 `src`，不放任何實際 Script ID。

- [ ] **Step 4：安裝本地開發工具**

Run: `npm --prefix gas install`

Expected: 產生 `gas/package-lock.json`，安裝 `@google/clasp`；不修改網站執行期相依套件。

- [ ] **Step 5：實作領域函式並通過測試**

`Domain.gs` 定義且只定義本層規則：`getCourseAvailability_(courseDate, now, manualMode)`、`normalizePhone_(value)`、`normalizeEmail_(value)`、`isExistingDuplicate_(courseId, courseDate, candidate, existing)`、`isDuplicateWithinSubmission_(candidate, earlierParticipants)`、`validateBookingInput_(payload)`。截止時間以 `Date.parse(courseDate + "T00:00:00+08:00") - 2 * 86400000` 計算；有效報名狀態為 `SUBMITTED` 與 `CANCELLATION_PENDING`；單筆團報內允許不同團員共用電話／Email，但完全相同的團員資料只能出現一次；團報需至少三位，個人報名需一位。

Run: `node --test --test-name-pattern="自動截止|關閉狀態" gas\tests\domain.test.cjs`

Expected: PASS。

- [ ] **Step 6：提交本任務**

```powershell
git add gas
git commit -m "feat: add GAS course registration foundation" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 2：產生 JSON 備援並建立試算表 repository

**Files:**
- Create: `gas/src/Schema.gs`
- Create: `gas/src/SheetRepository.gs`
- Create: `gas/scripts/sync-fallback.mjs`
- Create: `gas/src/FallbackCourses.gs`
- Create: `gas/tests/fallback.test.cjs`
- Create: `gas/tests/repository.test.cjs`
- Modify: `gas/package.json`

- [ ] **Step 1：先寫 fallback 與 repository 失敗情境測試**

測試 `sync-fallback.mjs` 讀取 repo 的 `data/courses.json`，產生可由 GAS 載入的 `FALLBACK_COURSES`，再以 `vm` 讀回並與來源 JSON 深度相等。Repository mock 測試涵蓋：缺少分頁時建立正確欄名；Courses 無可用資料時回傳 fallback；Courses 有資料時不混入 fallback；Google Sheets 日期值以 `Asia/Taipei` 格式化成 `yyyy-MM-dd`；Spreadsheet 服務丟出例外時保留錯誤並拒絕偽裝成空表。

- [ ] **Step 2：執行測試確認失敗**

Run: `npm --prefix gas test`

Expected: fallback 與 repository 測試失敗，因產生器與 repository 尚未存在。

- [ ] **Step 3：實作 fallback 產生器及分頁 schema**

產生器使用 Node 內建 `fs`、`path`，固定排序及格式化 JSON，輸出到 `gas/src/FallbackCourses.gs`。同時修改 `gas/package.json`，新增 `"sync:fallback": "node scripts/sync-fallback.mjs"` script。Schema 一次定義以下 headers，repository 和管理頁共用同一份欄位定義：

```text
Courses: courseId,title,date,startTime,endTime,location,mode,image,manualRegistrationMode
Bookings: bookingId,lookupCode,courseId,courseDate,leaderName,leaderPhone,leaderEmail,status,createdAt,confirmationEmailStatus
Participants: bookingId,courseId,courseDate,name,phone,email,lineName
CancellationRequests: requestId,bookingId,reason,status,requestedAt,reviewedBy,reviewedAt,notificationEmailStatus
AuditLog: eventId,actorEmail,action,recordId,createdAt
```

`initializeWorkbook_()` 建立缺少的分頁／表頭；Courses 為空時只在初始化流程將 fallback 課程匯入一次，管理員從 Apps Script 編輯器手動執行。公開讀取時若 Courses 為空則即時用 fallback；若讀取例外則向上拋出。Repository 僅負責資料 I/O，不含報名規則。

Bookings schema 在 Task 2 只定義 `bookingId` 與 `lookupCode` 欄位；repository 僅負責資料 I/O，不產生識別碼或處理查詢。`manualRegistrationMode` 空值代表 `AUTO`；只接受 `AUTO`、`OPEN`、`CLOSED`，其他值視為課程資料錯誤並停止報名。

- [ ] **Step 4：執行 fallback 與 repository 測試**

Run: `npm --prefix gas test`

Expected: 所有 Domain、fallback 及 repository 測試 PASS；讀取錯誤測試確認原始錯誤被回報。

- [ ] **Step 5：提交本任務**

```powershell
git add gas
git commit -m "feat: add spreadsheet repository and course fallback" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 3：實作報名、查詢及取消申請服務

**Files:**
- Create: `gas/src/RegistrationService.gs`
- Create: `gas/tests/services.test.cjs`
- Modify: `gas/src/SheetRepository.gs`
- Modify: `gas/src/Domain.gs`

- [ ] **Step 1：先測試服務狀態與重複報名規則**

先建立空的 `gas/src/RegistrationService.gs`，再以記憶體 repository、可觀察的 fake lock、fake mailer 注入服務依賴，測試：有效報名寫入一筆 Booking 與每位 Participants；既有有效報名的手機或 Email 任一相同即拒絕；取消待審仍拒絕重複；已核准取消後允許重新報名；同團不同學員共用聯絡資料可接受；團報少於三人拒絕；查詢碼或團主手機不符時回覆相同的「找不到報名」結果。

- [ ] **Step 2：執行服務測試確認失敗**

Run: `node --test --test-name-pattern="報名|取消|查詢" gas\tests\services.test.cjs`

Expected: FAIL，因 `RegistrationService.gs` 尚未實作服務函式。

- [ ] **Step 3：實作 `submitBooking(payload)`**

以 `LockService.getScriptLock().waitLock(...)` 保護重新讀課程狀態、重複檢查及寫入。依序建立 `PROCESSING` Booking、批次寫入 Participants、成功後將 Booking 改為 `SUBMITTED`；若任何寫入失敗，嘗試標記 `FAILED`，回傳明確錯誤且絕不呈現成功。只對 `SUBMITTED`／`CANCELLATION_PENDING` booking 的參加者做重複檢查。成功寫入後再寄確認信；寄信失敗時保留已建立資料及 lookup code，更新 `confirmationEmailStatus` 並將可複製的報名編號回傳前端。

建立 Booking 時，系統內部 `bookingId` 與學員看到、收到 Email 並輸入的 `lookupCode` 均以 `Utilities.getUuid()` 產生。

- [ ] **Step 4：實作 `lookupBooking(lookupCode, leaderPhone)` 與 `requestCancellation(lookupCode, leaderPhone, reason)`**

`lookupBooking(lookupCode, leaderPhone)` 與 `requestCancellation(lookupCode, leaderPhone, reason)` 都必須以 `lookupCode + leaderPhone` 精確比對，其中團主手機須先正規化。查詢只回傳相符的團報欄位；不存在、手機錯誤或代碼錯誤使用同一回應。取消只接受尚未取消且沒有待審申請的 booking，新增 `PENDING` request 並把 Booking 設為 `CANCELLATION_PENDING`，不刪除任何資料。

- [ ] **Step 5：執行服務測試並提交**

Run: `npm --prefix gas test`

Expected: 所有 Domain、repository、service 測試 PASS；fake lock 的 `releaseLock()` 在成功與錯誤路徑都被呼叫。

```powershell
git add gas
git commit -m "feat: add GAS booking and cancellation services" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 4：建立公開單頁報名與自助查詢介面

**Files:**
- Create: `gas/src/WebApp.gs`
- Create: `gas/src/Public.html`
- Create: `gas/src/Styles.html`
- Create: `gas/src/Client.html`
- Modify: `gas/src/RegistrationService.gs`

- [ ] **Step 1：實作公開頁路由及資料 API**

`doGet(e)` 預設服務公開頁，使用 `e.parameter.courseId` 預選課程；只傳入可以顯示的課程欄位。Apps Script 會讓所有未以底線結尾的全域函式可由 `google.script.run` 呼叫，因此初始化器及所有內部 helper／repository 函式都必須以 `_` 結尾。公開 API 僅為 `listOpenCourses`、`submitBooking`、`lookupBooking`、`requestCancellation`；管理 API 僅提供 Task 5 明列的操作，且每個入口均須執行 `requireAdmin_()`。不得暴露 Spreadsheet ID、整張表或任意範圍讀取／寫入 API。

- [ ] **Step 2：實作單頁報名 UI**

表單包含課程選擇、團主姓名／手機／Email、個人或團體模式、學員姓名／手機／Email／LINE 名稱、個資使用同意及可新增／移除的團員列。選團報時小於三人不能送出。GAS 報名頁不顯示價格、金流或名額剩餘數。使用 `textContent` 呈現來自 Sheet 的文字；不以 `innerHTML` 插入課程或學員資料。

- [ ] **Step 3：實作提交、查詢及取消的瀏覽器狀態**

送出時停用按鈕並顯示等待狀態；`withSuccessHandler` 顯示成功／驗證錯誤，`withFailureHandler` 顯示可理解的服務錯誤。成功頁顯示報名編號和 Email 寄送狀態。查詢表單要求報名編號及團主手機；查詢成功只展示該團報。取消需先確認整筆團報取消，再送出可選原因；結果明確標為「待管理員審核」，不能立即顯示已取消。

- [ ] **Step 4：在 Apps Script 測試部署驗收公開流程**

以 GAS 開發測試部署驗證：有效課程顯示、`courseId` 預選、超過截止課程不顯示、錯誤輸入不寫入、單人／三人團報、重複報名回覆、成功頁顯示編號、Email 失敗仍能複製編號、錯誤查詢不洩露 booking 是否存在。

- [ ] **Step 5：提交本任務**

```powershell
git add gas
git commit -m "feat: add public GAS registration page" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 5：建立獨立登入管理部署及營運操作

**Files:**
- Create: `gas/src/AdminService.gs`
- Create: `gas/src/Admin.html`
- Modify: `gas/src/WebApp.gs`
- Modify: `gas/src/SheetRepository.gs`
- Modify: `gas/tests/services.test.cjs`

- [ ] **Step 1：先測試管理員身分及截止後不可重開**

先建立空的 `gas/src/AdminService.gs`，使用 fake `Session.getActiveUser().getEmail()` 測試：白名單 Gmail 可讀取待審申請；非白名單帳號、空 Email 及未登入全部拒絕；拒絕時不呼叫任何寫入方法。另測試手動關閉可提早關課，手動開放只在自動截止前有效，截止後即使手動模式為 `OPEN` 仍回傳 `CLOSED`。

- [ ] **Step 2：執行管理測試確認失敗**

Run: `node --test --test-name-pattern="管理|白名單|手動" gas\tests\services.test.cjs`

Expected: FAIL，因管理服務尚未建立。

- [ ] **Step 3：實作伺服器端管理員驗證**

新增 `requireAdmin_()`，每一個管理 API 開始時取得登入者 Email、正規化後比對 Script Properties 的 Gmail 白名單；空值或取得失敗採 fail-closed。管理頁面的顯示控制不算授權。此檢查必須套用到讀取名單、讀取取消申請、審核取消及課程開關所有伺服器端方法。

- [ ] **Step 4：實作取消審核、課程開關及稽核**

管理頁可檢視報名、列出待審取消、核准／拒絕及開關報名。審核只處理 `PENDING` request：核准將整筆 Booking 改為 `CANCELLED`，拒絕恢復 `SUBMITTED`；每次決定寫 AuditLog 並通知團主。通知失敗更新 `notificationEmailStatus` 並留在管理頁供後續處理。手動關閉可立即生效；手動開放在截止後回覆明確錯誤，不修改課程。報名與取消處理紀錄不可被管理 UI 刪除。

- [ ] **Step 5：測試並提交管理功能**

Run: `npm --prefix gas test`

Expected: 所有測試 PASS，含空登入 Email fail-closed、非白名單不會寫表、核准／拒絕狀態與手動截止規則。

```powershell
git add gas
git commit -m "feat: add restricted GAS admin operations" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 6：將既有課程詳情頁連至 GAS

**Files:**
- Create: `data/gas-registration.json`
- Create: `lib/gas-registration-url.mjs`
- Create: `lib/gas-registration-url.test.mjs`
- Modify: `app/courses/[id]/page.tsx`

- [ ] **Step 1：先測試公開報名 URL 組合**

先建立 `lib/gas-registration-url.test.mjs` 並使用以下測試：

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { gasRegistrationHref } from "./gas-registration-url.mjs";

test("保留既有查詢參數並附上編碼後的課程 ID", () => {
  assert.equal(
    gasRegistrationHref("https://script.google.com/macros/s/deploy/exec?src=site", "course/1"),
    "https://script.google.com/macros/s/deploy/exec?src=site&courseId=course%2F1",
  );
});

test("未設定公開 GAS URL 時不產生失效連結", () => {
  assert.equal(gasRegistrationHref("", "course-1"), null);
});
```

- [ ] **Step 2：執行測試確認失敗**

Run: `node --test lib/gas-registration-url.test.mjs`

Expected: FAIL，因 `gas-registration-url.mjs` 尚未建立。

- [ ] **Step 3：新增 URL 設定與組合函式**

建立 `data/gas-registration.json`，初始 `webAppUrl` 為空字串。正式部署公開 GAS 報名頁後，將其 `/exec` 網址填入並重新建置靜態網站；此欄位只存公開報名部署 URL，不存管理部署 URL 或白名單。實作 `gasRegistrationHref(baseUrl, courseId)`：空 URL 回傳 `null`，非空 URL 以 `new URL` 解析並用 `searchParams.set("courseId", courseId)` 加上課程 ID。以 JSDoc 型別標註 `string` 參數與 `string | null` 回傳值。

- [ ] **Step 4：更新課程詳情頁 CTA**

在 `app/courses/[id]/page.tsx` 匯入 `data/gas-registration.json` 及 `gasRegistrationHref`。URL 為空時不產生失效連結，保留現有 LINE 聯絡 CTA；設定後顯示「線上報名」按鈕，LINE 仍保留為詢問入口。維持網站既有 JSON 課程資料、費用／匯款顯示及所有靜態路由。

- [ ] **Step 5：執行 URL 測試與 Next.js 建置**

Run: `node --test lib/gas-registration-url.test.mjs`

Expected: URL 測試 PASS。

Run: `npm run build`

Expected: 靜態匯出成功；使用設定好的公開 GAS URL 時連結含正確 `courseId`，空設定時仍可建置且保留 LINE 入口。

- [ ] **Step 6：提交網站整合**

```powershell
git add -- data/gas-registration.json ":(literal)app/courses/[id]/page.tsx"
git commit -m "feat: link course pages to GAS registration" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 7：完成設定文件與端到端驗收

**Files:**
- Create: `gas/README.md`
- Modify: `README.md`
- Modify: `gas/package.json` only if a verified command is missing

- [ ] **Step 1：文件化本機測試與 JSON 同步**

記錄 Node.js 需求、`npm --prefix gas install`、`npm --prefix gas test`、`npm --prefix gas run sync:fallback`、fallback 產生規則及產生檔不可手動編輯。

- [ ] **Step 2：文件化 Google 設定及雙部署**

記錄建立試算表及從 Apps Script 編輯器手動執行 `initializeWorkbook_()`、設定 Script Properties 的 `SPREADSHEET_ID` 與 `ADMIN_EMAILS`、建立 GAS 專案後將實際 Script ID 放入本機忽略的 `gas/.clasp.json`、`clasp login`／push、將部署程式碼發布成兩個 Web App：公開註冊部署以擁有者身分執行並公開存取；管理部署要求登入、以登入者身分執行，並由每個 Gmail 管理員取得試算表權限與授權。若測試帳號 Email 為空，管理功能應拒絕操作，不得移除白名單檢查。

- [ ] **Step 3：文件化圖片與網站連結**

說明現有 Supabase 圖片 URL 可留在 Courses 表；新圖片放 `public/images/courses/` 並填入 GitHub Pages 公開 URL。將公開註冊部署網址填入 `data/gas-registration.json` 的 `webAppUrl` 並重新建置靜態網站；管理部署網址不寫入公開網站。

- [ ] **Step 4：執行完整自動檢查**

Run: `npm --prefix gas test`

Expected: 所有 Domain、fallback、repository、service 測試 PASS。

Run: `node --test lib/gas-registration-url.test.mjs`

Expected: URL 測試 PASS。

Run: `npm --prefix gas run sync:fallback`

Expected: `gas/src/FallbackCourses.gs` 與 `data/courses.json` 同步且無非預期差異。

Run: `npm run build`

Expected: Next.js 靜態建置及匯出成功。

- [ ] **Step 5：依設計驗收實際部署**

測試空 Courses 表使用 JSON 備援、試算表讀取故障時顯示錯誤、截止前後／手動關閉、至少三人團報、同課程同日手機或 Email 重複、團主手機加編號查詢、團報整筆取消待審／核准／拒絕、非白名單和空登入 Email 拒絕、通知寄送失敗可在管理端辨識，以及 GitHub Pages CTA 傳入課程 ID。無法連接 Google 帳號或尚未設定部署時，記錄為待使用者完成帳號設定，不把本機測試描述成已完成雲端部署。

- [ ] **Step 6：提交文件與最終驗證**

```powershell
git add gas/README.md README.md
git commit -m "docs: document GAS registration setup and validation" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
git status --short
```

Expected: 本任務文件已提交；其他使用者既有的工作目錄變更保持未暫存、未提交。
