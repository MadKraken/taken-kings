<#
  Taken Kings -- local keep-alive.

  A backstop for the GitHub Action, run from this machine by Task Scheduler. It does nothing at
  all while the Action is healthy; it takes over if the Action stops.

  Why it exists: GitHub disables scheduled workflows in a public repo after 60 days with no
  repository activity, and a disabled schedule stays disabled until somebody re-enables it -- the
  Action cannot resurrect itself. Pushing from here uses real account credentials, so it is
  unambiguously repository activity (unlike a GITHUB_TOKEN commit, whose status is undocumented;
  see docs/LONGEVITY.md), and `gh workflow enable` can switch a disabled schedule back on.

  Each run:
    1. Re-enables any workflow GitHub disabled for inactivity.
    2. If the committed snapshot is older than -StaleDays, the Action is evidently not running:
       fetch a fresh one, commit it, push. That refreshes the fallback board, counts as Supabase
       activity (keeping the ~7-day pause fuse from burning down) and resets GitHub's 60-day clock.
    3. Otherwise does nothing. No duplicate commits while the Action is doing its job.

  It will NOT push when there are local commits that have not been pushed -- your unpushed work is
  yours to send. It logs that and skips, so check the log if the game has gone quiet.

  Log: keepalive.log, beside this working copy (gitignored)
  Run by hand:  powershell -ExecutionPolicy Bypass -File scripts\keepalive.ps1 -Force
#>
param(
  [int]$StaleDays = 5,     # under Supabase's ~7-day pause fuse, with slack for a machine left off
  [switch]$Force           # refresh and push even if the snapshot is fresh
)

$Repo = Split-Path -Parent $PSScriptRoot
Set-Location $Repo

# The log lives beside the working copy, not under AppData: a scheduled task and a packaged
# (sandboxed) shell resolve LOCALAPPDATA to different directories, so a log written there is easy
# to lose track of -- which is the one thing this script exists to prevent. Gitignored.
$Log = Join-Path $Repo 'keepalive.log'
function Say([string]$msg) {
  $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm'), $msg
  try { Add-Content -Path $Log -Value $line -Encoding ascii -ErrorAction Stop }
  catch { Write-Output "LOG WRITE FAILED: $($_.Exception.Message)" }
  Write-Output $line
}

# --- 1. Re-enable anything GitHub switched off for inactivity --------------------------------
# Done first and unconditionally: it is the one repair nothing else can perform.
if (Get-Command gh -ErrorAction SilentlyContinue) {
  $raw = & gh workflow list --all --json name,state,id 2>$null
  if ($LASTEXITCODE -eq 0 -and $raw) {
    try {
      foreach ($w in ($raw | ConvertFrom-Json)) {
        if ($w.state -eq 'disabled_inactivity') {
          & gh workflow enable $w.id 2>$null
          if ($LASTEXITCODE -eq 0) { Say "re-enabled workflow '$($w.name)' (GitHub had disabled it for inactivity)" }
          else { Say "FAILED to re-enable workflow '$($w.name)' -- do it from the Actions tab" }
        }
      }
    } catch { Say "could not read workflow states: $($_.Exception.Message)" }
  }
} else {
  Say "gh not found -- cannot check whether GitHub disabled the schedule"
}

# --- 2. Only ever act on a clean, in-sync main ------------------------------------------------
$branch = (& git rev-parse --abbrev-ref HEAD 2>$null)
if ($LASTEXITCODE -ne 0) { Say 'not a git repo -- stopping'; exit 1 }
$branch = $branch.Trim()
if ($branch -ne 'main') { Say "on branch '$branch', not main -- skipping"; exit 0 }

& git fetch --quiet origin main 2>$null
if ($LASTEXITCODE -ne 0) { Say 'git fetch failed (offline?) -- skipping'; exit 0 }

$ahead = (& git rev-list --count origin/main..HEAD).Trim()
if ($ahead -ne '0') {
  Say "$ahead local commit(s) not yet pushed -- leaving them alone, skipping this run"
  exit 0
}
$behind = (& git rev-list --count HEAD..origin/main).Trim()
if ($behind -ne '0') {
  & git merge --ff-only origin/main | Out-Null
  if ($LASTEXITCODE -ne 0) { Say 'could not fast-forward -- skipping'; exit 0 }
  Say "fast-forwarded $behind commit(s) from origin"
}

# --- 3. Is the Action still keeping the snapshot fresh? ---------------------------------------
$snapPath = Join-Path $Repo 'leaderboard-snapshot.json'
$ageDays = 9999
if (Test-Path $snapPath) {
  try {
    $snap = Get-Content $snapPath -Raw | ConvertFrom-Json
    $taken = ([datetimeoffset]$snap.fetched_at).UtcDateTime
    $ageDays = [math]::Round(([datetime]::UtcNow - $taken).TotalDays, 1)
  } catch { Say "could not read the snapshot's date -- treating it as stale" }
}
if ($ageDays -lt $StaleDays -and -not $Force) {
  Say "snapshot is ${ageDays}d old -- the Action is keeping up, nothing to do"
  exit 0
}

# --- 4. Take over: refresh the snapshot and push it --------------------------------------------
$Py = $null
foreach ($c in @('python', 'python3')) {
  $cmd = Get-Command $c -ErrorAction SilentlyContinue
  if ($cmd) { $Py = $cmd.Source; break }
}
if (-not $Py) { Say 'python not found -- cannot refresh the snapshot'; exit 1 }

& $Py (Join-Path $Repo 'scripts\snapshot_leaderboard.py')
if ($LASTEXITCODE -ne 0) { Say "snapshot fetch failed (Supabase paused or gone?) -- nothing committed, previous snapshot kept"; exit 1 }

& git diff --quiet -- leaderboard-snapshot.json
if ($LASTEXITCODE -eq 0) { Say 'snapshot unchanged -- nothing to commit'; exit 0 }

& git add -- leaderboard-snapshot.json
& git commit -q -m "Leaderboard snapshot $(Get-Date -Format 'yyyy-MM-dd') (local keep-alive)"
if ($LASTEXITCODE -ne 0) { Say 'commit failed'; exit 1 }
& git push -q origin main
if ($LASTEXITCODE -ne 0) { Say 'push failed -- snapshot is committed locally but not sent'; exit 1 }
Say "pushed a fresh snapshot -- the Action had not run in ${ageDays}d"
exit 0
