$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$tmp = Join-Path $root "_build"
$out = Join-Path $root "SND5技能包.mcaddon"
$zip = Join-Path $root "_build.zip"

if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force }
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
New-Item -ItemType Directory -Path $tmp | Out-Null
Copy-Item -LiteralPath (Join-Path $root "BP") -Destination (Join-Path $tmp "jimie_schools_BP") -Recurse
Copy-Item -LiteralPath (Join-Path $root "RP") -Destination (Join-Path $tmp "jimie_schools_RP") -Recurse
Compress-Archive -Path (Join-Path $tmp "*") -DestinationPath $zip -Force
Move-Item -LiteralPath $zip -Destination $out -Force -ErrorAction Stop
Remove-Item -LiteralPath $tmp -Recurse -Force
Write-Host "已生成: $out"
