param([Parameter(Mandatory=$true)][string]$ConfigFile)
$ErrorActionPreference='Stop'
$taskRelayScript=Join-Path $PSScriptRoot 'relay-ingestion-folder.cjs'
& node $taskRelayScript $ConfigFile
exit $LASTEXITCODE
