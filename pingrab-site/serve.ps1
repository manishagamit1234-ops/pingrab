# ==========================================================================
#  PinGrab - local test server
#  --------------------------------------------------------------------------
#  Starts the small Python server (server.py) which both hosts the static
#  files and provides the /api/resolve and /api/download endpoints.
#
#  Use:
#     powershell -NoProfile -ExecutionPolicy Bypass -File serve.ps1
#     powershell -NoProfile -ExecutionPolicy Bypass -File serve.ps1 -Port 9000
#     powershell -NoProfile -ExecutionPolicy Bypass -File serve.ps1 -NoBrowser
#
#  Then open in a browser:  http://localhost:8787
#  To stop it: Ctrl + C
# ==========================================================================
param(
    [int]$Port = 8787,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { $python = Get-Command py -ErrorAction SilentlyContinue }
if (-not $python) {
    Write-Host ''
    Write-Host '  Python 3 was not found on your PATH.' -ForegroundColor Red
    Write-Host '  Install it from https://www.python.org/downloads/ and tick'
    Write-Host '  "Add python.exe to PATH", then run this script again.'
    Write-Host ''
    exit 1
}

$server = Join-Path $PSScriptRoot 'server.py'
if (-not (Test-Path -LiteralPath $server)) {
    Write-Host "  server.py not found next to serve.ps1" -ForegroundColor Red
    exit 1
}

$env:PORT = "$Port"
$env:PINGRAB_OPEN = $(if ($NoBrowser) { '0' } else { '1' })

Write-Host ''
Write-Host '  PinGrab test server' -ForegroundColor Cyan
Write-Host "  Python  : $($python.Source)"
Write-Host "  Open    : http://localhost:$Port/" -ForegroundColor Green
Write-Host '  Stop    : Ctrl + C'
Write-Host ''

& $python.Source $server
