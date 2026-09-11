param([string]$PushUrl, [string[]]$DestinationRefs = @())
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\', '/')
$expectedRoot = 'C:\Users\cdali\Documents\Codex\TOF-Isolated'
if ($root -ne $expectedRoot) { throw 'STOP: this guard belongs only to the dedicated TOF checkout.' }
$cwd = [IO.Path]::GetFullPath((Get-Location).Path).TrimEnd('\', '/')
if ($cwd -ne $root -and -not $cwd.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'STOP: current directory is outside the TOF checkout.' }
$top = & git -C $root rev-parse --show-toplevel
if ($LASTEXITCODE -ne 0 -or [IO.Path]::GetFullPath($top).TrimEnd('\', '/') -ne $root) { throw 'STOP: unexpected Git root.' }
$allowed = @('https://github.com/TopFalls/Topofthefalls.git', 'git@github.com:TopFalls/Topofthefalls.git', 'ssh://git@github.com/TopFalls/Topofthefalls.git')
$remotes = @(& git -C $root remote)
if ($LASTEXITCODE -ne 0 -or $remotes.Count -ne 1 -or $remotes[0] -ne 'origin') { throw 'STOP: only origin is allowed.' }
foreach ($kind in @('fetch', 'push')) {
  $urls = if ($kind -eq 'push') { @(& git -C $root remote get-url --push --all origin) } else { @(& git -C $root remote get-url --all origin) }
  if ($LASTEXITCODE -ne 0 -or $urls.Count -eq 0) { throw 'STOP: missing remote URL.' }
  foreach ($url in $urls) { if ($allowed -cnotcontains $url) { throw 'STOP: remote URL is outside the TOF allowlist.' } }
}
if ($PushUrl -and $allowed -cnotcontains $PushUrl) { throw 'STOP: push destination is outside the TOF allowlist.' }
foreach ($ref in $DestinationRefs) {
  if ($ref -notlike 'refs/heads/*' -or $ref -eq 'refs/heads/main') { throw 'STOP: direct production or non-branch pushes are blocked. Use a reviewed PR and explicit production approval.' }
}
$boundary = Get-Content -LiteralPath (Join-Path $root 'docs/TOF-BOUNDARY.json') -Raw | ConvertFrom-Json
if ($boundary.repository -cne 'TopFalls/Topofthefalls' -or $boundary.supabaseRef -cne 'dpbgdisezxlttwrxqanu' -or $boundary.supabaseUrl -cne 'https://dpbgdisezxlttwrxqanu.supabase.co' -or $boundary.vercelProjectId -cne 'prj_jK1NPxfyM3pJN0iXqCyGPoHTzwXo' -or $boundary.vercelTeamId -cne 'team_TiDDLGgPBC8TlMQKmrNcFNl8') { throw 'STOP: boundary manifest differs from the pinned identities.' }
$link = Get-Content -LiteralPath (Join-Path $root '.vercel/project.json') -Raw | ConvertFrom-Json
if ($link.projectId -cne 'prj_jK1NPxfyM3pJN0iXqCyGPoHTzwXo' -or $link.orgId -cne 'team_TiDDLGgPBC8TlMQKmrNcFNl8' -or $link.projectName -cne 'topofthefalls') { throw 'STOP: Vercel project/team mismatch.' }
$ref = (Get-Content -LiteralPath (Join-Path $root 'supabase/.temp/project-ref') -Raw).Trim()
if ($ref -cne 'dpbgdisezxlttwrxqanu') { throw 'STOP: Supabase project mismatch.' }
$config = Get-Content -LiteralPath (Join-Path $root 'supabase/config.toml') -Raw
if ($config -notmatch '(?m)^project_id\s*=\s*"dpbgdisezxlttwrxqanu"\s*$') { throw 'STOP: Supabase config project mismatch.' }
foreach ($name in @('SUPABASE_PROJECT_REF','SUPABASE_URL','VITE_SUPABASE_URL','VERCEL_PROJECT_ID','VERCEL_ORG_ID')) {
  $value = [Environment]::GetEnvironmentVariable($name)
  $expected = switch ($name) {
    'SUPABASE_PROJECT_REF' { 'dpbgdisezxlttwrxqanu' }
    'SUPABASE_URL' { 'https://dpbgdisezxlttwrxqanu.supabase.co' }
    'VITE_SUPABASE_URL' { 'https://dpbgdisezxlttwrxqanu.supabase.co' }
    'VERCEL_PROJECT_ID' { 'prj_jK1NPxfyM3pJN0iXqCyGPoHTzwXo' }
    'VERCEL_ORG_ID' { 'team_TiDDLGgPBC8TlMQKmrNcFNl8' }
  }
  if ($value -and $value.TrimEnd('/') -cne $expected) { throw "STOP: $name targets a different resource." }
}
$hooks = & git -C $root config --local --get core.hooksPath
if ($hooks -ne '.tof-hooks') { throw 'STOP: TOF push hook is not configured.' }
if (-not (Test-Path -LiteralPath (Join-Path $root '.tof-hooks/pre-push') -PathType Leaf)) { throw 'STOP: TOF push hook is missing.' }
foreach ($file in @(Get-ChildItem -LiteralPath $root -Filter '.env*' -File)) {
  foreach ($line in @(Get-Content -LiteralPath $file.FullName)) {
    if ($line -match '^\s*(?:export\s+)?(?:VITE_SUPABASE_URL|SUPABASE_URL)\s*=\s*(.*?)\s*$') {
      $endpoint = $Matches[1].Trim().Trim([char]34, [char]39).TrimEnd('/')
      if ($endpoint -cne 'https://dpbgdisezxlttwrxqanu.supabase.co') { throw 'STOP: an environment file has an unapproved Supabase endpoint. Value suppressed.' }
    }
  }
}
Write-Output 'PASS: TOF checkout, Git remotes, Supabase link, Vercel link, environment IDs and hook configuration match.'
Write-Output 'This checks local identity; it does not establish cloud authorization or enforce an OS sandbox.'
