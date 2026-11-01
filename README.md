# ibelievemagic

Next.js 靜態網站（`output: "export"`，部署於 GitHub Pages）。需要 Node.js `>=22.22.0`。

```powershell
npm install
npm run dev     # 本機開發
npm run build   # 靜態建置，輸出至 out/
```

## 課程報名（Google Apps Script）

報名、查詢與管理由 `gas/` 內的 Apps Script 負責。網站只在 `data/gas-registration.json` 的 `webAppUrl` 放**公開註冊**部署的 `/exec` 網址（留空則維持 LINE 聯絡）；管理部署網址與管理員白名單不可放入本儲存庫。

完整的本機測試、Google 設定、雙部署、圖片與驗收清單請見 [`gas/README.md`](gas/README.md)。本機測試不等於雲端部署驗證，部署與帳號設定需由使用者完成。