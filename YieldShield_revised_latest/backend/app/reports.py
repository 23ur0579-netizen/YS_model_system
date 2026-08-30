"""
Builds the two official Municipal Agriculture Office reports —
"Area Planted" and "Area Harvested", both "by Province, by
Municipality, by Ecosystem, by Seed Type" — as .xlsx files matching
the layout of the office's own existing templates (see the uploaded
reference files: PLANTING_D_S__2022-2023.xlsx / HARVEST_D_S__2022-2023.xlsx
/ PLANTING_W_S__2023.xlsx, the last of which is what confirmed the
office actually tracks Irrigated and Rainfed as separate sheets, plus
a combined Total, and uses "Farmer Saved Seeds" — not the placeholder
"RS-CS" this app guessed before — as one of its four seed-type
categories).

Both reports aggregate every farmer's cropping records (farm_input_log,
joined to farm_profile for barangay/crop/area) for a given crop and
ecosystem, grouped by barangay and then by seed-type (see migrations
20_ecosystem_seed_type.sql / 21_seed_distribution.sql) — a cropping
with no seed_type set still counts toward its barangay's grand total,
it just won't appear in any specific seed-type sub-column, the same
way the office's own historical files behave for rows they never
classified.

`ecosystem` is one of "Irrigated", "Rainfed", or "All" — "All" sums
both ecosystems together into one combined sheet (equivalent to the
reference workbook's TOTAL tab), rather than requiring two separate
downloads.

"Target" is a planning figure the office sets before the season
starts — nothing in this app tracks it, so that column is left blank
and lightly highlighted for the office to fill in by hand, per the
xlsx skill's guidance for a workbook someone else is meant to complete.
"""
import io

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

# Order matches the office's own WS 2023 template (RAINFED/IRRIGATED
# sheets): Hybrid, then the two DA-tagged certified-seed categories,
# then farmer-saved seed.
_SEED_TYPES = ["Hybrid", "Tagged CS (Commercial)", "Tagged CS (RCEF)", "Farmer Saved Seeds"]
_SEED_TYPE_LABELS = {
    "Hybrid": "HYBRID SEEDS",
    "Tagged CS (Commercial)": "TAGGED SEEDS (CS-COMMERCIAL)",
    "Tagged CS (RCEF)": "TAGGED SEEDS (RCEF)",
    "Farmer Saved Seeds": "FARMER SAVED SEEDS",
}
_ECOSYSTEM_HEADING = {
    "Irrigated": "IRRIGATED",
    "Rainfed": "RAINFED",
    "All": "ALL ECOSYSTEMS (IRRIGATED + RAINFED)",
}
_AREA_COL_IDX = {3, 5, 7, 9, 11}  # C, E, G, I, K — every "Area Planted"/"Harvest Area" column

_THIN = Side(style="thin", color="000000")
_BORDER = Border(left=_THIN, right=_THIN, top=_THIN, bottom=_THIN)
_HEADER_FILL = PatternFill("solid", fgColor="DCE6F1")
_TARGET_FILL = PatternFill("solid", fgColor="FFF9C4")  # for the office to fill in by hand
_BOLD = Font(bold=True)
_CENTER = Alignment(horizontal="center", vertical="center", wrap_text=True)
_CENTER_NOWRAP = Alignment(horizontal="center", vertical="center")
_LEFT = Alignment(horizontal="left", vertical="center")


def _fetch_barangay_rows(cur, crop_type_id: int, date_from, date_to, ecosystem: str) -> list[dict]:
    """One row per barangay-x-seed_type combination present in the date
    range (restricted to `ecosystem` unless it's "All"), plus the
    always-present per-barangay grand total (seed_type NULL in the
    returned row means "all"). "All" sums both ecosystems (and any
    unclassified rows) together rather than filtering on ecosystem at all."""
    params: list = [crop_type_id, date_from, date_to]
    ecosystem_clause = ""
    if ecosystem != "All":
        ecosystem_clause = "AND fil.ecosystem = %s"
        params.append(ecosystem)
    cur.execute(
        f"""
        SELECT b.barangay_name,
               fil.seed_type,
               GROUPING(fil.seed_type)                               AS is_barangay_total,
               COALESCE(SUM(COALESCE(fil.land_area_ha, fp.land_area_ha)), 0) AS area_ha,
               COUNT(DISTINCT fp.user_id)                            AS n_farmers,
               COALESCE(SUM(fil.actual_yield_mt_ha * COALESCE(fil.land_area_ha, fp.land_area_ha))
                         FILTER (WHERE fil.actual_yield_mt_ha IS NOT NULL), 0) AS production_mt,
               COALESCE(SUM(COALESCE(fil.land_area_ha, fp.land_area_ha))
                         FILTER (WHERE fil.actual_yield_mt_ha IS NOT NULL), 0) AS harvested_area_ha
          FROM yieldshield.farm_input_log fil
          JOIN yieldshield.farm_profile fp ON fp.farm_id = fil.farm_id
          JOIN yieldshield.barangay b ON b.barangay_id = fp.barangay_id
         WHERE fp.crop_type_id = %s
           AND fil.planting_date BETWEEN %s AND %s
           {ecosystem_clause}
         GROUP BY GROUPING SETS ((b.barangay_name), (b.barangay_name, fil.seed_type))
        """,
        params,
    )
    return cur.fetchall()


