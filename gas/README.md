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

1. 建立 Google 試算表並取得試算表 ID：
   1. 開啟 <https://sheets.google.com>，點「空白試算表」。
   2. 左上角把檔名改成「課程報名資料」（名稱自訂）。
   3. 看瀏覽器網址列：`https://docs.google.com/spreadsheets/d/<試算表 ID>/edit...`，複製 `/d/` 與 `/edit` 中間那一段，暫存備用。
   4. 此時不需要手動建立工作表，步驟 8 會自動建立。
2. 建立 Apps Script 專案並取得 Script ID：
   1. 開啟 <https://script.google.com>，點「新專案」。
   2. 左上角把專案名稱改成「課程報名系統」。
   3. 左側齒輪「**專案設定**」→「**IDs**」區塊的「**指令碼 ID**」→ 點「複製」。
   4. 此專案是獨立專案即可（不必從試算表的「擴充功能」建立），程式會用 `SPREADSHEET_ID` 開啟試算表。
3. 在本機建立 `gas/.clasp.json`（此檔已被 `gas/.gitignore` 忽略，勿提交）：
   1. 在 VS Code 檔案總管展開 `gas` 資料夾，複製 `.clasp.json.example`，貼上並改名為 `.clasp.json`。
   2. 開啟 `.clasp.json`，把 `scriptId` 換成步驟 2 複製的指令碼 ID，並儲存：

      ```json
      {
        "scriptId": "<你的 Script ID>",
        "rootDir": "src"
      }
      ```

   3. 不要手動逐字輸入，請用貼上；可在終端機執行 `Get-Content .\gas\.clasp.json` 確認內容。
4. 啟用 Google Apps Script API（每個 Google 帳號只需一次，否則 `push` 會出現 `User has not enabled the Apps Script API`）：
   1. 用建立 Apps Script 專案的同一個 Google 帳號開啟 <https://script.google.com/home/usersettings>。
   2. 將「**Google Apps Script API**」開關切換為**開啟**。
   3. 等待 1 到 5 分鐘讓設定生效。

5. 安裝套件並登入 clasp（在專案根目錄的 VS Code 終端機執行）：

   ```powershell
   npm --prefix gas install
   npm --prefix gas exec -- clasp login
   ```

   1. 瀏覽器會開啟 Google 授權頁，選擇與步驟 2 相同的帳號。
   2. 授權頁的權限勾選：建議至少勾選「查看您的 Google 雲端硬碟檔案相關資訊」「查看、編輯、建立及刪除您透過這個應用程式使用的特定 Google 雲端硬碟檔案」「建立及更新 Google Apps Script 專案」；最簡單的方式是**全部勾選**後按「繼續」。
   3. 看到「Logged in」或授權成功頁後回到終端機。

6. 將本機程式碼推送到這個 Apps Script 專案。`rootDir` 指向 `src`：

   ```powershell
   npm --prefix gas run push
   ```

   1. 出現 `Manifest file has been updated. Do you want to push and overwrite?` 時選 **Yes**（本機 `appsscript.json` 含時區 `Asia/Taipei` 與所需權限）。
   2. 成功時終端機會列出推送的檔案（共 12 個）。
   3. 回到 Apps Script 編輯器，**重新整理瀏覽器頁面**，左側「檔案」應出現 `SheetRepository.gs`、`Domain.gs` 等檔案。
   > 請在專案根目錄用 `npm --prefix gas run push` 執行；直接執行 clasp 指令（例如 `clasp status`）時須先 `cd gas`，否則會出現 `Project settings not found.`。

7. 在 Apps Script 編輯器左側齒輪「**專案設定**」，捲到最下方「**指令碼屬性**」，按「**新增指令碼屬性**」，逐一新增後按「**儲存指令碼屬性**」：

   | 屬性 | 內容 |
   | --- | --- |
   | `SPREADSHEET_ID` | 步驟 1 的試算表 ID |
   | `ADMIN_EMAIL_ALLOWLIST` | 管理員 Gmail 白名單，以逗號、分號或換行分隔，例如 `a@gmail.com, b@gmail.com`；比對時去除空白並轉小寫 |

   > 實作實際讀取的屬性名稱是 **`ADMIN_EMAIL_ALLOWLIST`**（不是 `ADMIN_EMAILS`）。未設定或不在名單中時一律拒絕。

