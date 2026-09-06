# Builds dist\shareloc-demo-<date>.zip from the tracked files of the current branch.
# Secrets (shareloc.properties, .env, local.properties) are git-ignored and therefore never included.
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
New-Item -ItemType Directory -Force -Path dist | Out-Null
$name = "shareloc-demo-$(Get-Date -Format yyyyMMdd)"
git archive --format=zip --prefix="$name/" -o "dist\$name.zip" HEAD
Write-Host "Wrote dist\$name.zip ($([math]::Round((Get-Item "dist\$name.zip").Length / 1KB)) KB)"