def _pivot(rows: list[dict]) -> dict[str, dict]:
    """barangay -> {"all": {...}, "Hybrid": {...}, ...}"""
    out: dict[str, dict] = {}
    for r in rows:
        b = out.setdefault(r["barangay_name"], {})
        key = "all" if r["is_barangay_total"] == 1 else r["seed_type"]
        b[key] = r
    return out


def _autosize(ws, widths: dict[str, float]):
    for col, w in widths.items():
        ws.column_dimensions[col].width = w


def _signature_block(ws, row: int, prepared_by: str, prepared_title: str, noted_by: str, noted_title: str,
                      left_cols: tuple[str, str], right_cols: tuple[str, str]):
    l0, l1 = left_cols
    r0, r1 = right_cols
    ws[f"{l0}{row}"] = "Prepared by:"
    ws[f"{l0}{row}"].font = _BOLD
    ws[f"{r0}{row}"] = "Noted:"
    ws[f"{r0}{row}"].font = _BOLD
    name_row = row + 2
    title_row = row + 3
    ws.merge_cells(f"{l0}{name_row}:{l1}{name_row}")
    ws.merge_cells(f"{r0}{name_row}:{r1}{name_row}")
    ws.merge_cells(f"{l0}{title_row}:{l1}{title_row}")
    ws.merge_cells(f"{r0}{title_row}:{r1}{title_row}")
    ws[f"{l0}{name_row}"] = prepared_by.upper()
    ws[f"{l0}{name_row}"].font = _BOLD
    ws[f"{l0}{name_row}"].alignment = _CENTER_NOWRAP
    ws[f"{l0}{title_row}"] = prepared_title
    ws[f"{l0}{title_row}"].alignment = _CENTER_NOWRAP
    ws[f"{r0}{name_row}"] = noted_by.upper()
    ws[f"{r0}{name_row}"].font = _BOLD
    ws[f"{r0}{name_row}"].alignment = _CENTER_NOWRAP
    ws[f"{r0}{title_row}"] = noted_title
    ws[f"{r0}{title_row}"].alignment = _CENTER_NOWRAP


def _col_letter_to_index(letter: str) -> int:
    from openpyxl.utils import column_index_from_string
    return column_index_from_string(letter)


def _no_data_notice(ws, row: int, last_col: int, crop_label: str, ecosystem: str, date_from, date_to) -> None:
    """Written across the data area instead of just leaving it blank
    when the query genuinely found zero matching croppings — a report
    with real bugs and a report that's correctly empty because the
    chosen date window doesn't overlap anything look identical
    otherwise (every cell just isn't there), and the second case is
    the far more common reason a generated report looks "broken": e.g.
    asking for Area Harvested over a window that only contains
    still-growing crops (nothing planted in that window has a
    recorded actual yield yet) is a correct, empty result, not a bug."""
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=last_col)
    cell = ws.cell(row=row, column=1)
    cell.value = (
        f"No {crop_label} croppings found for {ecosystem} between {date_from} and {date_to}. "
        "If this is the Area Harvested report, check the window covers a season that's actually "
        "been harvested (a cropping needs a recorded actual yield to count) — a window that only "
        "contains still-growing crops will correctly come back empty like this."
    )
    cell.font = Font(bold=True, italic=True, color="B45309")
    cell.alignment = _LEFT
    cell.fill = PatternFill("solid", fgColor="FFFBEB")


