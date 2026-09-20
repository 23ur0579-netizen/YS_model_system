"""
"Which variety is actually doing best near you" advisory — mined from
real, farmer-reported actual_yield_mt_ha (farm_input_log), not the
static NSIC/PhilRice catalog (crop_variety) or the client-side scoring
heuristic (store.tsx's score()). CropRecommendation.tsx already covers
generic soil/season suitability; this is the complement: "of the
varieties real farmers near you have actually harvested, which one
came out ahead" — only shown when there's enough real data to say that
with a straight face.

Unlike season_advisory.py / price_advisory.py, this needs the
database — it aggregates ACROSS every farmer's harvested croppings in
one barangay, not just the requesting farmer's own rows, which a
farmer's own RLS-scoped connection can't see (by design — a farmer
can't read another farmer's individual records). The aggregate itself
carries no privacy risk (crop + variety + average yield + a sample
count, never a name or a specific farm), so best_variety_for_barangay()
below is meant to be called on a connection opened with role="Admin"
specifically to run this one read — see notifications.py's
_variety_advisory() for exactly how that's scoped.

Cached per barangay for a few hours — this changes about as often as
new harvests get logged (not per-request), and it's one more query
notifications.py would otherwise run on every single farmer's every
page load.
"""
import datetime as dt
import threading

from .advisory_types import AdvisoryText

_MIN_SAMPLE_SIZE = 3  # Below this, one unusually good/bad harvest could flip the "best" pick.
_CACHE_TTL = dt.timedelta(hours=6)
_cache_lock = threading.Lock()
_cache: dict[int, tuple[dt.datetime, AdvisoryText | None]] = {}


def best_variety_for_barangay(cur, barangay_id: int) -> AdvisoryText | None:
    """Names the best-performing variety per crop type in this
    barangay, from real harvested yields across all farmers there — or
    None if there isn't enough recorded data yet to say anything
    meaningful. Cached per barangay — see module docstring."""
    with _cache_lock:
        cached = _cache.get(barangay_id)
        if cached is not None and dt.datetime.now(dt.timezone.utc) - cached[0] < _CACHE_TTL:
            return cached[1]

    result = _query_best_variety(cur, barangay_id)
    with _cache_lock:
        _cache[barangay_id] = (dt.datetime.now(dt.timezone.utc), result)
    return result


def _query_best_variety(cur, barangay_id: int) -> AdvisoryText | None:
    cur.execute(
        """
        SELECT ct.crop_name, fil.variety,
               AVG(fil.actual_yield_mt_ha) AS avg_yield,
               COUNT(*) AS sample_size
          FROM yieldshield.farm_input_log fil
          JOIN yieldshield.farm_profile fp ON fp.farm_id = fil.farm_id
          JOIN yieldshield.crop_type ct ON ct.crop_type_id = fp.crop_type_id
         WHERE fp.barangay_id = %s
           AND fil.actual_yield_mt_ha IS NOT NULL
           AND fil.variety IS NOT NULL AND fil.variety <> ''
         GROUP BY ct.crop_name, fil.variety
        HAVING COUNT(*) >= %s
         ORDER BY ct.crop_name, avg_yield DESC
        """,
        (barangay_id, _MIN_SAMPLE_SIZE),
    )
    rows = cur.fetchall()
    if not rows:
        return None

    # rows is already ordered best-first within each crop_name group —
    # keep just the first (best) row we see per crop.
    best_per_crop: dict[str, dict] = {}
    for row in rows:
        best_per_crop.setdefault(row["crop_name"], row)
    if not best_per_crop:
        return None

    # Separate title/body variants per which crop(s) actually have
    # enough data, rather than one template — the flat {placeholder}
    # substitution i18n.tsx uses can't itself omit a clause when one
    # crop has nothing to report. Variety names are proper nouns
    # (catalog/farmer-entered strings, e.g. "NSIC Rc 216") — passed
    # through as-is, same as everywhere else in the app that shows a
    # variety name regardless of interface language.
    has_palay, has_corn = "Palay (Rice)" in best_per_crop, "Corn" in best_per_crop
    variant = "both" if has_palay and has_corn else ("palayOnly" if has_palay else "cornOnly")
    parts_en = []
    params: dict = {}
    if has_palay:
        r = best_per_crop["Palay (Rice)"]
        params.update(palayVariety=r["variety"], palayYield=round(float(r["avg_yield"]), 2), palaySamples=r["sample_size"])
        parts_en.append(f"Palay (Rice): {r['variety']} (avg {float(r['avg_yield']):.2f} t/ha across {r['sample_size']} harvests)")
    if has_corn:
        r = best_per_crop["Corn"]
        params.update(cornVariety=r["variety"], cornYield=round(float(r["avg_yield"]), 2), cornSamples=r["sample_size"])
        parts_en.append(f"Corn: {r['variety']} (avg {float(r['avg_yield']):.2f} t/ha across {r['sample_size']} harvests)")

    return AdvisoryText(
        title_key="notif.variety.title",
        body_key=f"notif.variety.{variant}Body",
        title_en="Top-performing variety near you",
        body_en=(
            "Based on actual harvests reported in your barangay — " + "; ".join(parts_en) + ". "
            "Individual results still depend on your own field, technique, and this season's weather."
        ),
        params=params,
    )


def farmer_primary_barangay(cur, user_id: int) -> tuple[int, str] | None:
    """The barangay this farmer's own croppings are mostly filed
    under — run on the farmer's OWN RLS-scoped connection (this reads
    only their own farm_profile rows, no elevated access needed)."""
    cur.execute(
        """
        SELECT fp.barangay_id, b.barangay_name, COUNT(*) AS cnt
          FROM yieldshield.farm_profile fp
          JOIN yieldshield.barangay b ON b.barangay_id = fp.barangay_id
         WHERE fp.user_id = %s
         GROUP BY fp.barangay_id, b.barangay_name
         ORDER BY cnt DESC
         LIMIT 1
        """,
        (user_id,),
    )
    row = cur.fetchone()
    return (row["barangay_id"], row["barangay_name"]) if row else None
