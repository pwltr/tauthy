$ErrorActionPreference = 'Stop'
$appPath = Join-Path $PSScriptRoot 'Tauthy Migration Test.exe'
$markerPath = Join-Path $PSScriptRoot 'last-run.txt'
Write-Host 'Quit Tauthy Migration Test before selecting a run.'
Write-Host '1  New passwordless migration'
Write-Host '2  New password migration (password: test-password)'
Write-Host '3  New passwordless migration with simulated credential denial'
Write-Host '4  Reopen last run (credentials allowed)'
$choice = Read-Host 'Choose'
$deny = $false
switch ($choice) {
  '1' { $fixture = 'passwordless' }
  '2' { $fixture = 'password' }
  '3' { $fixture = 'passwordless'; $deny = $true }
  '4' {
    if (!(Test-Path -LiteralPath $markerPath -PathType Leaf)) { throw 'No previous run saved.' }
    if ((Get-Item -LiteralPath $markerPath).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Refusing linked run marker.' }
    $saved = @(Get-Content -LiteralPath $markerPath)
    if ($saved.Count -ne 2 -or $saved[0] -notin @('passwordless', 'password') -or $saved[1] -cnotmatch '^[A-Za-z0-9-]{1,64}$') { throw 'Invalid run marker.' }
    $fixture = $saved[0]
    $runId = $saved[1]
  }
  default { throw 'Unknown choice.' }
}
if ($choice -ne '4') {
  $runId = [Guid]::NewGuid().ToString()
  if ((Test-Path -LiteralPath $markerPath) -and ((Get-Item -LiteralPath $markerPath).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Refusing linked run marker.' }
  @($fixture, $runId) | Set-Content -LiteralPath $markerPath -Encoding ASCII
}
$testArguments = @('--migration-fixture', $fixture, '--migration-run', $runId)
if ($deny) { $testArguments += '--deny-test-credentials' }
Write-Host "Fixture: $fixture / run: $runId"
Write-Host 'Dummy accounts: Dropbox and GitHub. Do not connect to your live sync folder.'
Start-Process -FilePath $appPath -ArgumentList $testArguments
