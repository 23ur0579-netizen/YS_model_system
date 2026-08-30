#!/usr/bin/env python3
"""
YieldShield — seed realistic test accounts and cropping data.

Creates, for testing only:
  * 4 Admin accounts — one per admin privilege tier (master, verification,
    corn, palay), plus 1 Agricultural Technician and 1 Analyst. Staff
    accounts manage the system — they don't farm — so they get no field
    or cropping data at all, only a home barangay (see below).
  * 24 Farmer accounts — one per barangay, all 24 real ones. Requires
    migration 23_add_missing_barangays.sql to have been run first —
    Poblacion, Santo Niño, and Canarvacanan have no records anywhere in
    the underlying historical municipal dataset (see the BARANGAYS
    comment below), so without that migration etl_load.py never
    creates rows for them and this script has nothing to attach a
    farmer account to for those three.
  * Two registered fields per farmer account — one growing palay, one
    growing corn (a diversified smallholder splitting land between rice
    and corn, common enough in practice) — each placed at that
    barangay's real centroid (computed from the GADM barangay
    boundaries the app already ships in src/imports/
    Binalonan_Pangasinan_Barangays.json), offset slightly from each
    other so the two don't sit exactly on top of one another on the map,
    each with a small square boundary polygon around it. Every barangay
    therefore has real data for *both* crops — a farmer only ever
    growing one or the other left every barangay showing "—" in
    whichever of the Dashboard's Palay/Corn tabs wasn't their crop,
    which looked like a filtering bug but was really just a coverage gap.
  * Three croppings per field — two finished, one still growing:
      - WS 2025: planted Jun/Jul 2025, harvested Oct/Nov 2025, actual
        yield recorded -> a real harvest *history*, not just one
        record, and a second, earlier window to test the Area
        Harvested report against.
      - DS 2025-2026: planted Dec 2025, harvested Apr 2026, actual yield
        recorded -> shows up in the Area Harvested report.
      - WS 2026: planted Jun/Jul 2026, still standing, no yield yet ->
        shows up in the Area Planted report.
  * A short care-task calendar per cropping, correctly flagged
    auto_generated so the app's own edit-triggered recalculation
    (planting date/technique/variety changes) replaces rather than
    duplicates these rows.

Every agronomic value is drawn from the same municipal production dataset
the model was trained on (per-barangay soil type, irrigated/rainfed split,
10-year average palay yield, pH, moisture, rainfall, temperature) rather
than being random, so predictions and reports come out plausible.

Each cropping gets a real predicted-yield figure (yieldshield.
yield_prediction, attributed to the same "Agronomic Heuristic v1"
model the live app's own fallback path uses) computed from the
barangay baseline plus ecosystem/seed-type factors *before* — and
independently of — whether/how the season actually played out.
Harvested croppings' actual yield is then a modest, randomized
departure from that prediction, not a copy of it, so accuracy looks
like a real model's rather than a suspiciously perfect one.

Seed source mix per cropping: ~70% DA-sourced (Hybrid/Tagged CS RCEF/
Tagged CS Commercial, varieties drawn from the real yieldshield.crop_variety
catalog by exact name so they exercise the variety-aware maturity lookup),
~25% Farmer Saved Seeds (drawn from the app's own curated Binalonan-common
list), ~5% the legacy "RS-CS" category kept only for backward compatibility
with old data — those should show up in each barangay's report total but
in none of the four named seed-type columns, exercising that
graceful-degradation path deliberately.

Usage (from the backend/ folder, with your venv active):

    python scripts/05_seed_test_data.py            # create
    python scripts/05_seed_test_data.py --reset    # delete then recreate
    python scripts/05_seed_test_data.py --delete   # delete only

Reads the same .env as the API. Safe to re-run: it only ever touches
accounts whose email ends in @yieldshield.test, so your real data is
never modified.
"""
import argparse
import datetime as dt
import json
import random
import sys
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv
from passlib.context import CryptContext

load_dotenv()

from app.config import settings  # noqa: E402

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Everything the script creates is tagged with this domain so --delete
# can find it again without guessing.
TEST_DOMAIN = "yieldshield.test"
TEST_PASSWORD = "Test1234"

# Bumped whenever this script changes in a way worth being able to
# confirm at a glance — e.g. after "the same problem" keeps happening
# despite a fix that tested correctly in isolation, the first thing
# worth ruling out is whether the file actually being run is the file
# that was actually fixed. `python 05_seed_test_data.py --version`
# prints this and exits immediately, without ever opening a database
# connection (though the script's normal dependencies still need to
# be installed, same as for any other run of it).
SCRIPT_VERSION = "2026-08-30.6 (added a second completed season — WS 2025 — for a real harvest history per crop)"

# Deterministic output, so re-running gives you the same numbers.
RNG = random.Random(20260828)

