$ErrorActionPreference = 'Stop'
try {
  $usageInput = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $usageSnapshot = @{ updatedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
  foreach ($usageKey in @('five_hour', 'seven_day')) {
    $usageWindow = $usageInput.rate_limits.$usageKey
    if ($null -ne $usageWindow.used_percentage -and $null -ne $usageWindow.resets_at) {
      $usageSnapshot[$usageKey] = @{ used_percentage = [double]$usageWindow.used_percentage; resets_at = [double]$usageWindow.resets_at }
    }
  }
  if ($env:OFFICE_USAGE_FILE) {
    [IO.File]::WriteAllText($env:OFFICE_USAGE_FILE, ($usageSnapshot | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding($false)))
  }
  [Console]::Write('Office Desk')
} catch { [Console]::Write('Office Desk') }