8. 執行初始化函式建立工作表：
   1. 在 Apps Script 編輯器左側點「編輯器」（`</>` 圖示），再點檔案 `SheetRepository.gs`。
   2. 上方工具列的函式下拉選單選擇 **`initializeWorkbook`**（**沒有底線**的公開入口；結尾為底線的 `initializeWorkbook_` 是私有函式，不會出現在選單中，且 `initializeWorkbook` 只是呼叫它）。
   3. 按「**執行**」。第一次會出現「需要授權」→「審查權限」→ 選擇帳號 →（若顯示「Google 尚未驗證這個應用程式」，點「進階」→「前往『課程報名系統』（不安全）」）→「允許」。
   4. 下方「執行記錄」出現「執行完畢」代表成功。
   5. 回到試算表（需重新整理），確認出現 `Courses`、`Bookings`、`Participants`、`CancellationRequests`、`AuditLog` 五個分頁且第一列為標題；`Courses` 會填入備援課程資料。
   6. `initializeWorkbook` 會先檢查執行者是否在 `ADMIN_EMAIL_ALLOWLIST`，請確認步驟 7 的白名單包含你目前登入的 Gmail，否則會出現 `Admin sign-in required` 或不在白名單的錯誤。
   7. 若既有標題列與預期不符，會報錯而不覆寫；若出現找不到 `SPREADSHEET_ID` 的錯誤，請回步驟 7 檢查屬性名稱與值。

### 2.2 課程工作表欄位與公開資料

`initializeWorkbook` 會建立下列標題列。`Courses` 保留既有欄位，並新增可編輯的 `description`、`instructor`、`instructorBio`；欄位順序及大小寫必須完全相同：

| 工作表 | 第一列標題（依序） |
| --- | --- |
| `Courses` | `courseId`, `title`, `date`, `startTime`, `endTime`, `location`, `mode`, `image`, `manualRegistrationMode`, `description`, `instructor`, `instructorBio` |
| `CourseOutline` | `courseId`, `sortOrder`, `item` |
| `CoursePricing` | `courseId`, `sortOrder`, `label`, `price` |

- 在 `Courses` 每列填寫課程基本資料；`description` 是課程介紹、`instructor` 是講師名稱、`instructorBio` 是講師簡介（多項內容可用換行分隔）。
- `CourseOutline` 每列是一個大綱項目，`CoursePricing` 每列是一個價格項目。兩個分頁的 `courseId` 必須與對應的 `Courses.courseId` 完全相同；同一課程的項目依 `sortOrder` 數值由小到大顯示。
- 公開唯讀課程端點會回傳課程顯示欄位 `courseId`、`title`、`date`、`startTime`、`endTime`、`location`、`mode`、`image`、`description`、`instructor`、`instructorBio`，以及依序排列的 `outline` 和 `pricing`（每筆價格包含 `label`、`price`）。任何透過此端點送出的內容都可由任何人讀取；只放適合公開的課程資訊，**不得放入個人資料、聯絡資料、內部備註或任何管理／行政資料**。

### 2.3 既有試算表安全遷移與課程即時更新

既有 Google Sheets 使用新課程欄位前，先將擴充後的 Apps Script 程式推送，再執行一次安全初始化，最後更新既有的公開部署版本：

1. 在專案根目錄執行 `npm --prefix gas run push`，將擴充後的 GAS 程式推送至已連結的 Apps Script 專案。
2. 在 Apps Script 編輯器選取 `SheetRepository.gs` 中公開入口 **`initializeWorkbook`** 並執行；第一次執行時依提示完成 Google 授權。等執行記錄顯示完成後，重新整理試算表並確認新增欄位及 `CourseOutline`、`CoursePricing` 分頁。
3. 初始化會驗證既有標題；對相符的舊 `Courses` 標題列只補上缺少的新欄位，建立缺少的內容分頁，且只補空白／缺少的備援內容，不覆寫已填資料。若標題不符，初始化會停止並報錯；請先檢查標題，不要清除或重建既有資料。
4. 在 Apps Script 編輯器選「**部署**」→「**管理部署**」，選取現有的「公開註冊」部署，點鉛筆圖示，將版本設為「**新版本**」，再按「**部署**」。這次更新是既有公開部署發布一次新版本，**不要建立新的公開部署**；既有 `/exec` 網址維持不變。
5. 在 `Courses` 修改一門課程的 `location`、`description`，並在相同 `courseId` 的 `CourseOutline`、`CoursePricing` 修改大綱與價格；儲存後重新載入網站課程列表／詳情頁，確認最新值出現。這項線上驗收需由使用者使用實際 Google 試算表與部署完成，本機檢查無法代替。

