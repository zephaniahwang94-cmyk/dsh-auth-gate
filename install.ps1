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
if ($null -eq $dshCommand) {
    if ([string]::IsNullOrWhiteSpace($HarnessPath)) {
        $HarnessPath = Join-Path (Split-Path -Parent $pluginPath) 'deepseek-harness'
    }
    $harnessPackage = Join-Path $HarnessPath 'package.json'
    if (-not (Test-Path -LiteralPath $harnessPackage -PathType Leaf)) {
        throw 'dsh is not on PATH. Supply -HarnessPath pointing to a DeepSeek Harness source checkout.'
    }
}

function Invoke-DshCommand {
    param([string[]]$DshArgs)
    if ($null -ne $dshCommand) {
        & $dshCommand.Source @DshArgs
        return
    }
    Push-Location -LiteralPath $HarnessPath
    try { & pnpm dsh @DshArgs } finally { Pop-Location }
}

Push-Location -LiteralPath $pluginPath
try {
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
Write-Host "Launch command: dsh $($launchArgs -join ' ')" -ForegroundColor Cyan

if ($Protection -eq 'ApprovalLimit') {
    Write-Warning 'Network authentication is disabled. HTTP and WebSocket control surfaces remain unauthenticated.'
}
if ($Start) {
    Invoke-DshCommand -DshArgs $launchArgs
    if ($LASTEXITCODE -ne 0) { throw 'DeepSeek Harness exited with an error.' }
}