# ---------------------------------------------------------------------
# Municipal reference data — per-barangay facts from the Municipal
# Agriculture Office production dataset (same source as the frontend's
# data/binalonan.ts and the model's training features).
#   soil            : field-surveyed soil family
#   irrigated/rainfed: hectares under each ecosystem
#   yield           : 10+ year average palay yield, MT/ha
#   ph, moisture    : typical topsoil readings
#   rain, temp      : typical monthly rainfall (mm) and temperature (C)
#   lat, lon        : polygon centroid of the barangay (GADM NAME_3)
#
# All 24 of Binalonan's real barangays. 21 come straight from
# yieldshield.barangay (etl_load.py, sourced from binalonan_crop_data4
# .xlsx's "Central Data" sheet). The other 3 — Poblacion, Santo Niño,
# Canarvacanan — genuinely have no rows anywhere in that historical
# workbook (checked every sheet before concluding that; its own
# References tab says as much directly: "Dominant soil series across
# 21 barangays") and previously weren't seeded at all. Migration
# 23_add_missing_barangays.sql adds them to yieldshield.barangay with
# the best defensible estimate available — REAL land_size_ha computed
# from each one's actual GADM polygon area, soil/terrain/elevation set
# to the municipal mode — clearly marked there (and here) as estimated
# rather than sourced. This script requires that migration to have
# already run; without it these 3 will fail to resolve exactly like
# before. Also fixed here: two names this script had misspelled
# against the real barangay table (Camangaan -> Camanggaan, double g;
# Mangcasuy -> Mangkasuy, k not c) and two using the wrong abbreviation
# (Santa -> Sta., matching how Central Data actually spells them) —
# all four would otherwise have silently failed to resolve as "not
# found in the barangay table" too, same as the three genuinely-missing
# ones, just for a fixable reason instead of a real data gap.
# ---------------------------------------------------------------------
BARANGAYS = {
    "Balangobong":        dict(soil="Silty Clay Loam", irrigated=55.9, rainfed=25.2, yield_=4.8, ph=6.0, moisture=56, rain=122, temp=30, lat=16.025835, lon=120.602008),
    "Bued":               dict(soil="Silty Clay Loam", irrigated=44.7, rainfed=35.8, yield_=4.3, ph=6.2, moisture=59, rain=135, temp=29, lat=16.043820, lon=120.579087),
    "Bugayong":           dict(soil="Sandy Loam / Silty Clay Loam", irrigated=14.7, rainfed=44.5, yield_=4.9, ph=6.3, moisture=61, rain=138, temp=29, lat=16.089443, lon=120.567411),
    # Below, real 24-hectare land parcels but no MAO planting/harvest
    # history: irrigated/rainfed/yield/ph/moisture/rain/temp are the
    # municipal (21-barangay) average, not barangay-specific figures —
    # see the migration this pairs with for the reasoning. Canarvacanan
    # is inserted here alphabetically to match the real list; the other
    # two ("Poblacion", "Santo Niño") keep their natural alphabetical
    # spots further down.
    "Camanggaan":         dict(soil="Sandy Loam", irrigated=11.9, rainfed=74.6, yield_=4.8, ph=6.4, moisture=63, rain=145, temp=29, lat=16.103419, lon=120.587210),
    "Canarvacanan":       dict(soil="Sandy Loam", irrigated=22.3, rainfed=37.7, yield_=4.6, ph=6.2, moisture=60, rain=135, temp=29, lat=16.061367, lon=120.580800),
    "Capas":              dict(soil="Sandy Loam", irrigated=60.3, rainfed=116.1, yield_=5.9, ph=6.0, moisture=56, rain=120, temp=30, lat=16.059952, lon=120.612766),
    "Cili":               dict(soil="Silty Clay Loam", irrigated=25.7, rainfed=81.8, yield_=3.4, ph=6.2, moisture=60, rain=134, temp=29, lat=16.081859, lon=120.589414),
    "Dumayat":            dict(soil="Silty Clay Loam", irrigated=40.8, rainfed=31.2, yield_=3.1, ph=6.1, moisture=58, rain=128, temp=30, lat=16.067704, lon=120.571451),
    "Linmansangan":       dict(soil="Silty Clay Loam", irrigated=49.6, rainfed=123.1, yield_=2.4, ph=6.1, moisture=58, rain=128, temp=30, lat=16.055243, lon=120.572802),
    "Mangkasuy":          dict(soil="Sandy Loam", irrigated=37.9, rainfed=171.9, yield_=4.4, ph=6.0, moisture=57, rain=124, temp=30, lat=16.075700, lon=120.620376),
    "Moreno":             dict(soil="Sandy Loam", irrigated=37.9, rainfed=121.7, yield_=4.7, ph=6.5, moisture=66, rain=150, temp=28, lat=16.110921, lon=120.613537),
    "Pasileng Norte":     dict(soil="Sandy Loam", irrigated=35.1, rainfed=16.6, yield_=5.7, ph=6.4, moisture=64, rain=145, temp=28, lat=16.040868, lon=120.596699),
    "Pasileng Sur":       dict(soil="Sandy Loam", irrigated=68.7, rainfed=31.8, yield_=5.2, ph=6.3, moisture=61, rain=138, temp=29, lat=16.033243, lon=120.600540),
    # Reduced irrigated/rainfed vs. what its land size would otherwise
    # suggest — the town center, more built-up/less farmed than a
    # typical barangay; everything else is still the municipal average.
    "Poblacion":          dict(soil="Sandy Loam", irrigated=9.4, rainfed=15.9, yield_=4.6, ph=6.2, moisture=60, rain=135, temp=29, lat=16.051616, lon=120.588145),
    "San Felipe Central": dict(soil="Sandy Loam", irrigated=56.0, rainfed=45.3, yield_=4.8, ph=6.5, moisture=65, rain=150, temp=28, lat=16.053718, lon=120.625746),
    "San Felipe Sur":     dict(soil="Sandy Loam", irrigated=55.8, rainfed=38.4, yield_=5.0, ph=6.4, moisture=63, rain=144, temp=29, lat=16.049803, lon=120.605752),
    "San Pablo":          dict(soil="Sandy Loam", irrigated=43.1, rainfed=28.7, yield_=5.3, ph=6.3, moisture=62, rain=140, temp=29, lat=16.035730, lon=120.615647),
    "Sta. Catalina":      dict(soil="Fine Sand / Sandy Loam", irrigated=37.2, rainfed=165.1, yield_=4.9, ph=6.3, moisture=62, rain=140, temp=29, lat=16.094470, lon=120.620994),
    "Sta. Maria Norte":   dict(soil="Sandy Loam", irrigated=15.3, rainfed=33.9, yield_=3.9, ph=6.2, moisture=60, rain=136, temp=29, lat=16.070445, lon=120.590291),
    "Santiago":           dict(soil="Silty Clay Loam", irrigated=57.9, rainfed=114.0, yield_=5.4, ph=6.1, moisture=59, rain=130, temp=30, lat=16.045823, lon=120.570171),
    "Santo Niño":         dict(soil="Sandy Loam", irrigated=12.7, rainfed=21.4, yield_=4.6, ph=6.2, moisture=60, rain=135, temp=29, lat=16.062169, lon=120.594977),
    "Sumabnit":           dict(soil="Silty Clay Loam / Fine Sandy Loam", irrigated=65.4, rainfed=102.1, yield_=4.9, ph=6.0, moisture=57, rain=126, temp=30, lat=16.028836, lon=120.573491),
    "Tabuyoc":            dict(soil="Silty Clay Loam", irrigated=64.7, rainfed=43.0, yield_=4.3, ph=6.2, moisture=60, rain=134, temp=29, lat=16.024479, lon=120.585446),
    "Vacante":            dict(soil="Silty Clay Loam", irrigated=23.2, rainfed=81.3, yield_=3.6, ph=6.0, moisture=56, rain=122, temp=30, lat=16.074743, lon=120.568080),
}

