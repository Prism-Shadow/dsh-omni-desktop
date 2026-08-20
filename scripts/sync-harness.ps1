[CmdletBinding()]
param(
  [string]$Workspace,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

function Get-FullPath {
  param([Parameter(Mandatory = $true)][string]$Path)
  return [System.IO.Path]::GetFullPath($Path)
}

function Assert-InsidePath {
  param(
    [Parameter(Mandatory = $true)][string]$Parent,
    [Parameter(Mandatory = $true)][string]$Child
  )

  $parentFull = Get-FullPath $Parent
  $childFull = Get-FullPath $Child
  $parentWithSeparator = $parentFull.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar

  if (-not $childFull.StartsWith($parentWithSeparator, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to operate outside $parentFull`: $childFull"
  }
}

function Get-ExtendedPath {
  param([Parameter(Mandatory = $true)][string]$Path)

  $full = Get-FullPath $Path
  if ($full.StartsWith('\\?\')) {
    return $full
  }
  if ($full.StartsWith('\\')) {
    return "\\?\UNC\$($full.Substring(2))"
  }
  return "\\?\$full"
}

function Invoke-Git {
  $Arguments = $args
  & git @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "git $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
  }
}

function Copy-OverlayItem {
  param(
    [Parameter(Mandatory = $true)][System.IO.FileSystemInfo]$Source,
    [Parameter(Mandatory = $true)][string]$Destination
  )

  if ($Source.PSIsContainer) {
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    foreach ($child in Get-ChildItem -LiteralPath $Source.FullName -Force) {
      Copy-OverlayItem -Source $child -Destination (Join-Path $Destination $child.Name)
    }
    return
  }

  $parent = Split-Path -Parent $Destination
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  Copy-Item -LiteralPath $Source.FullName -Destination $Destination -Force
}

function Remove-DirectoryTree {
  param(
    [Parameter(Mandatory = $true)][string]$Parent,
    [Parameter(Mandatory = $true)][string]$Directory
  )

  Assert-InsidePath $Parent $Directory
  if (-not (Test-Path -LiteralPath $Directory)) {
    return
  }

  $lastError = $null
  for ($attempt = 1; $attempt -le 5; $attempt += 1) {
    try {
      if ($attempt -eq 1) {
        Remove-Item -LiteralPath $Directory -Recurse -Force -ErrorAction Stop
      } else {
        Reset-AttributesForDelete -Path (Get-ExtendedPath $Directory)
        [System.IO.Directory]::Delete((Get-ExtendedPath $Directory), $true)
      }
      return
    } catch {
      $lastError = $_
      Start-Sleep -Milliseconds (250 * $attempt)
    }
  }

  if ($lastError -ne $null) {
    throw $lastError
  }
}

function Reset-AttributesForDelete {
  param([Parameter(Mandatory = $true)][string]$Path)

  if ([System.IO.File]::Exists($Path)) {
    [System.IO.File]::SetAttributes($Path, [System.IO.FileAttributes]::Normal)
    return
  }

  if (-not [System.IO.Directory]::Exists($Path)) {
    return
  }

  $directory = [System.IO.DirectoryInfo]::new($Path)
  $directory.Attributes = $directory.Attributes -band (-bnot [System.IO.FileAttributes]::ReadOnly)
  if (($directory.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    return
  }

  foreach ($entry in [System.IO.Directory]::EnumerateFileSystemEntries($Path)) {
    Reset-AttributesForDelete -Path $entry
  }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$submodulePath = Join-Path $repoRoot 'deepseek-harness'
$overlayPath = Join-Path $repoRoot 'overlays\deepseek-harness'
$workRoot = Join-Path $repoRoot '.work'

if ([string]::IsNullOrWhiteSpace($Workspace)) {
  $Workspace = Join-Path $workRoot 'deepseek-harness'
}

$workspaceFull = Get-FullPath $Workspace
$workRootFull = Get-FullPath $workRoot

if (-not (Test-Path -LiteralPath $submodulePath)) {
  throw "Missing submodule directory: $submodulePath. Run git submodule update --init --recursive."
}

if (-not (Test-Path -LiteralPath $overlayPath)) {
  throw "Missing overlay directory: $overlayPath"
}

Assert-InsidePath $workRootFull $workspaceFull
New-Item -ItemType Directory -Force -Path $workRootFull | Out-Null

if (Test-Path -LiteralPath $workspaceFull) {
  if (-not $Force) {
    throw "$workspaceFull already exists. Pass -Force to recreate it."
  }

  & git -c core.longpaths=true -C $submodulePath worktree remove --force $workspaceFull
  if (Test-Path -LiteralPath $workspaceFull) {
    Remove-DirectoryTree -Parent $workRootFull -Directory $workspaceFull
  }
}

Invoke-Git @('-c', 'core.longpaths=true', '-C', $submodulePath, 'worktree', 'prune')
Invoke-Git @('-c', 'core.longpaths=true', '-C', $submodulePath, 'worktree', 'add', '--detach', $workspaceFull, 'HEAD')

Write-Host "[dsh-omni] applying overlay to $workspaceFull"
foreach ($item in Get-ChildItem -LiteralPath $overlayPath -Force) {
  Copy-OverlayItem -Source $item -Destination (Join-Path $workspaceFull $item.Name)
}

$commit = (& git -C $submodulePath rev-parse --short=12 HEAD).Trim()
if ($LASTEXITCODE -ne 0) {
  throw "git rev-parse failed with exit code $LASTEXITCODE"
}

Write-Host "[dsh-omni] synced upstream $commit into $workspaceFull"
