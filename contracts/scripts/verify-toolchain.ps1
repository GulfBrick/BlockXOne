param(
  [Parameter(Position = 0, ValueFromRemainingArguments = $true)]
  [string[]]$NpmArgs
)

$ErrorActionPreference = 'Stop'

function Get-NodeMajor {
  param([string]$NodePath)

  $version = & $NodePath -p "process.versions.node" 2>$null
  if (-not $version) { return $null }

  $majorText = ($version.Trim() -split '\.')[0]
  $major = 0
  if ([int]::TryParse($majorText, [ref]$major)) { return $major }
  return $null
}

function Test-SupportedNode {
  param([string]$NodePath)

  if (-not (Test-Path -LiteralPath $NodePath)) { return $false }
  $major = Get-NodeMajor -NodePath $NodePath
  return $major -eq 20 -or $major -eq 22
}

$repoRoot = Split-Path -Parent $PSScriptRoot
[string[]]$requestedNpmArgs = if ($NpmArgs.Count -gt 0) { $NpmArgs } else { @('run', 'compile') }
$candidates = @()

if ($env:BLOCKXONE_NODE_LTS) {
  $candidates += $env:BLOCKXONE_NODE_LTS
}

$pathNode = Get-Command node -ErrorAction SilentlyContinue
if ($pathNode) {
  $candidates += $pathNode.Source
}

$candidates += @(
  'C:\nodejs\node-v22.0.0-win-x64\node.exe',
  'C:\nodejs\node-v20.10.0-win-x64\node.exe',
  'C:\Program Files\nodejs\node.exe'
)

$nodePath = $candidates |
  Where-Object { $_ -and (Test-SupportedNode -NodePath $_) } |
  Select-Object -First 1

if (-not $nodePath) {
  throw 'No supported Node runtime found. Install Node 20.x or 22.x LTS, or set BLOCKXONE_NODE_LTS to node.exe.'
}

$nodeDir = Split-Path -Parent $nodePath
$npmCmd = Join-Path $nodeDir 'npm.cmd'
if (-not (Test-Path -LiteralPath $npmCmd)) {
  throw "npm.cmd not found next to supported Node runtime: $nodePath"
}

Set-Location -LiteralPath $repoRoot
$env:Path = "$nodeDir;$env:Path"

$nodeVersion = & $nodePath -v
$npmVersion = & $npmCmd -v
Write-Host "Using Node $nodeVersion via $nodePath"
Write-Host "Using npm $npmVersion"

& $npmCmd @requestedNpmArgs
exit $LASTEXITCODE