# Common Pangasinense surnames + given names, one farmer per barangay.
FARMER_NAMES = [
    "Rodrigo Bautista", "Marilou Ferrer", "Alfredo Quinto", "Teresita Malanum",
    "Benigno Ordonio", "Lourdes Sison", "Ernesto Villamil", "Concepcion Rosario",
    "Danilo Cayabyab", "Perlita Macaraeg", "Wilfredo Tamayo", "Norma Junio",
    "Rolando Basconcillo", "Editha Camacho", "Nestor Pagaduan", "Luzviminda Soriano",
    "Arturo Zarate", "Milagros Calugay", "Federico Manaois", "Erlinda Doria",
    "Salvador Bugarin", "Remedios Aquino", "Ricardo Nagera", "Josefina Palisoc",
]

STAFF = [
    ("Master Admin",        "Admin",                   "master",       "admin.master"),
    ("Verification Admin",  "Admin",                   "verification", "admin.verify"),
    ("Corn Program Admin",  "Admin",                   "corn",         "admin.corn"),
    ("Palay Program Admin", "Admin",                   "palay",        "admin.palay"),
    ("Field Technician",    "Agricultural Technician", None,           "technician"),
    ("Data Analyst",        "Analyst",                 None,           "analyst"),
]

# Real NSIC/PhilRice varieties, grouped by the DA seed-subsidy category
# the reports break figures down by. Names match yieldshield.crop_variety's
# variety_name column *exactly* (bare "Rc222"/"NK6410", no "NSIC " prefix
# baked in — that lives in the separate nsic_code column) so these
# croppings actually resolve through variety_maturity_days() instead of
# silently falling back to the flat 120/90-day default. Category
# assignment (Hybrid vs certified) was checked against the catalog's own
# `category` column, not assumed — e.g. USM Var 10 is genuinely Hybrid
# there, not the certified/OPV variety its name might suggest.
VARIETIES = {
    "Palay (Rice)": {
        "Hybrid":                 ["Mestiso 19", "Mestiso 20", "Mestiso 29", "Mestiso 38"],
        "Tagged CS (RCEF)":       ["Rc222", "Rc216", "Rc402"],
        "Tagged CS (Commercial)": ["Rc216", "Rc218", "Rc160"],
    },
    "Corn": {
        "Hybrid":                 ["NK6410", "Pioneer 30Y87", "Dekalb 8282", "Dekalb 9118", "USM Var 10"],
        "Tagged CS (RCEF)":       ["IPB Var 6", "Tiniguib"],
        "Tagged CS (Commercial)": ["Farco 58", "Tupi WIT"],
    },
}

# Farmer-saved-seed croppings draw from MyFarm.tsx's own curated
# "Binalonan-common" list instead of the DA catalog above — matching
# how the real app's own-seed picker works (see this session's variety
# work: own-seed is deliberately narrowed to this list, not the
# national catalog, since there's no "grown in Binalonan" flag to
# filter the catalog by). These are traditional/heirloom names, not in
# yieldshield.crop_variety at all, so they correctly exercise the flat
# maturity fallback rather than a catalog lookup — that's expected,
# not a gap.
OWN_SEED_VARIETIES = {
    "Palay (Rice)": ["Sinandomeng (Traditional)", "Wagwag (Traditional)", "Dinorado (Traditional)", "Milagrosa (Traditional)"],
    "Corn": ["Baguio White (Traditional)", "Lagkitan (Traditional)"],
}

SEED_TYPES = ["Hybrid", "Tagged CS (RCEF)", "Tagged CS (Commercial)"]
# Fraction of croppings that are farmer-saved seed rather than DA-sourced
# — enough to exercise the "Farmer Saved Seeds" report column and the
# own-seed variety picker, without starving the DA seed-type columns
# the municipal reports break out.
OWN_SEED_SHARE = 0.25
# A few legacy rows deliberately use the retired "RS-CS" category
# (kept in the DB CHECK constraint for old data, no longer offered in
# the UI — see migration 21) so the graceful-degradation path actually
# gets exercised: these should show up in each barangay's grand total
# on the municipal report but in none of the four named seed-type
# columns, and the cropping form's edit view should show "DA source,
# no type selected" rather than crashing.
LEGACY_RS_CS_SHARE = 0.05