def build_area_planted_workbook(
    cur, crop_type_id: int, crop_label: str, date_from, date_to,
    season_label: str, as_of_label: str, municipality: str, province: str, ecosystem: str,
    prepared_by: str, prepared_title: str, noted_by: str, noted_title: str,
) -> io.BytesIO:
    rows = _fetch_barangay_rows(cur, crop_type_id, date_from, date_to, ecosystem)
    pivot = _pivot(rows)
    barangays = sorted(pivot.keys())

    wb = Workbook()
    ws = wb.active
    ws.title = "Area Planted"

    last_col = 12  # A..L
    ws.merge_cells(f"A1:{get_column_letter(last_col)}1")
    ws["A1"] = f"AREA PLANTED BY PROVINCE, BY MUNICIPALITY, BY ECOSYSTEM, BY SEED TYPE ({season_label}) — {crop_label.upper()}"
    ws["A1"].font = Font(bold=True, size=12)
    ws["A1"].alignment = _CENTER_NOWRAP

    ws["A2"] = f"{municipality}, {province}"
    ws["D2"] = f"As of {as_of_label}"

    # Header block (rows 3-5): Barangay + Target span all three rows;
    # the ecosystem heading spans row 3 across the four seed-type
    # groups; each seed type's name spans row 4 across its own two
    # columns; row 5 carries the actual Area Planted/No. of Farmers
    # sub-headers. TOTAL spans rows 3-4 (no seed-type name needed)
    # then gets its own sub-headers on row 5, same as the others.
    ws.merge_cells("A3:A5")
    ws["A3"] = "Barangay"
    ws.merge_cells("B3:B5")
    ws["B3"] = "Target (Ha)"
    ws.merge_cells("C3:J3")
    ws["C3"] = _ECOSYSTEM_HEADING[ecosystem]
    ws.merge_cells("K3:L4")
    ws["K3"] = "TOTAL"

    seed_cols = ["C", "E", "G", "I"]  # each spans 2 columns
    for start_col, seed in zip(seed_cols, _SEED_TYPES):
        idx = _col_letter_to_index(start_col)
        end_col = get_column_letter(idx + 1)
        ws.merge_cells(f"{start_col}4:{end_col}4")
        ws[f"{start_col}4"] = _SEED_TYPE_LABELS[seed]
        ws[f"{start_col}5"] = "Area Planted (Ha)"
        ws[f"{end_col}5"] = "No. of Farmers"
    ws["K5"], ws["L5"] = "Area Planted (Ha)", "No. of Farmers"

    for r in range(3, 6):
        for c in range(1, last_col + 1):
            cell = ws.cell(row=r, column=c)
            cell.border = _BORDER
            cell.fill = _TARGET_FILL if c == 2 else _HEADER_FILL
            cell.font = _BOLD
            if cell.alignment.horizontal is None:
                cell.alignment = _CENTER

    # Data rows
    r = 6
    if not barangays:
        _no_data_notice(ws, r, last_col, crop_label, ecosystem, date_from, date_to)
        r += 1
    totals = {"area": 0.0, "farmers": 0}
    seed_totals = {s: {"area": 0.0, "farmers": 0} for s in _SEED_TYPES}
    for barangay in barangays:
        b = pivot[barangay]
        all_row = b.get("all")
        area = float(all_row["area_ha"]) if all_row else 0.0
        farmers = int(all_row["n_farmers"]) if all_row else 0
        totals["area"] += area
        totals["farmers"] += farmers

        ws[f"A{r}"] = barangay
        ws[f"B{r}"].fill = _TARGET_FILL  # left blank for the office to fill in
        ws[f"K{r}"] = area or None
        ws[f"L{r}"] = farmers or None
        for start_col, seed in zip(seed_cols, _SEED_TYPES):
            cell = b.get(seed)
            idx = _col_letter_to_index(start_col)
            if cell and float(cell["area_ha"]) > 0:
                ws.cell(row=r, column=idx, value=float(cell["area_ha"]))
                ws.cell(row=r, column=idx + 1, value=int(cell["n_farmers"]))
                seed_totals[seed]["area"] += float(cell["area_ha"])
                seed_totals[seed]["farmers"] += int(cell["n_farmers"])
        for c in range(1, last_col + 1):
            cell = ws.cell(row=r, column=c)
            cell.border = _BORDER
            if c == 1:
                cell.alignment = _LEFT
            elif cell.value is not None and not isinstance(cell.value, str):
                cell.number_format = "0.##" if c in _AREA_COL_IDX else "0"
                cell.alignment = _CENTER_NOWRAP
        r += 1

    total_row = r
    ws[f"A{total_row}"] = "TOTAL"
    ws[f"A{total_row}"].font = _BOLD
    ws[f"K{total_row}"] = totals["area"] or None
    ws[f"L{total_row}"] = totals["farmers"] or None
    for start_col, seed in zip(seed_cols, _SEED_TYPES):
        idx = _col_letter_to_index(start_col)
        st = seed_totals[seed]
        if st["area"] > 0:
            ws.cell(row=total_row, column=idx, value=st["area"])
            ws.cell(row=total_row, column=idx + 1, value=st["farmers"])
    for c in range(1, last_col + 1):
        cell = ws.cell(row=total_row, column=c)
        cell.border = _BORDER
        cell.font = _BOLD
        if c > 1 and cell.value is not None and not isinstance(cell.value, str):
            cell.number_format = "0.##" if c in _AREA_COL_IDX else "0"
            cell.alignment = _CENTER_NOWRAP

    _signature_block(ws, total_row + 2, prepared_by, prepared_title, noted_by, noted_title, ("A", "D"), ("F", "K"))

    _autosize(ws, {"A": 20, "B": 12, "C": 14, "D": 12, "E": 14, "F": 12, "G": 14, "H": 12, "I": 14, "J": 12, "K": 14, "L": 12})
    for row_dim in (3, 4, 5):
        ws.row_dimensions[row_dim].height = 28

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf


def build_area_harvested_workbook(
    cur, crop_type_id: int, crop_label: str, date_from, date_to,
    season_label: str, as_of_label: str, municipality: str, province: str, ecosystem: str,
    prepared_by: str, prepared_title: str, noted_by: str, noted_title: str,
) -> io.BytesIO:
    rows = _fetch_barangay_rows(cur, crop_type_id, date_from, date_to, ecosystem)
    pivot = _pivot(rows)
    barangays = sorted(pivot.keys())

    wb = Workbook()
    ws = wb.active
    ws.title = "Area Harvested"

    last_col = 17  # A..Q (4 seed-type groups x 3 cols = 12, plus A-E "ALL SEED TYPE")
    ws.merge_cells(f"A1:{get_column_letter(last_col)}1")
    ws["A1"] = f"AREA HARVESTED BY PROVINCE, BY MUNICIPALITY, BY ECOSYSTEM, BY SEED TYPE ({season_label}) — {crop_label.upper()}"
    ws["A1"].font = Font(bold=True, size=12)
    ws["A1"].alignment = _CENTER_NOWRAP

    ws["A2"] = f"{municipality}, {province}"
    ws["D2"] = f"As of {as_of_label}"

    ws.merge_cells("A4:A7")
    ws["A4"] = "BARANGAY"
    ws.merge_cells("B4:E6")
    ws["B4"] = "ALL SEED TYPE"
    ws.merge_cells(f"F4:{get_column_letter(last_col)}4")
    ws["F4"] = _ECOSYSTEM_HEADING[ecosystem]
    ws.merge_cells(f"F5:{get_column_letter(last_col)}5")
    ws["F5"] = "HARVESTED (HA)"
    seed_cols = ["F", "I", "L", "O"]  # each spans 3 columns
    for start_col, seed in zip(seed_cols, _SEED_TYPES):
        idx = _col_letter_to_index(start_col)
        end_col = get_column_letter(idx + 2)
        ws.merge_cells(f"{start_col}6:{end_col}6")
        ws[f"{start_col}6"] = _SEED_TYPE_LABELS[seed]
    ws["B7"], ws["C7"], ws["D7"], ws["E7"] = "TOTAL TARGET", "Harvest Area (Ha)", "Ave. Yield (MT/ha)", "Prod'n (MT)"
    for start_col in seed_cols:
        idx = _col_letter_to_index(start_col)
        ws.cell(row=7, column=idx, value="Harvest Area (Ha)")
        ws.cell(row=7, column=idx + 1, value="Ave. Yield (MT/ha)")
        ws.cell(row=7, column=idx + 2, value="Prod'n (MT)")

    for r in range(4, 8):
        for c in range(1, last_col + 1):
            cell = ws.cell(row=r, column=c)
            cell.border = _BORDER
            cell.fill = _HEADER_FILL
            cell.font = _BOLD
            if cell.alignment.horizontal is None:
                cell.alignment = _CENTER

    r = 8
    if not barangays:
        _no_data_notice(ws, r, last_col, crop_label, ecosystem, date_from, date_to)
        r += 1
    totals = {"prod": 0.0, "harvested_area": 0.0}
    seed_totals = {s: {"area": 0.0, "prod": 0.0} for s in _SEED_TYPES}
    for barangay in barangays:
        b = pivot[barangay]
        all_row = b.get("all")
        prod = float(all_row["production_mt"]) if all_row else 0.0
        harvested_area = float(all_row["harvested_area_ha"]) if all_row else 0.0
        avg_yield = (prod / harvested_area) if harvested_area > 0 else None
        totals["prod"] += prod
        totals["harvested_area"] += harvested_area

        ws[f"A{r}"] = barangay
        ws[f"B{r}"] = None
        ws[f"B{r}"].fill = _TARGET_FILL
        # Column C is genuinely "Harvest Area (Ha)" per its header — use
        # harvested_area (only rows with a recorded actual_yield_mt_ha),
        # not `area` (every planted row, harvested or still standing).
        # Using `area` here made this column show a real, non-zero total
        # even when nothing in it had actually been harvested yet, while
        # Ave. Yield/Prod'n (which already correctly divided by
        # harvested_area) came back blank right next to it — looking
        # exactly like "some columns have data and some don't" when it
        # was really one column reporting the wrong figure.
        ws[f"C{r}"] = harvested_area or None
        ws[f"D{r}"] = round(avg_yield, 2) if avg_yield else None
        ws[f"E{r}"] = round(prod, 2) if prod else None
        for start_col, seed in zip(seed_cols, _SEED_TYPES):
            cell = b.get(seed)
            idx = _col_letter_to_index(start_col)
            # Gate on harvested_area_ha, not area_ha — this report only
            # means to show seed-type breakdowns for combinations that
            # have actually been harvested; a seed type with planted-
            # but-still-growing area and nothing else would otherwise
            # show a real-looking Harvest Area figure next to a blank
            # Ave. Yield/Prod'n for the exact same reason as the totals
            # column above.
            if cell and float(cell["harvested_area_ha"]) > 0:
                c_harv_area = float(cell["harvested_area_ha"])
                c_prod = float(cell["production_mt"])
                c_yield = c_prod / c_harv_area
                ws.cell(row=r, column=idx, value=c_harv_area)
                ws.cell(row=r, column=idx + 1, value=round(c_yield, 2))
                ws.cell(row=r, column=idx + 2, value=round(c_prod, 2))
                seed_totals[seed]["area"] += c_harv_area
                seed_totals[seed]["prod"] += c_prod
        for c in range(1, last_col + 1):
            cell = ws.cell(row=r, column=c)
            cell.border = _BORDER
            if c == 1:
                cell.alignment = _LEFT
            elif cell.value is not None and not isinstance(cell.value, str):
                cell.number_format = "0.##"
                cell.alignment = _CENTER_NOWRAP
        r += 1

    total_row = r
    total_avg_yield = (totals["prod"] / totals["harvested_area"]) if totals["harvested_area"] > 0 else None
    ws[f"A{total_row}"] = "TOTAL"
    ws[f"A{total_row}"].font = _BOLD
    ws[f"C{total_row}"] = totals["harvested_area"] or None
    ws[f"D{total_row}"] = round(total_avg_yield, 2) if total_avg_yield else None
    ws[f"E{total_row}"] = round(totals["prod"], 2) if totals["prod"] else None
    for start_col, seed in zip(seed_cols, _SEED_TYPES):
        idx = _col_letter_to_index(start_col)
        st = seed_totals[seed]
        if st["area"] > 0:
            ws.cell(row=total_row, column=idx, value=st["area"])
            ws.cell(row=total_row, column=idx + 2, value=round(st["prod"], 2))
    for c in range(1, last_col + 1):
        cell = ws.cell(row=total_row, column=c)
        cell.border = _BORDER
        cell.font = _BOLD
        if cell.value is not None and not isinstance(cell.value, str):
            cell.number_format = "0.##"
            cell.alignment = _CENTER_NOWRAP

    _signature_block(ws, total_row + 2, prepared_by, prepared_title, noted_by, noted_title, ("A", "C"), (get_column_letter(last_col - 3), get_column_letter(last_col)))

    widths = {"A": 20, "B": 12, "C": 14, "D": 14, "E": 12}
    for start_col in seed_cols:
        idx = _col_letter_to_index(start_col)
        widths[get_column_letter(idx)] = 14
        widths[get_column_letter(idx + 1)] = 14
        widths[get_column_letter(idx + 2)] = 12
    _autosize(ws, widths)
    for row_dim in (4, 5, 6, 7):
        ws.row_dimensions[row_dim].height = 28

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf