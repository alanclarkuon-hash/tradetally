$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskNode = 'C:\Program Files\nodejs\node.exe'
$taskPrivateRoot=if($env:TRADETALLY_PRIVATE_DIR){$env:TRADETALLY_PRIVATE_DIR}else{Join-Path $env:USERPROFILE 'TradeTally\Private'}
$taskSecrets=Join-Path $taskPrivateRoot 'production\backup-secrets'
$taskLog = Join-Path $taskSecrets 'scheduled-backup.log'
$taskConfig = Join-Path $taskSecrets 'destination.json'
try {
    if (-not (Test-Path -LiteralPath $taskConfig)) { throw 'Google Drive destination has not been configured' }
    $taskDestination = (Get-Content -LiteralPath $taskConfig -Raw | ConvertFrom-Json).path
    if (-not (Test-Path -LiteralPath $taskDestination -PathType Container)) { throw 'Google Drive is not available' }
    $taskStatus = Join-Path $taskSecrets 'last-success.json'
    if (Test-Path -LiteralPath $taskStatus) {
        $taskLast = Get-Content -LiteralPath $taskStatus -Raw | ConvertFrom-Json
        if ($taskLast.copiedToDrive -and ([DateTimeOffset]::Parse($taskLast.createdAt).LocalDateTime.Date -eq (Get-Date).Date)) { exit 0 }
    }
    & $taskNode (Join-Path $PSScriptRoot 'backup-offsite.cjs') "--destination=$taskDestination" >> $taskLog 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'Backup command failed' }
    exit 0
} catch {
    "$(Get-Date -Format o) Backup did not complete. Check Docker Desktop and Google Drive." | Add-Content -LiteralPath $taskLog
    exit 1
}