def connect():
    conn = psycopg2.connect(
        host=settings.PGHOST, port=settings.PGPORT, dbname=settings.PGDATABASE,
        user=settings.PGUSER, password=settings.PGPASSWORD,
        sslmode=settings.PGSSLMODE, sslrootcert=settings.PGSSLROOTCERT,
        connect_timeout=10, cursor_factory=psycopg2.extras.RealDictCursor,
        options="-c search_path=yieldshield,public",
    )
    conn.autocommit = False
    return conn


def open_rls(cur):
    """farm_profile / farm_input_log / crop_task use FORCE ROW LEVEL
    SECURITY, which applies to the table owner too. The policies let
    staff roles through, so announce ourselves as Admin for this
    transaction — the same thing the API does per request."""
    cur.execute("SET LOCAL app.role = 'Admin'")
    cur.execute("SET LOCAL app.current_user_id = '0'")


def square_boundary(lat, lon, area_ha):
    """A square of roughly `area_ha` centred on the point, as the
    [[lat, lon], ...] ring the field map expects."""
    side_m = (area_ha * 10_000) ** 0.5
    dlat = (side_m / 2) / 111_320
    dlon = (side_m / 2) / (111_320 * 0.96)  # cos(16 deg N)
    return [
        [round(lat - dlat, 6), round(lon - dlon, 6)],
        [round(lat - dlat, 6), round(lon + dlon, 6)],
        [round(lat + dlat, 6), round(lon + dlon, 6)],
        [round(lat + dlat, 6), round(lon - dlon, 6)],
    ]


def crop_type_id(cur, crop_name):
    cur.execute(
        "SELECT crop_type_id FROM yieldshield.crop_type WHERE crop_name = %s "
        "ORDER BY crop_type_id LIMIT 1",
        (crop_name,),
    )
    row = cur.fetchone()
    if row is None:
        sys.exit(
            f"No '{crop_name}' row in yieldshield.crop_type. Run etl_load.py first "
            "so the reference tables are populated."
        )
    return row["crop_type_id"]


# Same model row (and same name) the real app's PATCH/POST handlers
# resolve/create via _get_or_create_heuristic_model_id() in
# backend/app/routers/farm_input.py — reusing it here (rather than
# inventing a separate "Test Data Seeder" model) keeps every
# prediction, seeded or real, attributed to a model that already
# means something elsewhere in the app (Model Info, audit trails).
_HEURISTIC_MODEL_NAME = "Agronomic Heuristic v1 (client-side)"


def heuristic_model_id(cur):
    cur.execute(
        "SELECT model_id FROM yieldshield.predictive_model WHERE model_name = %s",
        (_HEURISTIC_MODEL_NAME,),
    )
    row = cur.fetchone()
    if row:
        return row["model_id"]
    cur.execute(
        """
        INSERT INTO yieldshield.predictive_model (model_name, algorithm, is_active)
        VALUES (%s, %s, TRUE)
        RETURNING model_id
        """,
        (_HEURISTIC_MODEL_NAME, "Deterministic agronomic scoring (soil, climate, timing)"),
    )
    return cur.fetchone()["model_id"]


def technique_id(cur, barangay_id, ct_id):
    cur.execute(
        "SELECT technique_id FROM yieldshield.planting_technique "
        "WHERE barangay_id = %s AND crop_type_id = %s ORDER BY technique_id LIMIT 1",
        (barangay_id, ct_id),
    )
    row = cur.fetchone()
    return row["technique_id"] if row else None


def load_barangays(cur):
    """Map the barangay names in this script to the rows actually in the
    database, tolerating spacing/casing differences from the ETL."""
    cur.execute("SELECT barangay_id, barangay_name FROM yieldshield.barangay")
    db = {r["barangay_name"]: r["barangay_id"] for r in cur.fetchall()}
    if not db:
        sys.exit("yieldshield.barangay is empty. Run etl_load.py first.")

    def norm(s):
        # NFC first: "ñ" can arrive as either one composed codepoint or
        # "n" + a separate combining-tilde mark — visually identical,
        # byte-for-byte different. isalnum() below treats a bare
        # combining mark as *not* alphanumeric and silently drops it,
        # so without this, decomposed "Niño" collapses to "Nino" while
        # composed "Niño" keeps its ñ — the two forms then compare
        # unequal even though they're the same word. Normalizing first
        # makes the match robust regardless of which form either side
        # (this script's own source, or whatever a migration/editor/
        # terminal happened to write to the database) is actually in.
        s = unicodedata.normalize("NFC", s)
        return "".join(ch for ch in s.lower() if ch.isalnum())

    by_norm = {norm(k): (k, v) for k, v in db.items()}

    # Belt-and-suspenders fallback: fold to a plain-ASCII skeleton
    # (NFD-decompose, then drop every combining mark) as a *second*,
    # more aggressive comparison if the NFC-based one above still
    # doesn't hit. NFC-normalizing handles "composed vs. decomposed ñ"
    # specifically; this instead throws away *any* diacritic
    # entirely, which also catches e.g. a stray extra combining mark
    # or a form neither NFC nor NFD represents cleanly.
    def fold(s):
        s = unicodedata.normalize("NFD", s)
        return "".join(ch for ch in s.lower() if ch.isalnum() and not unicodedata.combining(ch))

    by_fold = {fold(k): (k, v) for k, v in db.items()}

    # Third fallback: mojibake. Neither of the above helps if "ñ" was
    # never a Unicode representation issue to begin with, but a genuine
    # encoding bug — UTF-8 bytes decoded as Latin-1 somewhere upstream
    # (a terminal, an editor, or a psql/DB driver's client_encoding not
    # actually matching what got sent) turns "ñ" (2 UTF-8 bytes) into
    # two separate *valid* Latin-1 characters ("Ã" + "±"), which is a
    # different string outright, not just a different normalized form
    # of the same one — no amount of NFC/NFD normalizing fixes that.
    # Re-encoding as Latin-1 and decoding as UTF-8 undoes exactly this
    # one-hop corruption; wrapped in a try/except since it raises
    # cleanly (and is left alone) on a string that was never corrupted
    # this way to begin with.
    def unmojibake(s):
        try:
            return s.encode("latin-1").decode("utf-8")
        except (UnicodeDecodeError, UnicodeEncodeError):
            return s

    by_unmojibake = {norm(unmojibake(k)): (k, v) for k, v in db.items()}

    resolved, missing = {}, []
    for name in BARANGAYS:
        hit = (
            by_norm.get(norm(name))
            or by_fold.get(fold(name))
            or by_unmojibake.get(norm(name))
            or by_norm.get(norm(unmojibake(name)))
        )
        if hit:
            resolved[name] = hit[1]
        else:
            missing.append(name)
    if missing:
        print(f"  ! not found in the barangay table, skipping: {', '.join(missing)}")
        # Byte-level proof instead of another guess: for each still-
        # unresolved name, show exactly what this script expects versus
        # every db row whose folded form is even close, so this can be
        # diagnosed for real instead of guessed at yet again.
        for name in missing:
            print(f"    {name!r} expected codepoints: {[hex(ord(c)) for c in name]}")
            close = [k for k in db if fold(k)[:4] == fold(name)[:4]]
            if close:
                for k in close:
                    print(f"      closest db row {k!r}: {[hex(ord(c)) for c in k]}")
            else:
                print(f"      no db row's folded form even starts the same way — "
                      f"check that migrations 23 and 24 actually ran against this database.")
    return resolved


def make_user(cur, full_name, role, admin_role, username, barangay_id=None):
    cur.execute(
        """
        INSERT INTO yieldshield.user_account
            (full_name, role, username, email, password_hash, contact_info,
             admin_role, barangay_id, is_active)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, TRUE)
        RETURNING user_id
        """,
        (full_name, role, username, f"{username}@{TEST_DOMAIN}",
         pwd_context.hash(TEST_PASSWORD), "+63 917 000 0000",
         admin_role, barangay_id),
    )
    return cur.fetchone()["user_id"]


def make_field(cur, user_id, barangay_id, barangay, facts, area_ha, crop, lat, lon):
    cur.execute(
        """
        INSERT INTO yieldshield.field
            (user_id, barangay_id, name, location, area_ha, notes,
             latitude, longitude, boundary)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING field_id
        """,
        (user_id, barangay_id, f"{barangay} {'Cornfield' if crop == 'Corn' else 'Ricefield'}",
         f"{barangay}, Binalonan, Pangasinan", area_ha,
         f"{facts['soil']}; typical topsoil pH {facts['ph']}.",
         lat, lon,
         json.dumps(square_boundary(lat, lon, area_ha))),
    )
    return cur.fetchone()["field_id"]


def make_cropping(cur, user_id, field_id, barangay_id, ct_id, tech_id,
                  crop, facts, area_ha, plot_code, planting_date,
                  ecosystem, seed_type, variety, model_id, predicted_yield,
                  confidence, actual_yield, harvest_date):
    """One farm_profile (the plot) plus its farm_input_log (the cropping)."""
    cur.execute(
        """
        INSERT INTO yieldshield.farm_profile
            (user_id, barangay_id, crop_type_id, land_area_ha, soil_condition,
             plot_code, field_id, filed_by_user_id)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING farm_id
        """,
        (user_id, barangay_id, ct_id, area_ha, facts["soil"],
         plot_code, field_id, user_id),
    )
    farm_id = cur.fetchone()["farm_id"]

    # Technique names must be ones the app itself actually offers for
    # this crop (see data/binalonan.ts's TECHNIQUES registry) — corn's
    # options are Hill Planting/Row Planting/Strip Cropping/Contour
    # Farming, never "Direct Seeding" or "Transplanting", which are
    # palay-only. Using an invented name here would leave every
    # technique card unselected when someone opens the cropping for
    # editing, with no way to tell what was actually recorded.
    is_wet = planting_date.month in (6, 7, 8, 9, 10)
    if crop == "Palay (Rice)":
        transplanted = seed_type != "Hybrid"
        if transplanted:
            technique = "Transplanting (Pindot)"
        else:
            technique = "Wet Direct Seeding (Sabog-Tanim)" if is_wet else "Dry Direct Seeding (Sabog-Tanim)"
        seed_rate = 18.0 if seed_type == "Hybrid" else (45.0 if transplanted else 95.0)
        spacing = 20.0
        density = 250_000
        per_hill = 2
    else:
        technique = "Hill Planting"
        seed_rate = 20.0
        spacing = 25.0
        density = 55_000
        per_hill = 1

    # Wet-season plantings sit through the monsoon, so log the higher
    # rainfall figure for those months.
    rainfall = round(facts["rain"] * (1.45 if is_wet else 0.55), 1)
    temperature = facts["temp"] - (1.0 if is_wet else 0.0)

    cur.execute(
        """
        INSERT INTO yieldshield.farm_input_log
            (farm_id, technique_id, seeding_rate_kg_ha, plant_density_hills_per_ha,
             seedlings_per_hill, land_area_ha, rainfall_input, temperature_input,
             planting_date, ph, soil_moisture_pct, quantity, quantity_unit, notes,
             variety, technique_name, spacing_cm, seed_rate, ecosystem, seed_type,
             actual_yield_mt_ha, harvest_date, harvest_notes)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING input_log_id
        """,
        (farm_id, tech_id, seed_rate, density, per_hill, area_ha,
         rainfall, temperature, planting_date, facts["ph"], facts["moisture"],
         round(seed_rate * area_ha, 2), "kg",
         f"Seeded test cropping — {ecosystem.lower()}, {seed_type}.",
         variety, technique, spacing, seed_rate, ecosystem, seed_type,
         actual_yield, harvest_date,
         "Harvested and threshed on schedule." if actual_yield else None),
    )
    input_log_id = cur.fetchone()["input_log_id"]

    # Without this, predicted_yield_mt_ha comes back NULL for every
    # seeded cropping (farms.py sources it from the *latest*
    # yield_prediction row, not from farm_input_log at all) and every
    # dashboard card, report figure, and heatmap cell that averages
    # predicted yield reads as zero — indistinguishable from "too low"
    # at a glance, but actually just missing.
    cur.execute(
        """
        INSERT INTO yieldshield.yield_prediction
            (input_log_id, model_id, predicted_yield_mt_ha, predicted_production_mt, confidence_pct)
        VALUES (%s, %s, %s, %s, %s)
        """,
        (input_log_id, model_id, predicted_yield, round(predicted_yield * area_ha, 2), confidence),
    )

    # Real per-variety maturity when this variety is in the catalog
    # (exact name match against yieldshield.crop_variety — see
    # backend/app/routers/farm_input.py's variety_maturity_days), same
    # flat crop-level fallback the app itself uses otherwise. Own-seed/
    # traditional varieties always fall back, same as the real app.
    cur.execute(
        "SELECT maturity_days FROM yieldshield.crop_variety WHERE crop_type_id = %s AND variety_name = %s",
        (ct_id, variety),
    )
    catalog_row = cur.fetchone()
    maturity = catalog_row["maturity_days"] if catalog_row and catalog_row["maturity_days"] else (120 if crop == "Palay (Rice)" else 90)

    tasks = [
        (-14, "pre_planting", "Prepare seedbed and soak seeds"),
        (-3,  "pre_planting", "Final harrowing and levelling"),
        (7,   "water",        "Maintain 2-3 cm standing water"),
        (14,  "fertilizer",   "Basal fertilizer application"),
        (30,  "fertilizer",   "Top-dress with urea at tillering"),
        (45,  "water",        "Check irrigation before panicle initiation"),
        (maturity - 14, "other", "Drain the field ahead of harvest"),
        (maturity, "other",   "Harvest and thresh"),
    ]
    if crop != "Palay (Rice)" or technique != "Transplanting (Pindot)":
        tasks = [t for t in tasks if t[2] != "Prepare seedbed and soak seeds"]
    today = dt.date.today()
    for offset, task_type, text in tasks:
        due = planting_date + dt.timedelta(days=offset)
        cur.execute(
            """
            INSERT INTO yieldshield.crop_task
                (user_id, input_log_id, task_type, text, due_date, done, auto_generated)
            VALUES (%s, %s, %s, %s, %s, %s, TRUE)
            """,
            (user_id, input_log_id, task_type, text, due, due < today),
        )
    return input_log_id


def pick_ecosystem(facts):
    """Irrigated vs rainfed in proportion to the barangay's actual
    irrigated/rainfed hectarage."""
    total = facts["irrigated"] + facts["rainfed"]
    return "Irrigated" if RNG.random() < (facts["irrigated"] / total) else "Rainfed"


def delete_seed(cur):
    cur.execute(
        "SELECT user_id FROM yieldshield.user_account WHERE email LIKE %s",
        (f"%@{TEST_DOMAIN}",),
    )
    ids = [r["user_id"] for r in cur.fetchall()]
    if not ids:
        print("  nothing to delete")
        return 0
    # farm_profile / field / crop_task all cascade from user_account,
    # and farm_input_log cascades from farm_profile.
    cur.execute("DELETE FROM yieldshield.user_account WHERE user_id = ANY(%s)", (ids,))
    print(f"  removed {len(ids)} test accounts and everything under them")
    return len(ids)


def seed(cur):
    barangay_ids = load_barangays(cur)
    palay_id = crop_type_id(cur, "Palay")
    corn_id = crop_type_id(cur, "Corn")
    model_id = heuristic_model_id(cur)

    # Three seasons per field: two finished (harvested, real yield ->
    # Area Harvested report) and one still standing (-> Area Planted
    # report). Two "done" seasons instead of one gives every farmer an
    # actual harvest *history* to look back over — one data point isn't
    # much of a trend line, and "Harvest records" as a feature reads
    # oddly with only ever one record per crop to ever show.
    ws25_window = (dt.date(2025, 6, 10), dt.date(2025, 7, 20))
    ds_window = (dt.date(2025, 12, 1), dt.date(2026, 1, 15))
    ws_window = (dt.date(2026, 6, 10), dt.date(2026, 7, 20))

    def rand_date(window):
        lo, hi = window
        return lo + dt.timedelta(days=RNG.randrange((hi - lo).days + 1))

    names = list(barangay_ids)
    accounts = []

    # --- staff accounts -----------------------------------------------
    # Admins, coordinators, technicians, and analysts manage the system
    # — they don't farm themselves, so unlike a farmer account they get
    # no field/cropping data at all. barangay_id here is just where the
    # staff member is based/lives (a real attribute of the person),
    # completely separate from owning a plot there.
    for i, (full_name, role, admin_role, username) in enumerate(STAFF):
        barangay = names[i % len(names)]
        bid = barangay_ids[barangay]
        make_user(cur, full_name, role, admin_role, username, bid)
        accounts.append((username, role, admin_role or "-", barangay, "-"))

    # --- one farmer per barangay --------------------------------------
    for i, barangay in enumerate(names):
        bid = barangay_ids[barangay]
        full_name = FARMER_NAMES[i % len(FARMER_NAMES)]
        username = "farmer." + "".join(
            ch for ch in barangay.lower() if ch.isalnum()
        )
        uid = make_user(cur, full_name, "Farmer", None, username, bid)
        # Every farmer gets both crops (see build_plots) — a diversified
        # smallholder splitting land between rice and corn, common
        # enough in practice, and it's what actually gives every
        # barangay real data in both the Dashboard's Palay and Corn
        # tabs instead of a strict either/or split between barangays.
        accounts.append((username, "Farmer", "-", barangay, "Palay + Corn"))
        build_plots(cur, uid, barangay, bid, palay_id, corn_id, model_id,
                    ws25_window, ds_window, ws_window, rand_date)

    return accounts


def build_plots(cur, uid, barangay, bid, palay_id, corn_id, model_id,
                ws25_window, ds_window, ws_window, rand_date):
    """Two fields per farmer — one growing palay, one growing corn, each
    with its own two croppings (last dry season + this wet season).

    Every barangay has exactly one farmer account, so giving each farmer
    only one crop (as this used to) meant every barangay only ever had
    *one* crop's worth of data at all — correct data for that crop, but
    a genuine gap for the other one, not a display bug. Switching the
    Dashboard's crop tab to "Palay" or "Corn" then correctly showed
    "—" for whichever barangays happened to be the other crop, since
    there was really nothing there to show. Giving every farmer both
    crops (realistic for Philippine smallholders, who commonly rotate
    or split their land between rice and corn) means every barangay has
    real data in both views instead of a strict, mutually-exclusive
    partition between them."""
    facts = BARANGAYS[barangay]
    for crop, lat_offset, lon_offset in (
        ("Palay (Rice)", 0.0, 0.0),
        # A small (~150-250m) offset so the two fields don't sit exactly
        # on top of each other on the map — two distinct plots, not one
        # doubled-up pin.
        ("Corn", 0.0018, -0.0015),
    ):
        build_field_for_crop(
            cur, uid, barangay, bid, palay_id, corn_id, model_id,
            ws25_window, ds_window, ws_window, rand_date, crop,
            facts["lat"] + lat_offset, facts["lon"] + lon_offset,
        )


def build_field_for_crop(cur, uid, barangay, bid, palay_id, corn_id, model_id,
                         ws25_window, ds_window, ws_window, rand_date, crop, lat, lon):
    """One field (of the given crop), two croppings (last dry season +
    this wet season)."""
    facts = BARANGAYS[barangay]
    # Binalonan smallholdings: mostly half a hectare to three hectares.
    field_area = round(RNG.uniform(0.75, 3.0), 2)
    field_id = make_field(cur, uid, bid, barangay, facts, field_area, crop, lat, lon)

    ct_id = corn_id if crop == "Corn" else palay_id
    tech_id = technique_id(cur, bid, ct_id)

    # Yield tracks the barangay's own 10-year average, nudged a little.
    # This is a *real* municipal average (2.4-5.9 t/ha across barangays,
    # per BARANGAYS above) — a "too low" complaint after seeding usually
    # means predicted_yield_mt_ha is missing entirely (see below), not
    # that this baseline itself needs inflating.
    base = facts["yield_"] if crop == "Palay (Rice)" else facts["yield_"] * 0.85

    for season, window, harvested in (
        ("WS25", ws25_window, True),
        ("DS2526", ds_window, True),
        ("WS26", ws_window, False),
    ):
        planting = rand_date(window)
        ecosystem = pick_ecosystem(facts)
        seed_type = pick_seed_type()
        variety = pick_variety(crop, seed_type)
        area = round(field_area * RNG.uniform(0.7, 1.0), 2)

        # Predicted yield — what a model would have projected at planting
        # time from the barangay baseline plus ecosystem/seed-type
        # factors, the same factors farm_input.py's real scoring path
        # weighs. Computed *before*, and independently of, the actual
        # outcome below — a real prediction can't see the future, and a
        # seed script that quietly derived "predicted" from "actual"
        # would make every prediction look implausibly perfect.
        # Previously this was never written at all: nothing in this
        # script inserted a yield_prediction row, so every seeded
        # cropping's predicted_yield_mt_ha came back NULL -> the
        # frontend defaults that to 0 -> every dashboard card, report
        # figure, and heatmap cell that averages predicted yield looked
        # "too low" (actually just zero) no matter how realistic the
        # underlying barangay data was.
        pred_factor = 1.0
        pred_factor *= 1.08 if ecosystem == "Irrigated" else 0.88
        pred_factor *= 1.15 if seed_type == "Hybrid" else 1.0
        predicted_yield = round(max(1.5, base * pred_factor * RNG.uniform(0.95, 1.05)), 3)
        # Irrigated barangays have more consistent water control, so a
        # model can reasonably be more confident about them.
        confidence = RNG.randint(74, 92) if ecosystem == "Irrigated" else RNG.randint(58, 80)

        actual_yield = harvest_date = None
        if harvested:
            # The real outcome diverges from the prediction by a modest,
            # realistic margin (weather/pest variance no model fully
            # captures) rather than reusing the same random draw, which
            # would make prediction accuracy look artificially perfect.
            actual_yield = round(max(1.2, predicted_yield * RNG.uniform(0.85, 1.15)), 3)
            harvest_date = planting + dt.timedelta(
                days=(120 if crop == "Palay (Rice)" else 90)
            )

        # Crop-initial in the plot code (P/C) — this farmer now has two
        # fields for the same barangay/season, so the old code (barangay
        # + season + user id alone) would collide between them.
        make_cropping(
            cur, uid, field_id, bid, ct_id, tech_id, crop, facts, area,
            f"{barangay[:3].upper()}-{crop[0]}-{season}-{uid}", planting,
            ecosystem, seed_type, variety, model_id, predicted_yield,
            confidence, actual_yield, harvest_date,
        )


