# 驗證報告

## 摘要

- 任務：TASK-016 建立看板版本更新 API 與寫入防護
- 結果：通過
- 驗證者：Codex

## 指令

| 指令 | 結果 | 備註 |
|---|---|---|
| `node --test tools/kanban/upgrade-api.test.mjs test/monstrare/transaction.test.mjs` | 通過 | 29/29；API 邊界、stale/mutex/error mapping 與既有 transaction 回歸。 |
| `node --check tools/kanban/server.mjs tools/kanban/upgrade-api.mjs` | 通過 | Server route 與 API orchestration 語法正確。 |
| `npm run check` | 通過 | 118/118 tests；syntax check 與 governance kit check 通過。 |
| `git diff --check` | 通過 | 無 whitespace error。 |

## UI 證據

| Viewport | 螢幕截圖 | 備註 |
|---|---|---|
| 桌面版 | 不適用 | TASK-016 不修改 UI；TASK-018／020 負責串接與視覺驗證。 |
| 行動裝置版 | 不適用 | TASK-016 不修改 UI。 |

## 驗收覆蓋

- `GET /api/upgrade/status` 只讀 target 的 manifest／`VERSION` 與可寫性，不呼叫 provider；
  child-process server 測試在無網路 fixture 回傳 installed version 與固定 repository。
- `POST /api/upgrade/check` 只接受空 object；測試比對 target 檔案內容與 mtime，並確認
  `.monstrare/` 沒有被建立。DTO 只含版本、計數、相對路徑、reason、token 與 expiry。
- Upgrade POST 在任何 provider／planner／transaction 前驗證目前 listening port 的
  `127.0.0.1|localhost` Host、完全相符的 HTTP Origin、`Sec-Fetch-Site`、JSON content type、
  8 KiB body limit、合法 UTF-8/JSON 與精確 schema；repository、URL、source/target path
  或多餘欄位皆不能由 client 傳入。
- Apply 重新執行 planner，並將 release id/tag/digest、版本、排序 entries、來源 inventory
  hashes、目標 path snapshot 與 install manifest hash 納入 digest；來源內容、目標內容、
  manifest 或分類改變皆回 `UPGRADE_PLAN_STALE`，transaction 呼叫數維持零。
- Check 與 apply 共用 process-local operation gate；同時 apply 或重疊 check/apply 回
  `UPGRADE_BUSY`，底層 `.monstrare/upgrade.lock` 仍保留跨 process 防線。
- 測試區分 transaction success + verify success、transaction failure + rollback、
  rollback/recovery failure，以及 transaction committed + verify failure；後者回
  `UPDATE_APPLIED_VERIFICATION_FAILED` 且不宣稱 rollback。
- 成功只回 changed/version/count、project-relative backup path、受限 verification status
  與 `restartRequired: true`；錯誤 envelope 不含 stack、檔案內容、command output 或 home path。
- Session 在成功、失敗、stale、過期與 server shutdown 清理；shutdown 會等待正在進行的
  check/apply，避免在 transaction 使用期間刪除 source root。

## 審查發現

| 發現 | 嚴重程度 | 狀態 |
|---|---|---|
| 原始 plan digest 只含 path/action/reason；來源內容改變但分類不變時可能未偵測 | 高 | 已修復：加入 source inventory、target snapshot 與 install manifest hash，並新增同 action/source hash 變動測試。 |
| 晚完成的 check 可能替換 apply 正在使用的單一 session | 高 | 已修復：check/apply process-local 互斥，shutdown 等待 active operation。 |
| 原始 transaction/verification error 可能含本機路徑 | 中 | 已修復：公開訊息使用穩定文案；backup 僅回 project-relative path；verification 僅回 id/label/status；server log 僅記 code。 |
| 未發現其他阻擋性正確性、安全、隱私、授權、架構偏移或維護性問題 | 無 | 核准。 |

## 高風險關卡

- 輸入與授權：本機 loopback bind 不變；寫入 endpoint 採 Host/Origin/Sec-Fetch-Site、
  JSON、body limit、精確 schema、opaque token 與 `confirm: true` 多層防護，不開 CORS。
- 檔案與供應鏈：client 無法指定 repository/release/asset/source/target；TASK-015 的固定來源、
  digest/bundle 驗證與 temp lifecycle 保留，apply 前再比對 materialized source hashes。
- 交易與回滾：process-local gate 加上 transaction lock；transaction 失敗與 recovery failure
  使用不同 code，只有 project-relative backup path 可對外顯示。
- 隱私與記錄：API 不回檔案內容、diff、絕對 root、stack 或 verification output；server
  錯誤 log 只記 stable code。
- 可維護性：HTTP boundary、orchestration/error mapping 與既有 planner/transaction/verify
  保持分離；未新增 production dependency，也未改變底層公開語意。

## 殘留風險

- 真實 GitHub release asset digest 與 redirect 平台行為仍需 TASK-019／020 staging 驗證；
  本卡沿用 TASK-015 的 fake transport 證據，沒有建立或發布真實 release。
- Transaction 已 commit 後 verify 失敗依核准架構不自動 rollback；API 會回傳已套用狀態、
  相對 backup path 與受限 verification summary，需人工處理後重啟。
- TASK-016 沒有 browser UI；對話框、二次確認互動與 E2E 視覺／無障礙證據由
  TASK-018／020 負責。

## 核准建議

核准。TASK-016 的 API、HTTP 寫入防護、stale/mutex、交易錯誤語意、verify 與 cleanup
契約已完成，可供 TASK-018 串接 UI。
