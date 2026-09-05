$ErrorActionPreference = "Stop"
$project = Split-Path -Parent $MyInvocation.MyCommand.Path
$target = Join-Path $project "gradle\wrapper\gradle-wrapper.jar"

if (Test-Path $target) {
    Write-Host "Gradle wrapper is already present: $target"
    exit 0
}

$candidates = @()
if ($env:JAVA_HOME) { $candidates += (Join-Path $env:JAVA_HOME "bin\java.exe") }
$candidates += "java.exe"
$candidates += "$env:ProgramFiles\Android\Android Studio\jbr\bin\java.exe"
$candidates += "$env:LOCALAPPDATA\Programs\Android Studio\jbr\bin\java.exe"

$java = $null
foreach ($candidate in $candidates) {
    if ($candidate -eq "java.exe") {
        if (Get-Command java.exe -ErrorAction SilentlyContinue) { $java = "java.exe"; break }
    } elseif (Test-Path $candidate) {
        $java = $candidate
        break
    }
}

if (-not $java) {
    throw "Java was not found. Install Android Studio or set JAVA_HOME, then rerun this script."
}

& $java (Join-Path $project "gradle\wrapper\WrapperDownloader.java") $target
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "Gradle wrapper bootstrap complete."
