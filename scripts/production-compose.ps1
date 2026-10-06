param()
$ErrorActionPreference='Stop'
$taskRepoRoot=Split-Path $PSScriptRoot -Parent
$taskPrivateRoot=if($env:TRADETALLY_PRIVATE_DIR){$env:TRADETALLY_PRIVATE_DIR}else{Join-Path $env:USERPROFILE 'TradeTally\Private'}
$taskPrivateRoot=[IO.Path]::GetFullPath($taskPrivateRoot)
if($taskPrivateRoot.Equals($taskRepoRoot,[StringComparison]::OrdinalIgnoreCase)-or $taskPrivateRoot.StartsWith($taskRepoRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Private storage must be outside the repository.'}
$taskEnvFile=Join-Path $taskPrivateRoot 'production\config\production.env'
$taskOverride=Join-Path $taskPrivateRoot 'production\config\ingestion.compose.yaml'

if(!(Test-Path -LiteralPath $taskEnvFile -PathType Leaf)){throw 'External production environment file is missing.'}
$env:TRADETALLY_PRODUCTION_ENV_FILE=$taskEnvFile
$taskArgs=@('compose','--project-directory',$taskRepoRoot,'--env-file',$taskEnvFile,'-f',(Join-Path $taskRepoRoot 'compose.local.yaml'))
if(Test-Path -LiteralPath $taskOverride -PathType Leaf){$taskArgs+=@('-f',$taskOverride)}

$taskComposeArguments=@($args)
if(!$taskComposeArguments){$taskComposeArguments=@('ps')}
& docker @taskArgs @taskComposeArguments
exit $LASTEXITCODE
