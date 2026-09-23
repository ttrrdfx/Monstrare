# Monstrare Release 維運手冊

此流程只適用於 `ttrrdfx/Monstrare` 的正式 GitHub Release；推送 `v<major.minor.patch>` tag 才會觸發 `.github/workflows/release.yml`。workflow 將 `monstrare-vX.Y.Z.bundle.json` 附到同一 tag 的非 draft、非 prerelease Release。不要以任意 checkout、草稿或未驗證的 asset 當成看板版本更新來源。

## 發布前

1. 在獨立、乾淨的 source checkout 提升 `VERSION` 和 `monstrare-package.json` 的 `version`，兩者須是相同的嚴格 `major.minor.patch`（沒有 `v`、前導零或 prerelease）。核對 `minimumNode`、ownership inventory、必要的 legacy baseline 和 migration，完成 code review。
2. 在同一個預計打 tag 的 commit 上執行 `npm ci`、`npm run check`、`git diff --check`。檢查 `git status --short`，不得有會影響 bundle 的未提交修改。
3. 做本機 dry-run（將下例的版本替換成 `VERSION` 內容）；兩次輸出的 SHA-256 必須相同，並可用 `node` 解析 bundle 確認 `version`、`createdFrom`。本機不呼叫 GitHub：

   ```bash
   commit=$(git rev-parse HEAD)
   version=$(tr -d '\n' < VERSION)
   scratch=$(mktemp -d)
   npm run package-release -- --created-from "$commit" --output "$scratch/first.json"
   npm run package-release -- --created-from "$commit" --output "$scratch/second.json"
   sha256sum "$scratch/first.json" "$scratch/second.json"
   cmp "$scratch/first.json" "$scratch/second.json"
   node --input-type=module -e 'import fs from "node:fs"; import {parseReleaseBundle} from "./scripts/lib/release-bundle.mjs"; const b=parseReleaseBundle(fs.readFileSync(process.argv[1]),{expectedVersion:process.argv[2]}); if(b.createdFrom!==process.argv[3]) process.exit(1)' "$scratch/first.json" "$version" "$commit"
   ```

4. 經維護者明確核准後建立 annotated tag 並推送（以下只是操作範例，不會由升級器執行）。先核對 `git show --no-patch vX.Y.Z`、版本及 tag 指向的 commit，再推送單一 tag；不要 force-push 或重用版本號：

   ```bash
   git tag -a vX.Y.Z -m "Monstrare vX.Y.Z"
   git push origin vX.Y.Z
   ```

## GitHub workflow 與發布後 gate

- `build` job 僅有 `contents: read`：核對 tag／`VERSION`／manifest，執行 `npm ci`、`npm run check`，建置並解析唯一命名的 bundle，計算 SHA-256，再交給同一次 run 的短期 artifact。`release` job 才有 `contents: write`；它不 checkout 或執行 repo 程式碼，先核對 artifact digest、遠端 tag 指向的 commit，再操作當前 repository/tag。
- 在 GitHub Actions 打開該 tag 的 `Release bundle` run：確認兩個 job 都成功、package 輸出的 SHA-256 與最後 `Verified ... sha256:...` 一致，且正式 Release 的 tag、asset 名稱與 SHA-256 digest 都正確。GitHub asset metadata 的 `digest` 可能稍晚才出現；workflow 會短暫重試，發布後仍要確認 digest 已可用，否則不得交付下游。
- 可在已授權的維護者環境唯讀查核：`gh api repos/ttrrdfx/Monstrare/releases/tags/vX.Y.Z --jq '{tag_name,draft,prerelease,assets:[.assets[]|{name,digest}]}'`。比對固定檔名的 `sha256:<64 hex>` 與 workflow log；必要時以 `gh release download vX.Y.Z --repo ttrrdfx/Monstrare --pattern 'monstrare-vX.Y.Z.bundle.json' --dir <empty-directory>` 下載並在本機重算 SHA-256。
- 同一 tag 重跑時，若 release 已存在且 asset digest 相同就不再上傳；缺少 asset 才上傳；digest 缺失或不同會停止，絕不 `--clobber`。其他 API、權限或網路錯誤不能當成「沒有 release」。已存在 draft/prerelease 不會被轉正。

## 失敗、回復與下游驗收

- 在沒有 asset、workflow 中斷或 digest 尚未可用時，先檢查失敗原因與 release/tag 狀態；修正 workflow 本身後，可從 `main` 手動執行 `Release bundle` 並輸入既有 tag。手動 run 仍 checkout、建置並驗證該 tag 指向的 commit，不得移動現有 tag 來「修復」不同內容。
- 若已發布錯誤 asset 或 digest 不同，停止下游更新並先保存 workflow log、asset id/digest 與錯誤檔案作為證據。經人工核准後，可用 `gh release delete-asset vX.Y.Z monstrare-vX.Y.Z.bundle.json --repo ttrrdfx/Monstrare` 移除壞 asset，再重跑同一 tag；若 tag 本身或版本內容錯誤，改發新的版本，不要覆寫既有 tag。此刪除操作不可由 workflow 自動執行。
- 下游看板只讀 GitHub **正式** Release 的固定檔名 asset，且要求 GitHub digest 與下載內容一致。先在目標專案預覽 dry-run、檢查衝突與備份，再二次確認套用；完成後執行 `verify` 並**重啟本機看板 server**，不要把 release 發布成功視為下游更新已完成。真實 staging/tag 上傳和跨層驗收屬於 TASK-020，需另行授權。
