# 驗證報告

## 摘要

- 任務：TASK-008 建立版本與 manifest 架構基礎
- 結果：通過
- 驗證者：Codex

## 指令

| 指令 | 結果 | 備註 |
|---|---|---|
| `npm test` | 通過 | 32/32；包含 14 項版本、manifest、CLI 與路徑安全測試，以及 18 項既有看板回歸測試。 |
| `npm run check` | 通過 | 完整測試、看板 server 語法與治理檔案檢查皆通過。 |
| `node --check scripts/monstrare.mjs` 與新增 library | 通過 | CLI、manifest、paths 三個 module 語法有效。 |
| `bash -n scripts/check-governance.sh` | 通過 | shell 語法有效。 |
| 真實來源 manifest inventory 展開 | 通過 | 共 129 個檔案：managed 59、seed-only 12、project-data 44、source-only 14；排序穩定，無重疊。 |
| `git diff --check` | 通過 | 無 whitespace error。 |

## UI 證據

| Viewport | 螢幕截圖 | 備註 |
|---|---|---|
| 不適用 | 不適用 | 本任務無 UI 變更。 |

## 審查發現

| 發現 | 嚴重程度 | 狀態 |
|---|---|---|
| 未發現阻擋合併的正確性、安全性、隱私或可維護性問題。 | 無 | 核准 |

## 涵蓋範圍

- 嚴格 SemVer、版本比較與降版拒絕。
- 來源／安裝 manifest schema、未知欄位與 schema 拒絕、malformed JSON fail closed。
- 四種所有權的 glob 展開、純分類、穩定排序與重疊拒絕。
- SHA-256 與安裝 manifest 原子寫入／round-trip；安裝 manifest 不接受檔案內容或非配送所有權。
- 絕對路徑、`..`、Windows 路徑、null byte、廣泛 target、來源 root 與 symlink escape 拒絕。
- CLI 參數、選項作用域及一致的非零錯誤邊界。

## 殘留風險

- CLI 的 install、status、upgrade、verify 行為刻意留待 TASK-009 至 TASK-013；本卡只提供可共用契約與純 helper。
- 路徑驗證後到後續寫入之間仍可能有同一台機器、同一使用者主動置換 symlink 的 TOCTOU 競態；TASK-011 的 staging／交易流程應在操作前再次驗證。
- 本卡未執行 E2E 或視覺測試，符合任務卡的不適用範圍。

## 完成定義

- 實作與可重跑驗證證據皆已存在，TASK-008 符合完成定義。
