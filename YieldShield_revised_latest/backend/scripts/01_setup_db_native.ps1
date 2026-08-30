# =====================================================================
# YieldShield — native (no Docker) Postgres setup — PowerShell version
# Run this from backend\, e.g.:
#   .\scripts\01_setup_db_native.ps1
#
# Requires: a local PostgreSQL server already running, and `psql` /
# `createdb` on your PATH (they ship with the standard Postgres
# Windows installer, under <install-dir>\bin — add that to PATH if
# "psql is not recognized" shows up).
#
# You'll be prompted for the yieldshield_owner password. Superuser
# steps (creating the role, running 02_security.sql) use the
# superuser named below — change it if yours isn't "postgres".
# =====================================================================

$ErrorActionPreference = "Stop"

$SuperUser = if ($env:PGSUPERUSER) { $env:PGSUPERUSER } else { "postgres" }
$DbName = "yieldshield"

Write-Host "== 1. Create database =="
$prevEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$createdbResult = & createdb -U $SuperUser $DbName 2>&1
$ErrorActionPreference = $prevEap
if ($LASTEXITCODE -ne 0) {
    Write-Host "   (database '$DbName' already exists, continuing)"
}

Write-Host "== 2. Create yieldshield_owner role =="
$OwnerPwSecure = Read-Host "   Enter a password for yieldshield_owner" -AsSecureString
$OwnerPw = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($OwnerPwSecure)
)

$roleSql = @"
DO `$`$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'yieldshield_owner') THEN
        CREATE ROLE yieldshield_owner LOGIN PASSWORD '$OwnerPw' CREATEDB;
    END IF;
END
`$`$;
ALTER DATABASE $DbName OWNER TO yieldshield_owner;
"@
$roleSql | & psql -U $SuperUser -d $DbName -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) { throw "Failed creating yieldshield_owner role" }

Write-Host "== 3. Apply schema (01_schema.sql) as yieldshield_owner =="
$env:PGPASSWORD = $OwnerPw
& psql "dbname=$DbName" -U yieldshield_owner -h localhost -v ON_ERROR_STOP=1 -f migrations\01_schema.sql
if ($LASTEXITCODE -ne 0) { throw "Failed applying 01_schema.sql" }

Write-Host "== 4. Harden security (02_security.sql) - must run as superuser =="
Write-Host "   NOTE: edit the CHANGE_ME_* passwords inside migrations\02_security.sql"
Write-Host "   before continuing, or accept the placeholders for local dev only."
Read-Host "   Press Enter once you've reviewed migrations\02_security.sql" | Out-Null
Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
& psql -U $SuperUser -d $DbName -v ON_ERROR_STOP=1 -f migrations\02_security.sql
if ($LASTEXITCODE -ne 0) { throw "Failed applying 02_security.sql" }

Write-Host "== 5. Auth + reset-token additions (03_auth_reset.sql) =="
$env:PGPASSWORD = $OwnerPw
& psql "dbname=$DbName" -U yieldshield_owner -h localhost -v ON_ERROR_STOP=1 -f migrations\03_auth_reset.sql
if ($LASTEXITCODE -ne 0) { throw "Failed applying 03_auth_reset.sql" }

Write-Host "== 6. Farm input extra fields (04_farm_input_extra.sql) =="
& psql "dbname=$DbName" -U yieldshield_owner -h localhost -v ON_ERROR_STOP=1 -f migrations\04_farm_input_extra.sql
if ($LASTEXITCODE -ne 0) { throw "Failed applying 04_farm_input_extra.sql" }

Write-Host "== 7. Harvest record fields (05_harvest_record.sql) =="
& psql "dbname=$DbName" -U yieldshield_owner -h localhost -v ON_ERROR_STOP=1 -f migrations\05_harvest_record.sql
if ($LASTEXITCODE -ne 0) { throw "Failed applying 05_harvest_record.sql" }

Write-Host "== 8. User barangay linkage (06_user_barangay.sql) =="
& psql "dbname=$DbName" -U yieldshield_owner -h localhost -v ON_ERROR_STOP=1 -f migrations\06_user_barangay.sql
if ($LASTEXITCODE -ne 0) { throw "Failed applying 06_user_barangay.sql" }

Write-Host "== 9. v2 features - fields, tasks, announcements, registrations, audit log (07_v2_features.sql) =="
& psql "dbname=$DbName" -U yieldshield_owner -h localhost -v ON_ERROR_STOP=1 -f migrations\07_v2_features.sql
if ($LASTEXITCODE -ne 0) { throw "Failed applying 07_v2_features.sql" }

Write-Host "== 10. Crop variety reference catalog (08_crop_varieties.sql) =="
& psql "dbname=$DbName" -U yieldshield_owner -h localhost -v ON_ERROR_STOP=1 -f migrations\08_crop_varieties.sql
if ($LASTEXITCODE -ne 0) { throw "Failed applying 08_crop_varieties.sql" }

Write-Host "== 11. Notifications (09_notifications.sql) =="
& psql "dbname=$DbName" -U yieldshield_owner -h localhost -v ON_ERROR_STOP=1 -f migrations\09_notifications.sql
if ($LASTEXITCODE -ne 0) { throw "Failed applying 09_notifications.sql" }

Write-Host "== 12. Filed-by tracking (10_filed_by.sql) =="
& psql "dbname=$DbName" -U yieldshield_owner -h localhost -v ON_ERROR_STOP=1 -f migrations\10_filed_by.sql
if ($LASTEXITCODE -ne 0) { throw "Failed applying 10_filed_by.sql" }

Write-Host "== 13. Push subscriptions (11_push_subscriptions.sql) =="
& psql "dbname=$DbName" -U yieldshield_owner -h localhost -v ON_ERROR_STOP=1 -f migrations\11_push_subscriptions.sql
if ($LASTEXITCODE -ne 0) { throw "Failed applying 11_push_subscriptions.sql" }

Write-Host "== 14. Field coordinates (12_field_coordinates.sql) =="
& psql "dbname=$DbName" -U yieldshield_owner -h localhost -v ON_ERROR_STOP=1 -f migrations\12_field_coordinates.sql
if ($LASTEXITCODE -ne 0) { throw "Failed applying 12_field_coordinates.sql" }

Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Done. Database '$DbName' is ready."
Write-Host "Next: set yieldshield_app / yieldshield_etl / yieldshield_analyst"
Write-Host "passwords for real (they were created with CHANGE_ME_* placeholders"
Write-Host "in 02_security.sql) - e.g.:"
Write-Host "    psql -U $SuperUser -d $DbName -c `"ALTER ROLE yieldshield_app PASSWORD 'your-real-password';`""
Write-Host "Then update .env with that password before running the ETL load or the backend."
