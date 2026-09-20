"""
Live Palay/Corn farmgate price advisory — Philippine Statistics
Authority (PSA) OpenSTAT, "Cereals: Farmgate Prices by Geolocation,
Commodity, Year and Period" (table 0032M4AFN01, under DB/2M/NFG),
scoped to Pangasinan (Geolocation code confirmed: 015500000 — Binalonan
is a Pangasinan municipality, and OpenSTAT doesn't publish below the
province level for this table).

Dimension codes below were confirmed directly against the table's own
selector (screenshots of the actual checked/unchecked items), not
guessed — all use PXWeb's "item" filter (explicit value list), which
is the only filter type actually observed working against this table:
  - Commodity: 0-indexed in on-screen order — 0=Palay Fancy,
    1=Palay Other Variety, 2=Corngrain White (matured),
    3=Corngrain Yellow (matured), 4=Green Corn White, 5=Green Corn
    Yellow. We query 0-3 (dry/matured grain, the standard farmgate
    price basis) and skip 4-5 (fresh green corn is a different, minor
    market not relevant to a grain-price advisory).
  - Year: 0-indexed starting at 2010 (confirmed 16 == 2026), so
    year - 2010 gives any other year's code — see _year_code() below,
    computed from today's date rather than hardcoded so this never
    needs updating.
  - Period: 0-indexed calendar months, January=0 .. December=11
    (confirmed against the selector); "Annual" is a separate 13th
    value we deliberately never request.

The query asks for the last two years' worth of months (not just the
current year) rather than one specific hardcoded month — farmgate
prices publish monthly with roughly a 1-2 month lag (per the table's
own metadata: e.g. "August 2026 for Palay - Preliminary" seen while
this was being wired up), and a hardcoded single period would silently
go stale the moment that lag shifts, or return nothing at all in
January/February before the new year has any data yet.
_latest_valid_period() below picks whichever (year, month) in that
window actually has real published numbers once the response comes
back, so this stays self-updating without ever needing another code
change here.

Cached in-process (not per-request) — PSA data changes at most monthly
and OpenSTAT rate-limits to 10 requests/10 seconds, so re-fetching on
every /notifications call from every farmer would be both wasteful and
a real risk of tripping that limit under normal traffic.
"""
import csv
import datetime as dt
import io
import logging
import threading

import httpx

from .advisory_types import AdvisoryText

logger = logging.getLogger("yieldshield.price_advisory")

_API_URL = "https://openstat.psa.gov.ph:443/PXWeb/api/v1/en/DB/2M/NFG/0032M4AFN01.px"
_GEO_PANGASINAN = "015500000"
_COMMODITY_CODES = ["0", "1", "2", "3"]  # both Palay varieties + both matured Corngrain varieties
_YEAR_BASE = 2010  # Year code 0 == 2010, confirmed via code 16 == 2026
_PERIOD_CODES = [str(i) for i in range(12)]  # January(0)..December(11) — every real month, never "Annual"


def _year_code(year: int) -> str:
    return str(year - _YEAR_BASE)


def _build_query() -> dict:
    this_year = dt.date.today().year
    return {
        "query": [
            {"code": "Geolocation", "selection": {"filter": "item", "values": [_GEO_PANGASINAN]}},
            {"code": "Commodity", "selection": {"filter": "item", "values": _COMMODITY_CODES}},
            # This year and last — a window, not just the current year,
            # so there's still a valid month to fall back to in
            # January/February before this year has any data yet.
            {"code": "Year", "selection": {"filter": "item", "values": [_year_code(this_year - 1), _year_code(this_year)]}},
            {"code": "Period", "selection": {"filter": "item", "values": _PERIOD_CODES}},
        ],
        "response": {"format": "csv"},
    }

_MONTH_NUMBER = {m: i for i, m in enumerate(
    ["January", "February", "March", "April", "May", "June",
     "July", "August", "September", "October", "November", "December"], start=1
)}

_CACHE_TTL = dt.timedelta(hours=12)
_cache_lock = threading.Lock()
_cache: list["PriceResult"] | None = None
_cache_at: dt.datetime | None = None


class PriceResult:
    def __init__(self, crop: str, variety_label: str, price_php_per_kg: float, year: str, period: str):
        self.crop = crop
        self.variety_label = variety_label
        self.price_php_per_kg = price_php_per_kg
        self.year = year
        self.period = period  # a month name, or "Annual"


def _fetch_from_psa() -> list[PriceResult] | None:
    try:
        resp = httpx.post(_API_URL, json=_build_query(), timeout=15.0)
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        logger.warning("PSA OpenSTAT price request failed: %s", exc)
        return None

    return _parse_csv(resp.text)


def _parse_csv(csv_text: str) -> list[PriceResult] | None:
    # csv.reader (not a naive .split(",")) — several commodity labels
    # this table returns contain a comma inside the quoted field itself
    # (e.g. "Palay [Paddy] Fancy, dry (conv. to 14% mc)"), which a plain
    # split mis-splits into extra columns and silently corrupts every
    # row that follows it.
    rows = [r for r in csv.reader(io.StringIO(csv_text.strip())) if r]
    if len(rows) < 2:
        return None
    header = rows[0]
    try:
        commodity_idx = header.index("Commodity")
        year_idx = next(i for i, h in enumerate(header) if h.strip().lower() == "year")
        period_idx = next(i for i, h in enumerate(header) if h.strip().lower() == "period")
        # The value column is whatever's left after the dimension
        # columns — PXWeb names it after the table's own unit/measure,
        # which varies per table, so it's identified by position
        # (last column) rather than a hardcoded name.
        value_idx = len(header) - 1
    except (ValueError, StopIteration):
        logger.warning("PSA OpenSTAT CSV response had an unexpected shape: %r", header)
        return None

    out: list[PriceResult] = []
    for cells in rows[1:]:
        if len(cells) <= value_idx:
            continue
        commodity_label = cells[commodity_idx]
        try:
            price = float(cells[value_idx])
        except ValueError:
            continue  # ".." (PSA's own "not available" marker), "r" revision flags, etc.
        crop = "Palay (Rice)" if "palay" in commodity_label.lower() else "Corn"
        out.append(PriceResult(crop, commodity_label, price, cells[year_idx], cells[period_idx]))
    return out or None


def _latest_valid_period(prices: list[PriceResult]) -> list[PriceResult]:
    """Every fetched row, all years/months at once — narrowed down to
    just whichever single (year, month) is the most recent one that
    actually has real data for at least one commodity. "Annual" rows
    are full-year averages, not a specific month, so they're excluded
    from "latest" — a farmer asking what things cost right now wants
    this month's number, not a mid-year figure from an average."""
    dated = [(int(p.year), _MONTH_NUMBER[p.period], p) for p in prices if p.period in _MONTH_NUMBER]
    if not dated:
        return []
    latest_key = max(key[:2] for key in dated)
    return [p for y, m, p in dated if (y, m) == latest_key]


def current_prices() -> list[PriceResult] | None:
    """Cached for _CACHE_TTL — see the module docstring for why."""
    global _cache, _cache_at
    with _cache_lock:
        now = dt.datetime.now(dt.timezone.utc)
        if _cache is not None and _cache_at is not None and now - _cache_at < _CACHE_TTL:
            return _cache
        result = _fetch_from_psa()
        _cache, _cache_at = result, now
        return result


def price_advisory_text() -> AdvisoryText | None:
    """Returns the latest Palay/Corn farmgate prices for Pangasinan, or
    None if the request failed or returned nothing usable — same
    graceful-no-op pattern as season_advisory.py and notifications.py's
    weather advisory."""
    prices = current_prices()
    if not prices:
        return None
    latest = _latest_valid_period(prices)
    if not latest:
        return None

    avg_by_crop: dict[str, float] = {}
    for crop in ("Palay (Rice)", "Corn"):
        rows = [p for p in latest if p.crop == crop]
        if rows:
            avg_by_crop[crop] = sum(r.price_php_per_kg for r in rows) / len(rows)
    if not avg_by_crop:
        return None
    period_label = f"{latest[0].period} {latest[0].year}"

    # Separate title/body variants per which crop(s) actually have a
    # price this period, rather than one template — the flat
    # {placeholder} substitution i18n.tsx uses can't itself omit a
    # clause when one crop's price is missing.
    has_palay, has_corn = "Palay (Rice)" in avg_by_crop, "Corn" in avg_by_crop
    variant = "both" if has_palay and has_corn else ("palayOnly" if has_palay else "cornOnly")
    parts_en = []
    params: dict = {"period": period_label}
    if has_palay:
        params["palayPrice"] = round(avg_by_crop["Palay (Rice)"], 2)
        parts_en.append(f"Palay \u20b1{avg_by_crop['Palay (Rice)']:.2f}/kg")
    if has_corn:
        params["cornPrice"] = round(avg_by_crop["Corn"], 2)
        parts_en.append(f"Corn \u20b1{avg_by_crop['Corn']:.2f}/kg")

    return AdvisoryText(
        title_key="notif.price.title",
        body_key=f"notif.price.{variant}Body",
        title_en="Latest farmgate prices — Pangasinan",
        body_en=(
            f"As of {period_label}: {', '.join(parts_en)} (PSA farmgate price, provincial average). "
            "Prices are a monthly PSA average, not a same-day quote — check with your local buyer before committing to a sale."
        ),
        params=params,
    )