def pick_seed_type():
    """Farmer-saved seed, a small legacy-RS-CS slice, or one of the
    three DA categories the app's seed-source picker actually offers
    today — see the OWN_SEED_SHARE/LEGACY_RS_CS_SHARE comments above."""
    r = RNG.random()
    if r < OWN_SEED_SHARE:
        return "Farmer Saved Seeds"
    if r < OWN_SEED_SHARE + LEGACY_RS_CS_SHARE:
        return "RS-CS"
    return RNG.choice(SEED_TYPES)


def pick_variety(crop, seed_type):
    if seed_type == "Farmer Saved Seeds":
        return RNG.choice(OWN_SEED_VARIETIES[crop])
    if seed_type == "RS-CS":
        # Legacy category — the app itself never assigns a variety
        # list to it any more (see MyFarm.tsx's dropdown, which no
        # longer offers RS-CS at all), so just draw from whichever DA
        # category is closest for a plausible-looking historical row.
        return RNG.choice(VARIETIES[crop]["Tagged CS (Commercial)"])
    return RNG.choice(VARIETIES[crop][seed_type])


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--reset", action="store_true", help="delete existing test data first")
    ap.add_argument("--delete", action="store_true", help="delete test data and exit")
    ap.add_argument("--version", action="store_true", help="print the script version and exit (no database needed)")
    args = ap.parse_args()

    if args.version:
        print(SCRIPT_VERSION)
        return
    print(f"YieldShield test data seeder — {SCRIPT_VERSION}")

    conn = connect()
    try:
        with conn:
            with conn.cursor() as cur:
                open_rls(cur)

                if args.delete or args.reset:
                    print("Removing existing test data...")
                    delete_seed(cur)
                if args.delete:
                    print("Done.")
                    return

                cur.execute(
                    "SELECT COUNT(*) AS n FROM yieldshield.user_account WHERE email LIKE %s",
                    (f"%@{TEST_DOMAIN}",),
                )
                if cur.fetchone()["n"]:
                    sys.exit(
                        "Test accounts already exist. Re-run with --reset to rebuild them, "
                        "or --delete to remove them."
                    )

                print("Seeding test data...")
                accounts = seed(cur)
    finally:
        conn.close()

    print(f"\nCreated {len(accounts)} accounts. Password for all of them: {TEST_PASSWORD}\n")
    print(f"  {'sign in with':<34} {'role':<26} {'privilege':<13} {'barangay':<20} fields")
    print("  " + "-" * 100)
    for username, role, admin_role, barangay, crop in accounts:
        print(f"  {username + '@' + TEST_DOMAIN:<34} {role:<26} {admin_role:<13} {barangay:<20} {crop}")
    print(
        "\nEach Farmer account has two registered fields — one palay, one corn —\n"
        "each with three croppings:\n"
        "  - WS 2025      (planted Jun/Jul 2025, harvested, yield recorded)\n"
        "  - DS 2025-2026 (planted Dec 2025, harvested, yield recorded)\n"
        "  - WS 2026      (planted Jun/Jul 2026, still standing)\n"
        "So every farmer has an actual harvest history (two completed seasons,\n"
        "not just one) for both crops, and every barangay has real data in\n"
        "both the Dashboard's Palay and Corn tabs, not just one or the other.\n"
        "Staff accounts (Admin/Technician/Analyst) have none — they manage the\n"
        "system, they don't farm, so My Farm/Calendar should show correctly\n"
        "empty for every one of them.\n\n"
        "This requires migration 23_add_missing_barangays.sql to have already\n"
        "run — without it, Poblacion/Santo Niño/Canarvacanan will fail to\n"
        "resolve and get skipped with the same 'not found in the barangay\n"
        "table' warning as before, same as any barangay genuinely missing\n"
        "from yieldshield.barangay.\n\n"
        "To check the municipal reports, sign in as admin.master, open Farms ->\n"
        "Municipal reports, and use a planting window of 2025-12-01 to 2026-01-15\n"
        "or 2025-06-01 to 2025-08-15 for Area Harvested (two separate completed\n"
        "seasons to test against), or 2026-06-01 to 2026-07-31 for Area Planted.\n"
        "Try the Irrigated / Rainfed / Overall toggle on each — the mix of\n"
        "ecosystems is weighted per barangay's real irrigated/rainfed split, so\n"
        "all three should show meaningfully different (non-empty) figures.\n\n"
        "Other things this data is specifically built to exercise:\n"
        "  - Seed source on an existing cropping's Edit view: most are DA-sourced\n"
        "    (Hybrid/Tagged CS RCEF/Tagged CS Commercial, varieties drawn from the\n"
        "    real NSIC/PhilRice catalog), ~25% are Farmer Saved Seeds (drawn from\n"
        "    the curated Binalonan-common list), and a few percent are the legacy\n"
        "    'RS-CS' category — those should show as 'DA source, no type selected'\n"
        "    on Edit and count toward each barangay's report total but not any of\n"
        "    the four named seed-type columns.\n"
        "  - Editing a cropping's planting date, technique, or variety should\n"
        "    recalculate its care schedule (check Calendar/'What to do this week'\n"
        "    before and after) rather than leaving stale due dates or duplicating\n"
        "    tasks.\n"
        "  - admin.corn / admin.palay should each only be able to manage seed\n"
        "    distribution and file/edit croppings for their own crop.\n"
        "  - Every cropping now carries a real predicted_yield_mt_ha (previously\n"
        "    missing entirely, which read as \"yield too low\" — really just zero)\n"
        "    — Dashboard's 'Avg predicted yield' and the heatmap should show a\n"
        "    realistic 3-6 t/ha range that varies by barangay, not a flat 0.0.\n"
    )


if __name__ == "__main__":
    main()