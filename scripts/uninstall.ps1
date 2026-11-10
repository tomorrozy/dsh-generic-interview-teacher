# dsh-generic-interview-teacher · 卸载脚本
#
# 只移除登记与链接：
#   1. dependencies 移除插件名
#   2. dsh.profile.bundles 移除插件名
#   3. profile/node_modules 下的 junction 删除
# 插件目录、用户 profiles、面试状态、复盘文件全部保留。
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File uninstall.ps1 -Profile desktop

[CmdletBinding()]
param(
    [ValidateSet('desktop', 'web', 'tui', 'headless')]
    [string]$Profile = 'desktop',
    [string]$PluginPath = '',
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($PluginPath)) {
    $PluginPath = Split-Path -Parent $PSScriptRoot
}
$PluginPath = [System.IO.Path]::GetFullPath($PluginPath)
$pluginName = (Get-Content -Raw (Join-Path $PluginPath 'package.json') | ConvertFrom-Json).name

$profilesRoot = Join-Path $env:USERPROFILE '.dsh\profiles'
$profileDir = Join-Path $profilesRoot $Profile
$profileManifest = Join-Path $profileDir 'package.json'
if (-not (Test-Path $profileManifest)) {
    throw "profile 不存在：$profileManifest"
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = "$profileManifest.bak-git-$stamp"
Copy-Item $profileManifest $backup -Force

$manifest = Get-Content -Raw $profileManifest | ConvertFrom-Json
if ($null -ne $manifest.dependencies -and $null -ne $manifest.dependencies.PSObject.Properties[$pluginName]) {
    $manifest.dependencies.PSObject.Properties.Remove($pluginName)
    Write-Host "  - dependencies.$pluginName"
}
if ($null -ne $manifest.dsh -and $null -ne $manifest.dsh.profile -and $null -ne $manifest.dsh.profile.bundles) {
    $bundles = @($manifest.dsh.profile.bundles | Where-Object { $_ -ne $pluginName })
    $manifest.dsh.profile.bundles = $bundles
    Write-Host "  - dsh.profile.bundles -= $pluginName"
}

$json = $manifest | ConvertTo-Json -Depth 32
[System.IO.File]::WriteAllText($profileManifest, $json + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding($false)))

$linkPath = Join-Path (Join-Path $profileDir 'node_modules') $pluginName
if (Test-Path $linkPath) {
    $item = Get-Item $linkPath -Force
    if ($item.LinkType -eq 'Junction') {
        Remove-Item $linkPath -Force
        Write-Host "  - node_modules\$pluginName (junction)"
    }
    elseif ($Force) {
        Remove-Item $linkPath -Force -Recurse
        Write-Host "  - node_modules\$pluginName (forced)"
    }
    else {
        throw "node_modules\$pluginName 不是 junction；确认后用 -Force 删除。"
    }
}

Write-Host ''
Write-Host "已从 profile 卸载: $Profile" -ForegroundColor Green
Write-Host "  备份: $backup"
Write-Host '  用户 profiles、状态与复盘文件保留在 ~/.dsh/interview-teacher/' -ForegroundColor Yellow
