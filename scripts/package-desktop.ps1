[CmdletBinding()]
param(
  [string]$UpdateBaseUrl = 'https://updates.example.invalid/dsh-omni-desktop',
  [string]$Workspace,
  [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'

function Invoke-CommandChecked {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory
  )

  Write-Host "[dsh-omni] $FilePath $($Arguments -join ' ')"
  Push-Location $WorkingDirectory
  try {
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "$FilePath $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if ([string]::IsNullOrWhiteSpace($Workspace)) {
  $workspace = Join-Path $repoRoot ".work\package\deepseek-harness-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
} else {
  $workspace = $Workspace
}

& (Join-Path $PSScriptRoot 'sync-harness.ps1') -Workspace $workspace

$previousCi = $env:CI
$env:CI = 'true'
try {
  if (-not $SkipInstall) {
    Invoke-CommandChecked -FilePath 'pnpm' -Arguments @('install', '--frozen-lockfile') -WorkingDirectory $workspace
  }

  Invoke-CommandChecked -FilePath 'pnpm' -Arguments @('--workspace-root', 'run', 'stage:desktop') -WorkingDirectory $workspace
  Invoke-CommandChecked -FilePath 'pnpm' -Arguments @(
    '--dir',
    'apps/desktop',
    'exec',
    'electron-builder',
    '--win',
    '--x64',
    '--config.publish.provider=generic',
    "--config.publish.url=$UpdateBaseUrl",
    '--publish',
    'never'
  ) -WorkingDirectory $workspace
} finally {
  if ($null -eq $previousCi) {
    Remove-Item Env:\CI -ErrorAction SilentlyContinue
  } else {
    $env:CI = $previousCi
  }
}

Write-Host "[dsh-omni] desktop artifacts:"
Get-ChildItem -LiteralPath (Join-Path $workspace 'apps\desktop\stage\out') -File | Select-Object Name, Length, LastWriteTime