網站重新載入時會向公開課程端點讀取目前的試算表資料，因此**日常修改工作表內容不需要推送 GAS 程式碼，也不需要重新建置或部署 GitHub Pages**。只有 Apps Script 程式碼改動才需要 push，並依上方流程執行初始化及發布新版本。

#### 管理頁新增、編輯與刪除課程

在已部署的管理頁中，課程表單固定顯示於課程列表上方：

- 新增時會產生可在送出前修改的 UUID；`courseId` 建立後不可再變更。必填欄位為 ID、課程名稱、日期、開始時間及結束時間。日期使用 `YYYY-MM-DD`，時間使用 24 小時制（例如 `13:30`）。
- 課綱及費用級距可新增、移除並依畫面順序排列；費用請填數字。報名模式固定為 `AUTO`，依截止日自動開放或關閉。
- 新增及編輯會寫入 `Courses`、`CourseOutline` 和 `CoursePricing`。編輯時 ID 唯讀；若日期變更，所有相同 `courseId` 的 `Bookings` 與 `Participants` 資料列（包括已取消報名）的 `courseDate` 會同步更新。
- 刪除前會要求確認。只要仍有任何報名列引用該課程（無論狀態），系統就會拒絕刪除；沒有報名時，才會一併刪除課程、課綱及費用資料。
- 也可以直接在試算表維護上述分頁；`courseId` 必須固定且唯一，課綱／費用各列以相同 ID 關聯，`sortOrder` 決定顯示順序。

新增、編輯或刪除管理功能的 GAS 程式碼後，需 `push` 並將既有「管理」部署更新為新版本。**此功能初次上線後，日常透過管理頁或試算表維護課程資料都不需要重新部署 GAS，也不需要重新建置或部署 GitHub Pages。**

### 2.4 部署兩個 Web App（同一份程式碼、兩個部署）

先理解概念：只有**一份程式碼**，但要在 Apps Script 建立**兩個部署**，各自有不同的 `/exec` 網址與不同的執行設定。程式碼用網址參數區分頁面：

| 部署 | 說明欄填 | 執行身分 | 誰可以存取 | 打開的頁面 |
| --- | --- | --- | --- | --- |
| A 公開註冊 | `公開註冊` | **我** | **所有人** | `<A 的 /exec 網址>`（報名、查詢、申請取消）；網站課程頁 CTA 也用這個 |
| B 管理 | `管理` | **存取網頁應用程式的使用者** | **所有 Google 帳戶的使用者** | `<B 的 /exec 網址>?page=admin`（管理頁） |

> 為什麼要兩個：公開報名要「以擁有者身分寫入試算表」，讓匿名使用者不需要試算表權限；管理頁必須「以登入者本人身分」執行，才能取得登入者 Email 並比對白名單。同一個部署無法同時滿足兩者。

`appsscript.json` 未含 `webapp` 設定，因此下列設定都要在網頁手動操作。前提：2.1 的步驟 1 到 8 已完成。

#### A. 建立「公開註冊」部署

1. 在 Apps Script 編輯器右上角點藍色「**部署**」按鈕，選「**新增部署**」。
2. 彈出視窗左上角「**選取類型**」旁有一個**齒輪圖示**，點它，選「**網頁應用程式**」。
3. 填寫設定：
   - 「說明」：`公開註冊`
   - 「執行身分」：選「**我（你的 Gmail）**」
   - 「誰可以存取」：選「**所有人**」
