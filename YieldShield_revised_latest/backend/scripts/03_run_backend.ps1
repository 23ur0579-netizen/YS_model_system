# =====================================================================
# YieldShield — run the FastAPI backend (no Docker) — PowerShell
# Run this from backend\, in its own terminal — it stays running in
# the foreground, serving on port 8000.
#
# Requires: .env filled in (PGPASSWORD, JWT_SECRET at minimum).
# Note: this build doesn't call the yield prediction model yet —
# /farm-input still writes to the DB and returns normally, just with
# prediction_status: "pending".
# =====================================================================

$ErrorActionPreference = "Stop"

if (-not (Test-Path ".env")) {
    Write-Host "Error: .env not found. Run: copy .env.example .env, then fill it in."
    exit 1
}

pip install -r requirements.txt --break-system-packages
if ($LASTEXITCODE -ne 0) { throw "pip install failed" }

Get-Content ".env" | ForEach-Object {
    $line = $_.Trim()
    if ($line -eq "" -or $line.StartsWith("#")) { return }
    $idx = $line.IndexOf("=")
    if ($idx -lt 1) { return }
    $key = $line.Substring(0, $idx).Trim()
    $val = $line.Substring($idx + 1).Trim()
    [System.Environment]::SetEnvironmentVariable($key, $val, "Process")
}

Write-Host "== Starting FastAPI backend on port 8000 (docs at /docs) =="
uvicorn app.main:app --reload --port 8000
