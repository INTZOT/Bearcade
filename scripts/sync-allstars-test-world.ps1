param(
  [string]$WorldPath = 'C:\Users\24827\AppData\Roaming\Minecraft Bedrock\Users\1890619860393406443\games\com.mojang\minecraftWorlds\MG+RyPytERs='
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$worldRoot = (Resolve-Path -LiteralPath $WorldPath).Path
if (-not (Test-Path -LiteralPath (Join-Path $worldRoot 'level.dat'))) { throw '目标不是 Minecraft 存档' }
$taskStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupRoot = Join-Path $repoRoot "dist\backups\allstars-$taskStamp"
$stageRoot = Join-Path $repoRoot 'dist\staging'
$pairs = @(
  @{ Id='allstars'; Kind='behavior_packs'; Folder='AllStars-灯塔全明星'; Enabled='world_behavior_packs.json' },
  @{ Id='allstars_hud'; Kind='resource_packs'; Folder='AllStars-灯塔全明星-资源包'; Enabled='world_resource_packs.json' }
)
# Validate the whole operation before writing anything to the world.
foreach ($pair in $pairs) {
  $sourceRoot = Join-Path $stageRoot $pair.Id
  $manifest = Get-Content -LiteralPath (Join-Path $sourceRoot 'manifest.json') -Raw | ConvertFrom-Json
  $enabled = Get-Content -LiteralPath (Join-Path $worldRoot $pair.Enabled) -Raw | ConvertFrom-Json
  $entry = @($enabled | Where-Object { $_.pack_id -eq $manifest.header.uuid })
  if ($entry.Count -ne 1 -or ($entry[0].version -join '.') -ne ($manifest.header.version -join '.')) { throw "启用列表 UUID / 版本不匹配: $($pair.Id)" }
  $targetRoot = [IO.Path]::GetFullPath((Join-Path (Join-Path $worldRoot $pair.Kind) $pair.Folder))
  $allowedRoot = [IO.Path]::GetFullPath((Join-Path $worldRoot $pair.Kind)) + [IO.Path]::DirectorySeparatorChar
  if (-not $targetRoot.StartsWith($allowedRoot,[StringComparison]::OrdinalIgnoreCase)) { throw '目标超出专用包目录' }
  $installed = Get-Content -LiteralPath (Join-Path $targetRoot 'manifest.json') -Raw | ConvertFrom-Json
  if ($installed.header.uuid -ne $manifest.header.uuid) { throw '已安装包身份不符' }
  $pair.Source=$sourceRoot; $pair.Target=$targetRoot
}
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
foreach ($pair in $pairs) {
  Copy-Item -LiteralPath (Join-Path $worldRoot $pair.Enabled) -Destination $backupRoot
  Copy-Item -LiteralPath $pair.Target -Destination (Join-Path $backupRoot $pair.Folder) -Recurse
}
$report = @()
foreach ($pair in $pairs) {
  $sourceFiles = @(Get-ChildItem -LiteralPath $pair.Source -Recurse -File)
  $expected = @{}
  foreach ($file in $sourceFiles) {
    $relative = [IO.Path]::GetRelativePath($pair.Source,$file.FullName)
    $expected[$relative]=$true
    $destination = Join-Path $pair.Target $relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath $file.FullName -Destination $destination -Force
    $hash=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
    if ($hash -ne (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash) { throw "同步校验失败: $relative" }
    $report += @{pack=$pair.Id;file=$relative;sha256=$hash}
  }
  foreach ($file in @(Get-ChildItem -LiteralPath $pair.Target -Recurse -File)) {
    $relative=[IO.Path]::GetRelativePath($pair.Target,$file.FullName)
    if (-not $expected.ContainsKey($relative)) {
      # Only obsolete files INSIDE this backed-up package may be removed. Never touch db/level.dat.
      $prefix=$pair.Target+[IO.Path]::DirectorySeparatorChar
      if (-not $file.FullName.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)) { throw '过期文件超出包目录' }
      $saved=Join-Path (Join-Path $backupRoot $pair.Folder) $relative
      if (-not (Test-Path -LiteralPath $saved)) { throw '过期文件尚未备份' }
      Remove-Item -LiteralPath $file.FullName -Force
    }
  }
}
@{world=$worldRoot;backup=$backupRoot;timestamp=$taskStamp;files=$report;enabledListsChanged=$false} |
  ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $backupRoot 'sync-report.json') -Encoding utf8
Write-Output "已同步并逐文件验证 $($report.Count) 个文件。备份: $backupRoot"
Write-Output '未修改地图、玩家数据、启用列表或其他小游戏包。退出并重新进入存档后资源才会重新加载。'
