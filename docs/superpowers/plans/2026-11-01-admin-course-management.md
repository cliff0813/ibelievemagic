# 管理頁課程管理功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 GAS 管理頁安全新增、編輯與刪除課程及其課綱／費用資料，並維持報名資料關聯。

**Architecture:** GAS 管理頁以共用表單操作 `Courses`、`CourseOutline`、`CoursePricing`，後端只提供明確的管理 API，不暴露通用工作表寫入介面。每個 API 驗證管理員並在 Script Lock 下驗證與寫入；編輯日期同步更新所有相關 `Bookings.courseDate`，已有任一報名列的課程不可刪除。

**Tech Stack:** Google Apps Script、Google Sheets、HtmlService、原生 JavaScript、Node.js `node:test`、Next.js 靜態建置。

---

## 檔案責任與預計變更

- `gas/src/SheetRepository.gs`：新增按關聯欄位安全刪除／取代工作表列的私有 helper；沿用 `SHEET_SCHEMAS_`、`getSheetRecords_`、`appendSheetRecords_`、`updateCourse_`、`updateBooking_`。
- `gas/src/AdminService.gs`：擴充管理課程讀取資料，新增受 `requireAdmin_()` 保護的建立、更新、刪除 API；在同一 Script Lock 中執行驗證與變更。
- `gas/src/Admin.html`：新增固定顯示的共用表單、可增減的課綱／費用列、課程編輯／刪除操作及明確狀態回饋；沿用 `textContent` 建立使用者可見內容。
- `gas/tests/repository.test.cjs`：覆蓋工作表 helper 的關聯篩選、同課程多列與其他課程資料保留。
- `gas/tests/course-admin.test.cjs`：新增獨立的 GAS 管理課程服務測試 harness，涵蓋權限、驗證、正常操作、部分失敗重試、鎖及跨分頁資料保護。
- `gas/tests/course-admin-ui.test.cjs`：以 fake DOM 與 fake `google.script.run` 測試共用表單與課程卡片互動，不需真實 Google 部署。
- `gas/tests/public-webapp.test.cjs`：更新公開／管理可呼叫 API 清單及管理頁標記測試，確認新 API 沒有誤加到公開路由。
- `gas/tests/services.test.cjs`：將新管理方法納入「未授權時必須在任何讀寫前拒絕」的既有回歸測試。
- `gas/README.md`：新增管理頁課程維護、報名關聯刪除保護與 GAS 更新／部署說明；保留既有手動工作表欄位及公開端點文件。

## 實作任務

### Task 1：建立可重試的工作表列操作 helper

**Files:**
- Modify: `gas/src/SheetRepository.gs`
- Modify: `gas/tests/repository.test.cjs`

- [ ] **Step 1: 為關聯列刪除與取代寫失敗測試**

在 repository 測試加入：

```js
test("replaceSheetRecordsByValue_ only replaces rows for the selected course", () => {
  const { context, sheets } = loadRepository({
    sheets: {
      CourseOutline: createSheet("CourseOutline", [
        ["courseId", "sortOrder", "item"],
        ["course-a", 1, "舊項目"],
        ["course-b", 1, "保留項目"],
        ["course-a", 2, "另一舊項目"],
      ]),
    },
  });

  context.replaceSheetRecordsByValue_("CourseOutline", "courseId", "course-a", [
    { courseId: "course-a", sortOrder: 1, item: "新項目" },
  ]);

  assert.deepEqual(
    sheets.CourseOutline.rows.slice(1),
    [
      ["course-b", 1, "保留項目"],
      ["course-a", 1, "新項目"],
    ],
  );
});
```

並為 `deleteSheetRecordsByValue_` 加測試：刪除同一 `courseId` 的所有列、保留其他 ID 的列、重複呼叫回傳零筆且不丟失資料。

- [ ] **Step 2: 執行 repository 測試確認新測試失敗**

Run: `node --test gas/tests/repository.test.cjs`

Expected: 新測試因 `replaceSheetRecordsByValue_`／`deleteSheetRecordsByValue_` 尚未定義而失敗。

- [ ] **Step 3: 實作最小私有 helper**

在 `SheetRepository.gs` 加入 `deleteSheetRecordsByValue_(sheetName, key, keyValue)` 與 `replaceSheetRecordsByValue_(sheetName, key, keyValue, records)`。兩個 helper 都先確認 `sheetName` 存在 `SHEET_SCHEMAS_`、`key` 是該分頁標題，再由 `getRegistrationSpreadsheet_()` 取得分頁；缺少分頁或不合法欄位時明確拋錯。刪除 helper 以欄位 index 找出所有完全相等的 key 列，由最大 row number 往最小 row number 呼叫 `sheet.deleteRow(rowNumber)`，回傳實際移除筆數。取代 helper 在任何刪除前檢查 `records` 為陣列且每筆記錄的 key 都等於 `keyValue`，再先刪除舊列、用 `appendSheetRecords_` 加入新列；空陣列代表只刪除舊列。不得清空或改寫其他 `courseId`。