4. 按「**部署**」。
5. 若出現「需要授權存取」，按「**授權存取**」→ 選擇你的帳號 →（若顯示「Google 尚未驗證這個應用程式」，點「進階」→「前往『課程報名系統』（不安全）」）→「允許」。
6. 完成後視窗顯示「**網頁應用程式**」網址，格式 `https://script.google.com/macros/s/<部署 ID>/exec`。按「**複製**」，貼到記事本並標註「A 公開網址」。按「完成」。
7. 驗證：用無痕視窗貼上這個網址，應看到「課程報名與查詢」頁面且列出課程（未登入也能開）。

#### B. 建立「管理」部署

1. 再次點右上角「**部署**」→「**新增部署**」（不是「管理部署」，要建立第二個新的）。
2. 同樣點「選取類型」旁的齒輪 →「**網頁應用程式**」。
3. 填寫設定：
   - 「說明」：`管理`
   - 「執行身分」：選「**存取網頁應用程式的使用者**」（不是「我」）
   - 「誰可以存取」：選「**所有 Google 帳戶的使用者**」
4. 按「**部署**」。複製新的 `/exec` 網址，標註「B 管理網址」。這個網址與 A **不同**。
5. 在網址後面加上 `?page=admin`，例如 `https://script.google.com/macros/s/<B 的部署 ID>/exec?page=admin`，這就是管理頁。
6. 驗證（用你自己的 Gmail）：
   1. 在瀏覽器貼上 B 的 `?page=admin` 網址。
   2. 第一次會要求授權：按「審查權限」→ 選你的帳號 →「進階」→「前往…（不安全）」→「允許」。
   3. 授權後應看到「課程報名管理」頁，內有報名、取消申請、課程三個區塊。
   4. 若顯示錯誤（例如 `Admin sign-in required` 或不在白名單），請回 2.1 步驟 7 確認 `ADMIN_EMAIL_ALLOWLIST` 含這個 Gmail。
7. 管理網址與白名單屬私密資訊，不要放進網站、`data/` 或儲存庫。

#### C. 之後新增其他管理員

1. 在 Apps Script 指令碼屬性 `ADMIN_EMAIL_ALLOWLIST` 加入對方 Gmail（逗號分隔）。
2. 在試算表右上角「**共用**」，把對方 Gmail 加為「**編輯者**」。
3. 把「B 管理網址 + `?page=admin`」告訴對方；對方第一次開啟時用自己的帳號完成授權。
4. 疑難排解：管理頁顯示「無法載入管理資料：Exception: 你沒有存取所要求文件的權限」，代表該 Gmail 已通過白名單，但**尚未被共用為試算表編輯者**（管理部署以存取者身分開啟試算表）。請回步驟 2 補上共用，再重新整理。

#### D. 更新程式後如何讓兩個部署生效

只 `push` 不會更新已部署的網址。程式碼推送後，依變更範圍更新既有部署（網址／部署 ID 不變）：

1. `npm --prefix gas run push`。
2. Apps Script 編輯器「**部署**」→「**管理部署**」。
3. 若變更影響公開報名、課程列表或詳情，左側選「公開註冊」，點右上**鉛筆圖示**，「版本」選「**新版本**」，按「**部署**」。
4. 若變更影響管理頁，對「管理」重複步驟 3；同時影響兩者時，兩個部署都要更新。公開課程資料讀取的工作表欄位擴充需發布既有「公開註冊」部署；管理頁課程新增／編輯／刪除功能則需發布既有「管理」部署。相關遷移流程見「[既有試算表安全遷移與課程即時更新](#23-既有試算表安全遷移與課程即時更新)」。

#### 補充

- 管理頁（`?page=admin`）會先呼叫 `requireAdmin_()`：以 `Session.getActiveUser().getEmail()` 取得登入者並比對白名單。
- 每位 Gmail 管理員都必須：在 `ADMIN_EMAIL_ALLOWLIST` 中、對試算表有編輯權限，並完成 Apps Script 授權（試算表、寄信、Email scope）。
- 若 Apps Script 回傳**空白的使用者 Email**，管理功能會**失敗關閉**（拒絕）。請修正部署／帳號設定；**不要移除白名單檢查**。
- 不要用 A（公開）網址加 `?page=admin` 當管理頁；管理頁請固定使用 B。

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