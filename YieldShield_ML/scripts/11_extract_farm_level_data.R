# ============================================================
# 11_extract_farm_level_data.R
#
# Pulls a NEW, per-farmer-level training dataset directly from the
# live YieldShield application database — the one data source that
# actually has ecosystem, seed source, variety, and technique recorded
# per cropping, tied to a real recorded harvest yield. Nothing the
# historical Central Data sheet (01_audited.rds onward) has ever had,
# at any grain finer than barangay+season — confirmed by direct
# inspection this session, not assumed.
#
# This is intentionally NOT part of run_pipeline.R's 01-10 sequence,
# and does not read or write anything in that sequence's files. It's
# a separate, optional, on-demand data source — run it by itself,
# whenever there's enough real (not seeded/test) farmer activity in
# the live database to be worth extracting. It writes to its own
# output paths only:
#     data/11_farm_level_raw.rds
#     data/11_farm_level_raw.csv
# 01_audited.rds / 02_prepared.rds / 03_features.rds / 05_model_ready.rds
# and the original Excel workbook are never touched by this script.
#
# ---------------------------------------------------------------
# SETUP — one-time
# ---------------------------------------------------------------
# 1. Install the two packages this script needs beyond the rest of
#    the pipeline (nothing else here uses a live DB connection):
#      install.packages(c("DBI", "RPostgres"))
#
# 2. Set the same environment variables the backend's own .env uses,
#    but with PGUSER/PGPASSWORD set to the *yieldshield_analyst* role
#    specifically (see backend/.env's ETL_PGUSER/ETL_PGPASSWORD lines
#    for that pattern — same idea, different role). yieldshield_analyst
#    is deliberately used here, not yieldshield_etl or yieldshield_app:
#    yieldshield_etl is explicitly, permanently revoked from
#    farm_input_log/farm_profile access (backend/migrations/
#    02_security.sql — "The ETL role must NEVER touch ... farm
#    submissions ... those belong to the running application"), and
#    yieldshield_app's own connections always run through the RLS
#    session-variable dance the backend sets up per-request, which a
#    standalone script has no equivalent for. yieldshield_analyst is
#    the one already built for exactly this: read-only across every
#    table (except password_hash and audit_log, per 02_security.sql).
#
#      PGHOST=<same as backend .env>
#      PGPORT=<same as backend .env>
#      PGDATABASE=<same as backend .env>
#      PGUSER=yieldshield_analyst
#      PGPASSWORD=<the analyst role's real password>
#
# Usage (from the project root, with the above set in your shell):
#   Rscript scripts/11_extract_farm_level_data.R
# ============================================================

source("config.R")

suppressPackageStartupMessages({
  library(DBI)
  library(RPostgres)
  library(dplyr)
})

FARM_LEVEL_RDS <- file.path(DATA_DIR, "11_farm_level_raw.rds")
FARM_LEVEL_CSV <- file.path(DATA_DIR, "11_farm_level_raw.csv")

required_env <- c("PGHOST", "PGDATABASE", "PGUSER", "PGPASSWORD")
missing_env <- required_env[!nzchar(Sys.getenv(required_env))]
if (length(missing_env) > 0) {
  stop(
    "Missing required environment variable(s): ", paste(missing_env, collapse = ", "),
    "\nSee this script's header comment for what to set and why."
  )
}
if (Sys.getenv("PGUSER") != "yieldshield_analyst") {
  cat(
    "[11] Warning: PGUSER is '", Sys.getenv("PGUSER"), "', not 'yieldshield_analyst'.\n",
    "     This script only needs read access, and yieldshield_analyst is the role\n",
    "     built for that (see header comment) - continuing anyway in case you have\n",
    "     a deliberate reason, but double-check this wasn't just left over from\n",
    "     another script's session.\n",
    sep = ""
  )
}

cat("[11] Connecting to", Sys.getenv("PGDATABASE"), "as", Sys.getenv("PGUSER"), "...\n")
con <- dbConnect(
  RPostgres::Postgres(),
  host = Sys.getenv("PGHOST"),
  port = as.integer(Sys.getenv("PGPORT", "5432")),
  dbname = Sys.getenv("PGDATABASE"),
  user = Sys.getenv("PGUSER"),
  password = Sys.getenv("PGPASSWORD"),
  sslmode = Sys.getenv("PGSSLMODE", "prefer")
)
on.exit(dbDisconnect(con), add = TRUE)