- [ ] **Step 4: 重跑 repository 測試**

Run: `node --test gas/tests/repository.test.cjs`

Expected: 所有 repository 測試通過。

- [ ] **Step 5: 提交此任務**

```powershell
git add gas/src/SheetRepository.gs gas/tests/repository.test.cjs
git commit -m "feat: add course sheet row helpers" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 2：新增管理課程後端 API 與服務測試

**Files:**
- Modify: `gas/src/AdminService.gs`
- Create: `gas/tests/course-admin.test.cjs`

- [ ] **Step 1: 建立獨立服務 harness 與第一組失敗測試**

新增 `course-admin.test.cjs`，用 `node:vm` 載入 `Schema.gs`、`SheetRepository.gs`、`AdminService.gs`，以記憶體試算表分頁模擬 `getRange`、`setValues`、`deleteRow`，並提供 `Session`、`PropertiesService`、`LockService`、`Utilities.getUuid`。先寫下列測試：

```js
test("createAdminCourse writes AUTO course, ordered content, and locks the operation", () => {
  const { context, state } = createCourseAdminHarness();

  const result = context.createAdminCourse({
    courseId: "course-new",
    title: "新課程",
    date: "2026-12-15",
    startTime: "13:30",
    endTime: "16:30",
    outline: ["第一單元", "第二單元"],
    pricing: [{ label: "一般原價", price: 1800 }],
  });

  assert.equal(result.courseId, "course-new");
  assert.equal(state.courses[0].manualRegistrationMode, "AUTO");
  assert.deepEqual(state.outline.map((row) => row.sortOrder), [1, 2]);
  assert.equal(state.pricing[0].price, 1800);
  assert.equal(state.lockAcquired, state.lockReleased);
});
```

第一版測試 payload 應明確包含 `outline`、`pricing` 陣列；共用測試 factory 亦可接受多課程、所有狀態的報名列及指定寫入步驟失敗。

- [ ] **Step 2: 執行測試確認管理 API 尚不存在**

Run: `node --test gas/tests/course-admin.test.cjs`

Expected: 新增測試因 `createAdminCourse` 尚未定義而失敗。

- [ ] **Step 3: 寫驗證與建立即時更新測試**

在同一測試檔逐一加入以下案例，先確認它們失敗：

1. 非白名單管理員呼叫新增、更新、刪除任一 API 時，在任何 repository 讀寫前拒絕。
2. 空白或重複 `courseId`、空白必填欄位、非 `YYYY-MM-DD` 日期、非 `HH:mm` 時間、非數值價格皆拒絕且不改變任何分頁。
3. 同 `courseId` 且相同基本資料的新增重試只保留一筆課程及最新一組課綱／費用；同 ID 不同基本資料拒絕。
4. 更新保留 `courseId` 及原有 `manualRegistrationMode`，完整取代指定課程的課綱／費用，其他課程資料不變。
5. 更新日期時同步更新所有狀態的 `Bookings.courseDate`，保留報名列其他欄位及其他課程報名資料。
6. 有任何同課程報名列時刪除拒絕且不變更資料；無報名時刪除課程及關聯列，保留其他課程。
7. 在建立／更新／刪除／報名日期更新的各個分頁寫入點注入一次失敗，錯誤明確指出操作及課程 ID；重試相同 payload 後收斂至唯一正確資料，不重複列。
8. 每個操作均釋放 Script Lock，即使驗證後寫入失敗亦如此。

- [ ] **Step 4: 執行測試確認服務案例失敗**

Run: `node --test gas/tests/course-admin.test.cjs`

Expected: 新增、更新、刪除與失敗恢復案例因服務 API 尚未實作而失敗。

- [ ] **Step 5: 擴充管理課程讀取資料**

更新 `listAdminCourses()`，先執行 `requireAdmin_()`，再回傳表單所需課程欄位、依 `sortOrder` 排序的 `outline` 與 `pricing`，以及既有報名開關所需的 `pendingRecovery`。不回傳報名者或工作表私密資料。

- [ ] **Step 6: 實作並驗證新增 API**

新增 `createAdminCourse(course)`，入口第一步呼叫 `requireAdmin_()`，在取得 Script Lock 後重讀最新 `Courses`、`CourseOutline`、`CoursePricing`。新增前驗證所有必填欄位、`YYYY-MM-DD` 是有效日曆日期、`HH:mm` 小時／分鐘在有效範圍、outline item 非空、pricing label 非空且 price 為有限數字。以 `manualRegistrationMode: "AUTO"` 正規化整列。ID 不存在時先取代該 ID 的 outline／pricing 列，再追加 Courses 列；若同 ID 且基本課程欄位一致，視為前次新增重試並以本次完整 payload 收斂關聯列；若同 ID 的基本資料不同則拋出 duplicate-ID 錯誤。所有鎖都在 `finally` 釋放。

- [ ] **Step 7: 實作並驗證更新 API**

新增 `updateAdminCourse(courseId, course)`。在鎖內重新讀取目標課程及相關報名；拒絕不存在的課程；以現有 `manualRegistrationMode` 建立更新資料，不接受客戶端變更 ID 或報名模式。依序同步相關 `Bookings.courseDate`、取代該課程的課綱／費用列、更新 `Courses` 列。所有動作以相同 payload 重試後應收斂。

- [ ] **Step 8: 實作並驗證刪除 API**

新增 `deleteAdminCourse(courseId)`。在鎖內先確認課程存在、再查所有 `Bookings`（不篩選狀態）；有關聯報名就明確拒絕。沒有報名時先刪除兩個內容分頁的相關列、最後刪除課程列。重試需能清理殘留內容列；若課程與內容列皆不存在則視為已完成。

- [ ] **Step 9: 執行完整管理服務測試**

Run: `node --test gas/tests/course-admin.test.cjs`

Expected: 全部新增服務、驗證、保護及注入失敗後重試測試通過。

- [ ] **Step 10: 提交此任務**

```powershell
git add gas/src/AdminService.gs gas/tests/course-admin.test.cjs
git commit -m "feat: add admin course CRUD services" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 3：建立管理頁共用新增／編輯表單與互動測試

