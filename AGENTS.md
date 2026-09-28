# AGENTS.md

## Project Overview
`dsh-tokenslash` is a Cordis plugin package for DeepSeek Harness (DSH).
- Source workspace path: `C:\Users\LGSM228\.dsh\profiles\desktop\packages\dsh-tokenslash`
- Active runtime profile path: `C:\Users\LGSM228\.dsh\profiles\desktop\node_modules\dsh-tokenslash`

## Crucial Rule: Node Modules Sync
DSH Desktop loads plugins from `node_modules\dsh-tokenslash`, **not** from `packages\dsh-tokenslash`. `node_modules\dsh-tokenslash` is a directory copy, not a symlink.

### Mandatory Workflow
After making ANY changes (code, config, or assets) in `packages\dsh-tokenslash`:
1. Ask the user explicitly if they want to sync changes to `node_modules`.
2. Upon user confirmation, copy changed files to `C:\Users\LGSM228\.dsh\profiles\desktop\node_modules\dsh-tokenslash`.
3. Inform the user to reload the GUI (`Ctrl + R` / `F5`) or restart DSH Desktop.

### Sync Command Reference
```powershell
$src = "C:\Users\LGSM228\.dsh\profiles\desktop\packages\dsh-tokenslash"
$dst = "C:\Users\LGSM228\.dsh\profiles\desktop\node_modules\dsh-tokenslash"
Copy-Item -Path "$src\lib\*" -Destination "$dst\lib" -Recurse -Force
Copy-Item -Path "$src\package.json" -Destination "$dst\package.json" -Force
Copy-Item -Path "$src\cordis.patch.yml" -Destination "$dst\cordis.patch.yml" -Force
```
