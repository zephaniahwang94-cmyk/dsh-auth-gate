<#
.SYNOPSIS
Installs dsh-auth-gate and selects a protection preset.

.EXAMPLE
.\install.ps1 -Protection Full
.\install.ps1 -Protection NetworkAuth -Profile web -Start
.\install.ps1 -Protection ApprovalLimit
#>
[CmdletBinding()]
param(
    [ValidateSet('Full', 'NetworkAuth', 'ApprovalLimit')]
    [string]$Protection = 'Full',

    [ValidatePattern('^[A-Za-z0-9._-]+$')]
    [string]$Profile = 'web',

    [string]$HarnessPath,

    [switch]$Start
)

$ErrorActionPreference = 'Stop'
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$npmCommand = Get-Command npm -ErrorAction SilentlyContinue
if ($null -eq $nodeCommand) { throw 'Node.js 22.19+ or 24+ is required.' }
if ($null -eq $npmCommand) { throw 'npm is required.' }
$pluginPath = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($pluginPath)) { throw 'Unable to resolve the plugin directory.' }

$presetNames = @{
    Full = 'full.yml'
    NetworkAuth = 'network-auth.yml'
    ApprovalLimit = 'approval-limit.yml'
}
$presetPath = Join-Path $pluginPath (Join-Path 'presets' $presetNames[$Protection])
if (-not (Test-Path -LiteralPath $presetPath -PathType Leaf)) { throw "Missing protection preset: $presetPath" }

if ($Protection -ne 'ApprovalLimit') {
    if ([string]::IsNullOrWhiteSpace($env:DSH_AUTH_USERNAME) -or [string]::IsNullOrWhiteSpace($env:DSH_AUTH_PASSWORD)) {
        throw 'Set DSH_AUTH_USERNAME and DSH_AUTH_PASSWORD before installing a network-auth preset. Passwords are never written to patch files.'
    }
    if ($env:DSH_AUTH_SECURE_COOKIE -ne 'true') {
        Write-Warning 'Session cookies are not marked Secure. Set DSH_AUTH_SECURE_COOKIE=true for HTTPS/public deployments.'
    }
}

$dshCommand = Get-Command dsh -ErrorAction SilentlyContinue
if ([string]::IsNullOrWhiteSpace($HarnessPath) -and $null -eq $dshCommand) {
    $siblingHarness = Join-Path (Split-Path -Parent $pluginPath) 'deepseek-harness'
    if (Test-Path -LiteralPath (Join-Path $siblingHarness 'package.json') -PathType Leaf) {
        $HarnessPath = $siblingHarness
    }
}
if (-not [string]::IsNullOrWhiteSpace($HarnessPath)) {
    $harnessPackage = Join-Path $HarnessPath 'package.json'
    if (-not (Test-Path -LiteralPath $harnessPackage -PathType Leaf)) {
        throw '-HarnessPath must point to a DeepSeek Harness source checkout.'
    }
}

function Invoke-DshCommand {
    param([string[]]$DshArgs)
    if (-not [string]::IsNullOrWhiteSpace($HarnessPath)) {
        Push-Location -LiteralPath $HarnessPath
        try {
            if ($null -ne (Get-Command pnpm -ErrorAction SilentlyContinue)) {
                & pnpm dsh @DshArgs
            } else {
                Write-Warning 'No global pnpm found; using a temporary pnpm through npx.'
                & npx --yes pnpm dsh @DshArgs
            }
        } finally { Pop-Location }
        return
    }
    if ($null -ne $dshCommand -and $null -ne (Get-Command pnpm -ErrorAction SilentlyContinue)) {
        & $dshCommand.Source @DshArgs
        return
    }
    Write-Warning 'Using temporary official dsh and pnpm CLIs through npx.'
    & npx --yes --package pnpm --package '@deepseek-ai/dsh' -- dsh @DshArgs
}

Push-Location -LiteralPath $pluginPath
try {
    npm ci --ignore-scripts
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Plugin build failed.' }
    Invoke-DshCommand -DshArgs @('plugin', '--profile', $Profile, 'add', $pluginPath)
    if ($LASTEXITCODE -ne 0) { throw 'DeepSeek Harness plugin installation failed.' }
}
finally {
    Pop-Location
}

$launchArgs = @('--profile', $Profile, '--patch', $presetPath)
Write-Host "Installed dsh-auth-gate and selected the '$Protection' launch preset." -ForegroundColor Green
if (-not [string]::IsNullOrWhiteSpace($HarnessPath)) {
    Write-Host "Launch from ${HarnessPath}: pnpm dsh $($launchArgs -join ' ')" -ForegroundColor Cyan
} elseif ($null -ne $dshCommand) {
    Write-Host "Launch command: dsh $($launchArgs -join ' ')" -ForegroundColor Cyan
} else {
    Write-Host "Launch command: npx @deepseek-ai/dsh $($launchArgs -join ' ')" -ForegroundColor Cyan
}

if ($Protection -eq 'ApprovalLimit') {
    Write-Warning 'Network authentication is disabled. HTTP and WebSocket control surfaces remain unauthenticated.'
}
if ($Start) {
    Invoke-DshCommand -DshArgs $launchArgs
    if ($LASTEXITCODE -ne 0) { throw 'DeepSeek Harness exited with an error.' }
}