**Files:**
- Modify: `gas/src/Admin.html`
- Create: `gas/tests/course-admin-ui.test.cjs`

- [ ] **Step 1: 新增 UI 測試 harness 與表單標記測試**

複製既有 `public-webapp.test.cjs` 的 HtmlService client 測試模式到獨立檔案：讀取 `Admin.html` 內的 `<script>` 並在 `node:vm` 執行，提供 fake `document`、可記錄 `addEventListener` 的元素、fake `google.script.run` 及可控制的 Promise 回應。先寫固定新增表單、課綱／費用容器、編輯模式與新增／更新／刪除 API 呼叫的失敗測試。

- [ ] **Step 2: 執行 UI 測試確認失敗**

Run: `node --test gas/tests/course-admin-ui.test.cjs`

Expected: 表單標記與 client 操作測試因尚無表單及 API 呼叫而失敗。

- [ ] **Step 3: 加入固定表單與欄位**

在 `course-list` 前新增標記完整的「新增課程」表單，包含：

```html
<form id="course-form">
  <input id="course-id" name="courseId" required>
  <input id="course-title" name="title" required>
  <input id="course-date" name="date" type="date" required>
  <input id="course-start-time" name="startTime" type="time" required>
  <input id="course-end-time" name="endTime" type="time" required>
  <div id="course-outline"></div>
  <div id="course-pricing"></div>
  <button id="course-submit" type="submit">新增課程</button>
</form>
```

一併加入地點、模式、圖片完整網址、說明、講師及講師簡介欄位，課綱／費用新增列與移除按鈕、取消編輯按鈕，以及 `manualRegistrationMode` 的 `AUTO` 說明。所有欄位以 label 關聯並使用適當 input type。

- [ ] **Step 4: 加入安全的表單 DOM helper**

以 `document.createElement` 建立欄位、按鈕及清單列；文字寫入 `textContent`、輸入資料放 `value`，不得把課程資料串接到 `innerHTML`。新增列後設定正確的欄位名稱，費用欄位採 `type="number"`，並可刪除單列。

- [ ] **Step 5: 實作新增與課程列表編輯**

新增模式時透過 HTTPS HtmlService 頁面的 `crypto.randomUUID()` 產生 UUID，允許管理員提交前編輯 ID；若 UUID API 不可用，顯示明確錯誤並禁止提交，不能用弱隨機數代替。編輯模式由課程卡片讀取 `listAdminCourses()` 提供的課程、課綱與費用資料填入共用表單，設定 ID 唯讀，更新按鈕文字，顯示取消編輯。

表單提交時執行原生必填驗證與費用數字檢查，依目前模式呼叫 `createAdminCourse` 或 `updateAdminCourse`，payload 包含基本欄位、課綱陣列及費用陣列。成功後重設至新增模式、產生新 UUID 並重新整理清單；失敗時保留所有原輸入供檢查或重試。

- [ ] **Step 6: 實作刪除確認與失敗狀態**

