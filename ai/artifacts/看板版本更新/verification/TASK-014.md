# 驗證報告

## 摘要

- 任務：TASK-014 建立版本更新 Release bundle 與共用契約基礎
- 結果：通過
- 驗證者：Codex

## 指令

| 指令 | 結果 | 備註 |
|---|---|---|
| `node --test test/monstrare/release-bundle.test.mjs` | 通過 | 11/11；涵蓋 schema、canonical ordering、ownership、path/mode/base64/hash、5001 entries、大小限制、零寫入失敗路徑、真實 source 可重現建置與 planner 整合。 |
| `node --check scripts/package-release.mjs scripts/lib/release-bundle.mjs` | 通過 | CLI 與 library 語法正確。 |
| `npm run package-release -- --help` | 通過 | 封裝 CLI 可執行，要求明確 `--created-from`。 |
| `npm run check` | 通過 | 89/89 tests；syntax check 與 governance kit check 通過。 |
| `git diff --check` | 通過 | 無 whitespace error。 |

## UI 證據

| Viewport | 螢幕截圖 | 備註 |
|---|---|---|
| 桌面版 | 不適用 | TASK-014 無 UI 變更。 |
| 行動裝置版 | 不適用 | TASK-014 無 UI 變更。 |

## 驗收覆蓋

- 真實 source 連續建置兩次得到 byte-for-byte 相同內容與 SHA-256。
- Bundle 包含 `VERSION`、`monstrare-package.json` 與 legacy baseline；只保留
  `managed`／`seed-only`，排除 cards、epics、動態 artifacts 與 `source-only`。
- Materialize 後的目錄可直接傳給 `planProjectUpgrade`。
- 絕對路徑、traversal、NUL、反斜線／Windows 路徑、空路徑、duplicate、非法 ownership、
  mode、hash、base64、未知 schema／欄位、5001 entries 與 encoded／decoded 大小超限皆拒絕。
- 全量驗證在任何 materialize 寫入前完成；錯誤訊息不包含 bundle 檔案內容。
- 新檔案已納入 manifest ownership 與 governance 檢查；未新增 dependency。

## 審查發現

| 發現 | 嚴重程度 | 狀態 |
|---|---|---|
| JSON parse 錯誤可能回顯惡意輸入片段 | 中 | 已修復：改為穩定泛化錯誤，並加上不回顯內容測試。 |
| Object 型 bundle 在 size check 前先配置 decoded Buffer | 中 | 已修復：先以 canonical base64 長度檢查單檔與總量，再解碼。 |
| Materialize 期間底層檔案錯誤可能包含絕對路徑 | 低 | 已修復：只回報已驗證的 bundle-relative path。 |
| 未發現其他阻擋性正確性、安全、隱私、授權、架構偏移或維護性問題 | 無 | 核准。 |

## 高風險關卡

- 輸入驗證：top-level/file 欄位 allowlist、嚴格 SemVer、完整 commit SHA、manifest/version/
  ownership 一致性、canonical base64、SHA-256 與不可提高的 hard limits。
- 檔案邊界：重用 `normalizeRelativePath`／`resolveSafeRoot`，拒絕 symlink 與特殊檔案語意；
  只接受空白 materialize root，以 exclusive create 寫入並重驗 hash。
- 敏感資料：錯誤不輸出檔案內容；本卡無 token、credential、網路或使用者資料存取。
- 供應鏈：零新增 dependency；GitHub asset digest 與正式發布 workflow 分別留給 TASK-015、TASK-019。
- 回復：驗證失敗零寫入；materialize 中途失敗只清理由本次建立且 hash 仍相符的檔案，
  避免刪除無法確認 ownership 的並行內容。

## 殘留風險

- GitHub asset digest、redirect 與正式 release 行為尚未接入，屬 TASK-015／019／020。
- Node.js path API 無 directory file descriptor 鎖定；同一本機使用者主動競態置換路徑仍有極小
  TOCTOU 視窗，目前以空白 root、逐層 symlink 檢查、`wx` 與寫後 hash 驗證降低。
- 未建立、push 或發布任何真實 GitHub tag/release。

## 核准建議

核准。TASK-014 的實作、驗證證據與高風險審查已完成；可由後續 TASK-015、017、019 使用此共用契約。