# Every field this script can get that the historical dataset never
# could: exact planting_date (not just DS/WS), ecosystem, seed_type,
# variety (+ its catalog category, via crop_variety - NULL for a
# farmer's own/traditional seed, which was never in that catalog to
# begin with), technique_name, spacing_cm, seed_rate. Restricted to
# actual_yield_mt_ha IS NOT NULL - a still-growing cropping has no
# real outcome to train on yet, so including it would just be a row
# with a missing target.
query <- "
  SELECT
    ct.crop_name                    AS crop_type,
    b.barangay_name                 AS barangay,
    b.soil_type,
    CASE
      WHEN EXTRACT(MONTH FROM fil.planting_date) BETWEEN 6 AND 11 THEN 'WS'
      ELSE 'DS'
    END                              AS season_type,
    fil.planting_date,
    fil.ecosystem,
    fil.seed_type,
    fil.variety,
    cv.category                     AS variety_category,
    cv.average_yield_t_ha           AS variety_avg_yield_t_ha,
    fil.technique_name,
    fil.spacing_cm,
    fil.seed_rate,
    COALESCE(fil.land_area_ha, fp.land_area_ha) AS land_area_ha,
    fil.rainfall_input              AS rainfall,
    fil.temperature_input           AS avg_temp,
    fil.ph,
    fil.soil_moisture_pct,
    fil.actual_yield_mt_ha,
    fil.harvest_date
  FROM yieldshield.farm_input_log fil
  JOIN yieldshield.farm_profile fp  ON fp.farm_id = fil.farm_id
  JOIN yieldshield.barangay b       ON b.barangay_id = fp.barangay_id
  JOIN yieldshield.crop_type ct     ON ct.crop_type_id = fp.crop_type_id
  LEFT JOIN yieldshield.crop_variety cv
         ON cv.crop_type_id = fp.crop_type_id AND cv.variety_name = fil.variety
  WHERE fil.actual_yield_mt_ha IS NOT NULL
  ORDER BY fil.planting_date
"
farm_level <- dbGetQuery(con, query)

cat("[11] Retrieved", nrow(farm_level), "harvested, per-farmer cropping record(s).\n")

if (nrow(farm_level) == 0) {
  cat(
    "[11] Zero rows - nothing harvested yet in this database, or every harvested\n",
    "     row so far is seeded/test data rather than a real farmer's submission.\n",
    "     Nothing useful to train on yet; re-run this once real farmers have used\n",
    "     the app across at least one full season. Not writing an empty output.\n",
    sep = ""
  )
} else {
  saveRDS(farm_level, FARM_LEVEL_RDS)
  write.csv(farm_level, FARM_LEVEL_CSV, row.names = FALSE)
  cat("[11] Saved", FARM_LEVEL_RDS, "and", FARM_LEVEL_CSV, "\n")

  # A rough, honest read on whether this is anywhere near enough to
  # retrain on yet - not a hard rule, just a sanity signal. The
  # existing barangay-season model trains on ~874 rows across ~28
  # categorical dummy columns; a per-farmer model adding ecosystem/
  # seed_type/technique/variety as further categoricals needs *more*
  # rows per category to learn each one's effect reliably, not fewer.
  n_varieties <- length(unique(na.omit(farm_level$variety)))
  n_techniques <- length(unique(na.omit(farm_level$technique_name)))
  cat(
    "\n[11] Coverage check (not a go/no-go rule, just context):\n",
    "     ", nrow(farm_level), " harvested rows across ", n_varieties, " distinct varieties\n",
    "     and ", n_techniques, " distinct techniques. Each additional category needs its\n",
    "     own repeated observations, under varying conditions, to separate its real\n",
    "     effect from ordinary season-to-season noise - a handful of rows spread\n",
    "     across many categories is a preview of what this pipeline will eventually\n",
    "     support, not yet a dataset a retrain should actually be run on.\n",
    sep = ""
  )
}