課程卡片新增「編輯」與「刪除」按鈕。刪除先呼叫 `window.confirm` 說明關聯報名將阻止刪除，再呼叫 `deleteAdminCourse(courseId)`。使用者取消時不呼叫伺服器；失敗時在 `admin-status` 顯示錯誤並保留頁面資料；成功時顯示狀態並重新整理。既有報名開關及取消復原按鈕行為不得改變。

- [ ] **Step 7: 加入表單與安全互動測試**

測試 UUID 預設可編輯、編輯載入後 ID 唯讀、取消編輯、課綱與價格列新增／移除／排序、所有欄位映射正確、伺服器失敗時輸入保留、確認取消不發 API、確認刪除發 API、動態課程文字使用純文字 DOM API。

- [ ] **Step 8: 執行 UI 測試**

Run: `node --test gas/tests/course-admin-ui.test.cjs`

Expected: 新增／編輯／刪除 UI 測試通過。

- [ ] **Step 9: 提交此任務**

```powershell
git add gas/src/Admin.html gas/tests/course-admin-ui.test.cjs
git commit -m "feat: add course management form to admin" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 4：更新管理 API 權限與 GAS 路由回歸測試

**Files:**
- Modify: `gas/tests/public-webapp.test.cjs`
- Modify: `gas/tests/services.test.cjs`

- [ ] **Step 1: 更新 GAS 可呼叫函式清單測試**

在 `public-webapp.test.cjs` 的預期管理 API 清單加入 `createAdminCourse`、`updateAdminCourse`、`deleteAdminCourse`；確認所有 `.gs` 公開函式仍只由管理頁或既有公開端點呼叫，不把 CRUD 接到 JSONP。

- [ ] **Step 2: 擴充每個管理 API 的未授權測試**

在 `services.test.cjs` 的管理 API 呼叫表加入建立、更新、刪除；每次以非白名單身分呼叫都應拒絕，且 `repositoryReads`、`repositoryWrites` 均維持零。管理頁入口仍在 `doGet` 評估範本前檢查身份。

- [ ] **Step 3: 執行服務與 Web App 回歸測試**

Run: `node --test gas/tests/services.test.cjs gas/tests/public-webapp.test.cjs gas/tests/course-admin.test.cjs gas/tests/course-admin-ui.test.cjs`

Expected: 管理課程 CRUD、舊管理 API、公開課程端點及 JSONP 安全測試全部通過。

- [ ] **Step 4: 提交此任務**

```powershell
git add gas/tests/public-webapp.test.cjs gas/tests/services.test.cjs
git commit -m "test: protect admin course endpoints" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 5：更新管理與部署文件並完成驗證

**Files:**
- Modify: `gas/README.md`

- [ ] **Step 1: 更新管理頁功能說明**

說明管理頁可建立、編輯及刪除課程；新課程預設 `AUTO`；列出 `Courses`、`CourseOutline`、`CoursePricing` 欄位對應、動態多列排序與穩定 `courseId`；說明編輯日期會更新所有相關報名列 `courseDate`。

- [ ] **Step 2: 更新刪除保護及重新部署說明**

明確說明任何狀態的報名列都會阻止刪除課程；無報名時會一併清除課綱及費用資料。新增管理 CRUD 程式碼後需推送 GAS 並發布既有管理部署的新版本；之後僅操作試算表／管理頁新增課程不需重新部署 GAS 或 GitHub Pages。不可在文件加入管理 URL、白名單或試算表私密資訊。

- [ ] **Step 3: 執行全部 GAS 測試**

Run: `npm --prefix gas test`

Expected: `node --test tests/*.test.cjs` 全部通過。

- [ ] **Step 4: 執行網站靜態建置**

Run: `npm run build`

Expected: Next.js 靜態輸出成功；此管理頁變更不新增公開網站路由或部署依賴。

- [ ] **Step 5: 檢查差異與提交文件**

Run: `git diff --check`

Expected: 無空白錯誤，`git status --short` 僅列本任務文件或待提交變更。

```powershell
git add gas/README.md
git commit -m "docs: explain admin course management" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## 規格涵蓋自我檢查

- 新增／編輯／刪除與固定共用表單：Tasks 2–3。
- 欄位、UUID、AUTO、動態排序與課綱／費用資料：Tasks 2–3。
- 管理授權與併發鎖：Tasks 2、4。
- 日期同步全部報名列、禁止有報名的課程刪除、保留其他課程資料：Tasks 1–2。
- 部分寫入錯誤明確及同 payload 安全重試：Tasks 1–2。
- 公開 API 隔離、管理頁 XSS 安全、既有功能回歸：Tasks 3–4。
- 管理者部署說明與靜態建置驗收：Task 5。
