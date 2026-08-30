# =====================================================================
# YieldShield — load the historical dataset (no Docker) — PowerShell
# Run this from backend\, e.g.:
#   .\scripts\02_load_data.ps1 "C:\path\to\binalonan_crop_data4.xlsx"
#
# Requires: Python 3.10+, and a .env file already filled in
# (copy .env.example to .env first and set real values).
# =====================================================================

param(
    [Parameter(Mandatory = $true)]
    [string]$XlsxPath
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path ".env")) {
    Write-Host "Error: .env not found. Run: copy .env.example .env, then fill it in."
    exit 1
}

if (-not (Test-Path $XlsxPath)) {
    Write-Host "Error: file not found: $XlsxPath"
    exit 1
}

Write-Host "== Installing Python dependencies =="
pip install -r requirements.txt --break-system-packages
if ($LASTEXITCODE -ne 0) { throw "pip install failed" }

Write-Host "== Loading dataset =="

# Load .env into the current process's environment (KEY=VALUE lines,
# '#' comments and blank lines skipped).
Get-Content ".env" | ForEach-Object {
    $line = $_.Trim()
    if ($line -eq "" -or $line.StartsWith("#")) { return }
    $idx = $line.IndexOf("=")
    if ($idx -lt 1) { return }
    $key = $line.Substring(0, $idx).Trim()
    $val = $line.Substring($idx + 1).Trim()
    [System.Environment]::SetEnvironmentVariable($key, $val, "Process")
}

# etl_load.py must connect as yieldshield_etl, not yieldshield_app —
# the app role is read-only on these reference/historical tables.
$env:PGUSER = $env:ETL_PGUSER
$env:PGPASSWORD = $env:ETL_PGPASSWORD

python etl_load.py --xlsx $XlsxPath
if ($LASTEXITCODE -ne 0) { throw "etl_load.py failed" }

Write-Host ""
Write-Host "Done. Historical + reference tables are populated."
Write-Host "Re-running this script is safe (upserts, no duplicates)."
