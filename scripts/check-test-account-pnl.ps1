$ErrorActionPreference='Stop'
$taskRoot=Split-Path $PSScriptRoot -Parent
$taskPaths=@{planningLedger='services/planningLedger.js';calculation='services/accountRealisedPnl.js';tradeFx='utils/tradeFx.js';events='utils/executionPnlByDate.js';display='utils/displayCurrency.js';queries='services/tradeQueries.js'}
$taskSources=@{}
foreach($taskKey in $taskPaths.Keys){$taskSources[$taskKey]=[IO.File]::ReadAllText((Join-Path $taskRoot ('backend/src/'+$taskPaths[$taskKey])))}
$taskScript='const CANDIDATE_SOURCES='+($taskSources|ConvertTo-Json -Compress)+';'+[IO.File]::ReadAllText((Join-Path $taskRoot 'backend/tests/integration/accountReporting.isolated.js'))
$taskScript | docker exec -i tradetally-test-app-1 node -
exit $LASTEXITCODE
