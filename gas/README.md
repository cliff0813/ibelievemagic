# 課程報名系統（Google Apps Script）

本資料夾包含課程報名／查詢／取消的 Apps Script 程式碼、Google Sheets 資料表結構及本機測試。靜態網站（GitHub Pages）只放一個公開報名網址；資料與管理都在 Google 端。

> **驗證範圍聲明**：本機自動測試（Node 模擬 Google 服務）**不等於**雲端部署驗證。尚未連接 Google 帳號、Google Sheets、`MailApp`、實際 Web App 部署或登入身分，這些都必須由使用者依本文件設定並完成「[部署驗收清單](#5-部署驗收清單使用者手動完成)」。

## 1. 本機設定與測試

- Node.js：`>=22.22.0`（見根目錄 `package.json` 的 `engines`；已用 v22.22.0 驗證）。

```powershell
npm --prefix gas install          # 安裝 @google/clasp
npm --prefix gas test             # node --test tests/*.test.cjs
npm --prefix gas run sync:fallback
```

### 備援課程檔 `FallbackCourses.gs`

- 輸入：`data/courses.json`（必須是陣列）。
- 輸出：`gas/src/FallbackCourses.gs`，內容為 `var FALLBACK_COURSES = [...]`。課程依 `date` 再依 `id` 排序、物件鍵依字母排序，輸出固定可重現。
- **此檔為產生檔，請勿手動編輯**；修改 `data/courses.json` 後重新執行 `npm --prefix gas run sync:fallback`，再一併提交。
- 用途：`Courses` 工作表沒有任何有效資料列（空表、或列缺少 `courseId` 或 `title`）時，Apps Script 使用此備援；`initializeWorkbook_()` 也會在 `Courses` 空白時以它填入初始資料（`manualRegistrationMode` 預設 `AUTO`）。

## 2. Google 設定

### 2.1 試算表與初始化

1. 建立一個 Google 試算表，記下網址中的試算表 ID。
2. 在 <https://script.google.com> 建立 Apps Script 專案，複製 **Script ID**。
3. 複製 `gas/.clasp.json.example` 為 `gas/.clasp.json`，填入真實 Script ID（此檔已被 `gas/.gitignore` 忽略，勿提交）：

   ```json
   {
     "scriptId": "<你的 Script ID>",
     "rootDir": "src"
   }
   ```

4. 將本機程式碼推送到這個 Apps Script 專案。`rootDir` 指向 `src`；推送後，Apps Script 編輯器才會出現 `initializeWorkbook_()`：

   ```powershell
   npm --prefix gas exec -- clasp login
   npm --prefix gas run push        # 等同 clasp push
   ```

5. 在 Apps Script 編輯器的 **專案設定 → 指令碼屬性** 設定：

   | 屬性 | 內容 |
   | --- | --- |
   | `SPREADSHEET_ID` | 步驟 1 的試算表 ID |
   | `ADMIN_EMAIL_ALLOWLIST` | 管理員 Gmail 白名單，以逗號、分號或換行分隔，例如 `a@gmail.com, b@gmail.com`；比對時去除空白並轉小寫 |

   > 實作實際讀取的屬性名稱是 **`ADMIN_EMAIL_ALLOWLIST`**（不是 `ADMIN_EMAILS`）。未設定或不在名單中時一律拒絕。

6. 在 Apps Script 編輯器重新整理專案，從上方函式選單選擇 `initializeWorkbook_`，按 **執行** 並完成 Google 授權。此函式會在步驟 1 指定的試算表建立 `Courses`、`Bookings`、`Participants`、`CancellationRequests`、`AuditLog` 工作表與標題列；若既有標題列與預期不符，會明確報錯而不覆寫。

### 2.2 部署兩個 Web App（同一份程式碼、兩個部署）

`appsscript.json` 未含 `webapp` 設定，須在 Apps Script **部署 → 新增部署 → 網頁應用程式** 手動設定：

| 部署 | 執行身分 | 存取權 | 用途 |
| --- | --- | --- | --- |
| 公開註冊 | **我（擁有者）** | **所有人**（含匿名） | 報名、查詢、申請取消；網址以 `/exec` 結尾 |
| 管理 | **存取網頁應用程式的使用者** | 需登入 Google 帳號 | 管理頁，網址為 `<管理 /exec 網址>?page=admin` |

- 管理頁（`?page=admin`）會先呼叫 `requireAdmin_()`：以 `Session.getActiveUser().getEmail()` 取得登入者並比對白名單。
- 每位 Gmail 管理員都必須：在 `ADMIN_EMAIL_ALLOWLIST` 中、對試算表有編輯權限，並完成 Apps Script 授權（試算表、寄信、Email scope）。
- 若 Apps Script 回傳**空白的使用者 Email**，管理功能會**失敗關閉**（拒絕）。請修正部署／帳號設定；**不要移除白名單檢查**。
- 管理部署網址與白名單屬私密資訊，不可放進公開網站、`data/` 或此儲存庫。
- 重新 `push` 後，須在部署中選擇「新版本」才會更新既有 `/exec`。

## 3. 圖片與網站連結

- **圖片**：`Courses` 表既有的 Supabase 圖片 URL 仍可繼續使用。新圖片放進 `public/images/courses/`，發佈到 GitHub Pages 後，於 `Courses.image` 填入公開 URL，格式為 `https://cliff0813.github.io/ibelievemagic/images/courses/<檔名>`（正式站 `basePath` 為 `/ibelievemagic`，請以實際網站網址為準）。
- **網站 CTA**：只把**公開註冊**部署的 `/exec` 網址填入 `data/gas-registration.json`：

  ```json
  { "webAppUrl": "https://script.google.com/macros/s/<部署 ID>/exec" }
  ```

  然後 `npm run build` 重新建置並發佈靜態網站。課程頁的 CTA 會附上 `?courseId=<課程 ID>`。
- 行為（`lib/gas-registration-url.mjs`）：
  - `webAppUrl` 為空：不產生報名連結，維持既有 LINE 聯絡方式。
  - 格式錯誤或非 `https`：不產生報名連結（LINE 仍保留），並在建置輸出以 `console.error` 顯示 `[gas-registration] ...` 診斷訊息。
- **不要**把管理部署網址或白名單寫入 `data/gas-registration.json` 或任何公開檔案。

## 4. 自動檢查（發佈前）

```powershell
npm --prefix gas test
node --test lib/gas-registration-url.test.mjs
npm --prefix gas run sync:fallback   # 之後 git diff 不應出現 FallbackCourses.gs 變更
npm run build
git diff --check
```

## 5. 部署驗收清單（使用者手動完成）

以下項目需要真實 Google 帳號、試算表與部署，本機測試無法代替。完成後請勾選。

- [ ] `Courses` 表為空時，公開頁使用 `FallbackCourses.gs` 備援課程。
- [ ] 試算表無法讀取（例如 `SPREADSHEET_ID` 錯誤或無權限）時，頁面顯示錯誤而非空白或假資料。
- [ ] 截止規則：課程日期前兩天（台北時間 00:00）起自動關閉；`manualRegistrationMode` 為 `CLOSED` 時關閉；`OPEN` 不能在自動截止後重新開放；截止前後與手動關閉的行為皆符合預期。
- [ ] 至少 3 人的團報可成功建立。
- [ ] 同課程同日期：手機**或** Email 任一重複都被拒絕。
- [ ] 以「查詢編號＋團主手機」可查到報名。
- [ ] 團報只能整筆申請取消；管理端可核准與拒絕，狀態與結果正確。
- [ ] 取消申請建立中途失敗（申請已寫入但報名狀態未更新）時，申請維持 `PENDING` 並回傳「需恢復」錯誤；團主以相同查詢編號＋手機重試，或管理端在該申請卡片按「繼續建立」，皆會補完為單一申請、報名 `CANCELLATION_PENDING`，重複執行不會產生重複申請；補完前不可核准／拒絕。
- [ ] 非白名單帳號、以及 Email 為空的登入者，均被拒絕進入管理功能。
- [ ] 通知信寄送失敗時，管理端可辨識；`SENDING`（或送達結果不確定）的通知被標示為需人工跟進，且**不會自動重寄**。
- [ ] GitHub Pages 課程頁的 CTA 帶入正確的 `courseId`，並開啟對應課程的報名頁。

### 目前尚待使用者完成

建立／授權 Google 試算表與 Apps Script 專案、設定 Script Properties、推送程式、建立兩個 Web App 部署、填入公開 `/exec` 網址並重新建置網站，以及上述所有驗收項目。**本儲存庫未宣稱任何已完成的雲端部署，也未驗證 Google Sheets 或 MailApp 的實際行為。**