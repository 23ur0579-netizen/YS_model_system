# YieldShield — UI redesign merged into the live backend

This is your working (DB + FastAPI-backed) app with the new UI's changes applied
and reconnected to real Postgres/FastAPI, not the mock data it shipped with.

## What changed

**New modules, now backed by real tables/endpoints (not mocked):**
- **Fields** — a physical plot that can host multiple cropping periods. New
  `field` table; `farm_profile.field_id` links each cropping back to it.
  Existing plots were backfilled into one field per farmer × barangay.
- **Farmer registration approval** — sign-up no longer creates an account
  immediately. It creates a pending `registration_request`; a verification
  admin approves/rejects it; approval emails a token the farmer uses on the
  "Complete registration" screen to set their password and activate the
  account.
- **Crop tasks** (watering/fertilizer reminders) — `crop_task` table, feeds
  Calendar and the new WeekPlan dashboard card.
- **Announcements** — `announcement` table, staff-writable/everyone-readable.
- **Audit log** — `app_audit_log` table. Records privileged actions
  (announcements, registrations, account/privilege changes) for master-tier
  admin review. This is separate from the pre-existing `audit_log` trigger
  table (that one's a raw row-diff forensic log; this one's a curated,
  human-readable action trail).
- **Admin privilege tiers** — `admin_role` column on `user_account`
  (master / verification / corn / palay), enforced in the API via
  `require_admin_role()`.
- **Extra agronomic fields** — variety, planting technique, spacing, seed
  rate, all persisted on `farm_input_log`.
- **Simulation screen** — intentionally has *no* backend calls. It's a
  what-if calculator ("nothing is saved" per the UI copy) that reuses the
  same scoring formula as real submissions.

**Run the new migration** (`backend/migrations/07_v2_features.sql`) after
`06_user_barangay.sql`, same way as the others (`psql` as `yieldshield_owner`).
It's transactional and backfills existing data — safe to run once on your
current database.

## Scope decisions worth knowing about

- **No live ML model service.** Same limitation as before this change — the
  backend still doesn't call a real yield-prediction model. What's new: the
  frontend's client-side scoring formula (`store.tsx`'s `score()`, also
  used standalone by the Simulation screen) now gets submitted to and
  *persisted* by the backend (`predicted_yield_mt_ha`/`confidence` on
  `FarmInputRequest`), instead of being silently discarded. Swap this out
  once a real model exists — the API response shape won't need to change.
- **Sign-in dropped the Farmer/Admin tab.** The new UI simplified sign-in
  to one form. The backend's `role` field on login is now optional — when
  omitted it matches on identifier + password alone and returns whatever
  role the account actually has.
- **The new UI's "quick sign-in test accounts" panel was deliberately not
  carried over.** It bypassed real authentication entirely (no password
  check) — fine for a disconnected mockup, not something to ship against a
  real user database. Sign-in now always goes through real bcrypt+JWT auth.
- **Government ID upload is filename-only.** There's no document/object
  storage configured in this build, so `idFileName` records what was
  attached, not the file bytes. A verification admin approves based on
  whatever out-of-band ID check your process uses today; wiring up real
  file storage (S3/disk + an upload endpoint) is a follow-up if you want
  the ID image itself retrievable later.
- **Settings' profile edit now goes through the real self-service endpoint**
  (`PATCH /users/me`) instead of the staff-only user-management one the new
  UI's mock had wired up — a Farmer account can't call the staff endpoint
  on themselves against the real backend's permission checks.
- **Frontend writes are optimistic.** Creating/editing a field, cropping,
  task, announcement, or user updates the screen immediately and persists
  in the background; failures show a toast and roll back where that's safe
  to do (new records) or leave the edit local with a "couldn't reach the
  server" toast (in-place edits) so nothing silently vanishes.

## Dataset update: binalonan_crop_data4.xlsx

The workbook was swapped from `binalonan_crop_data2.xlsx` to
`binalonan_crop_data4.xlsx`. Every sheet is byte-for-byte the same layout
as before **except**:

- **"Crop Features" was restructured** (33 → 42 columns, different order).
  `etl_load.py`'s loader now detects which layout it's reading (checks
  whether cell A1 is `"Record_ID"`) and handles both. The new layout also
  dropped the explicit Planting Month/Year columns it used to have — those
  are now backfilled from the matching Planting-phase row in Central Data
  (verified: all 458 rows match cleanly, no orphans). Every genuinely new
  column the restructure added (soil pH, organic matter, texture, drainage,
  seedlings/fertilizer/pesticide/herbicide applied, and every "_Ratio" /
  "_Interaction" / quarter / semester derived stat) is **100% empty** in
  this revision — reserved for a future data pass. No schema changes were
  made for them; they're simply not read. If a future revision populates
  them, that's a `09_...sql` migration away.
- **New "Crop Varieties" sheet** — a 71-row NSIC/PhilRice-style variety
  catalog (35 Palay + 36 Corn varieties: maturity days, yield potential,
  drought/flood tolerance, disease resistance). This is genuinely new
  reference data, so it got a new table: `migrations/08_crop_varieties.sql`
  adds `crop_variety`, and `etl_load.py` loads it. It's read-only reference
  data (same access pattern as `crop_type`/`barangay`/`planting_technique`)
  — nothing in the API surfaces it yet. The DataInput/Simulation screens'
  "variety" field is still free text; wiring a real dropdown backed by this
  table (filtered by selected crop) would be a natural follow-up, especially
  since `farm_input_log.variety` already exists from the earlier UI merge.

Re-run `01_setup_db_native.sh`/`.ps1` (now applies migration 08 too) then
`02_load_data.sh /path/to/binalonan_crop_data4.xlsx` — safe to re-run,
everything upserts.

Validated without a live DB: parsed the actual `binalonan_crop_data4.xlsx`
workbook end-to-end through both new loader functions (458/458
`crop_features` rows resolved correctly, 71/71 `crop_variety` rows resolved
to a known crop), and confirmed the old `binalonan_crop_data2.xlsx` still
parses correctly through the same code path (backward compatible).



There's no live Postgres/FastAPI/npm registry access in the environment this
was built in, so:
- Every Python file passes `python -m py_compile` (syntax-valid), and the
  SQL migration is balanced (`BEGIN`/`COMMIT`), but neither has been run
  against a real database.
- The full frontend was type-checked with `tsc --noEmit` — **zero errors**
  in any new or modified file (the only errors reported are pre-existing
  gaps unrelated to this change: missing `vite-env.d.ts` asset/env typing
  that predates this work). A full `vite build` bundle could not be
  produced here because the sandboxed `node_modules` is missing a
  platform-native optional dependency (`@rollup/rollup-linux-x64-gnu`) —
  run `npm install` in your own environment and `npm run build` should
  work cleanly.

Recommend running the migration on a staging DB copy first and smoke-testing
sign-up → approval → sign-in → field/cropping creation → task/announcement
CRUD → audit log before pointing this at production data.

---

## Bug-fix pass (this session)

Reviewed the codebase end-to-end (`py_compile` on every backend file,
`tsc --noEmit` on the frontend, and a manual cross-check of every SQL
function/table referenced from Python against the migrations) and fixed:

1. **Registration-approval email sent applicants to the wrong flow.**
   `registrations.py`'s `approve_registration()` was reusing
   `send_password_reset_email()`, which links to `/reset-password?token=...`
   — but an approved applicant has no `user_account` row yet (only a
   `registration_request` row), so that endpoint would reject them. Worse,
   `Login.tsx` only checked for `?token=` and always routed that to the
   password-reset panel, never `continue`. Added a dedicated
   `send_registration_approved_email()` (links to
   `/complete-registration?email=...&token=...`) and updated `Login.tsx`
   to tell the two link types apart by the presence of `email` in the
   query string, pre-filling the right panel either way.
2. **`ui/calendar.tsx` was built against react-day-picker v8's API**
   (`IconLeft`/`IconRight`, `nav_button_previous`, etc.) but v9.14.0 is
   installed, which silently ignores all of it — the widget would render
   completely unstyled. Rewritten against v9's actual API (`Chevron`
   component, renamed `classNames` keys). Nothing currently imports this
   widget, but it's now correct for whenever something does.
3. **Missing `vite-env.d.ts`** — caused 6 of the 9 pre-existing `tsc`
   errors (`import.meta.env`, `import.meta.glob`, untyped CSS side-effect
   import). One-line fix; `tsc --noEmit` is now fully clean.
4. **`POST /auth/register` silently dropped the required `barangay`
   field.** `RegisterRequest` requires a `barangay`, but the handler
   never read it and called the 5-arg `auth_register_farmer()` overload
   (no barangay param) instead of the 6-arg one added in
   `06_user_barangay.sql`. A farmer signing up through this legacy
   endpoint would end up with no `barangay_id` on their account. Fixed to
   resolve and pass it through.
5. **`GET /farms` fetched but discarded `field_id`/`variety`/
   `technique_name`/`spacing_cm`/`seed_rate`.** The SQL selected all five
   columns, and `FarmOut` has fields for all five, but `_row_to_farm()`
   never mapped them across — every plot's Field grouping and agronomic
   detail display were silently blank regardless of what was actually
   stored. Fixed to map all five through.

Re-verified after the fixes: `python -m py_compile` on every backend
file, `tsc --noEmit` on the frontend — both clean, no new issues.

## Email configuration

Outbound email (password-reset links, new-account credentials,
registration-approval links) is now configured to send from
**yield.shield1@gmail.com** via `smtp.gmail.com:587` in both `.env` and
`.env.example`.

**`SMTP_PASSWORD` is still blank** — Gmail rejects SMTP login with the
account's normal password. Before this can actually send mail:
1. Turn on 2-Step Verification on `yield.shield1@gmail.com` (Google
   Account → Security), if it isn't on already.
2. Google Account → Security → 2-Step Verification → App passwords →
   create one.
3. Paste the 16-character App Password into `SMTP_PASSWORD` in `.env`.

Until that's filled in, every outgoing email attempt will fail and get
logged (each call site already wraps sending in `try/except` and logs +
continues rather than breaking the request) — with `SMTP_HOST` set but no
working credentials, that's a logged SMTP auth error rather than the old
"just print the link" dev fallback. Leave `SMTP_HOST` blank instead if
you want the console-logging fallback back for local dev.

---

## Ecosystem-aware municipal reports + seed distribution tracking (this session)

Prompted by the newly uploaded `PLANTING_W_S__2023.xlsx` (RAINFED /
IRRIGATED / TOTAL sheets), which revealed two things the app had
guessed wrong: the office's real seed-type categories are Hybrid,
Tagged CS (Commercial), Tagged CS (RCEF), and **Farmer Saved Seeds** —
not the placeholder `RS-CS` migration 20 invented — and the office
tracks Irrigated/Rainfed as separate report sheets plus a combined
Total, not one Irrigated-only view.

**Migration 21 (`21_seed_distribution.sql`):**
- Adds `'Farmer Saved Seeds'` to `farm_input_log.seed_type`'s CHECK
  constraint (`'RS-CS'` kept for old rows, no longer offered in the UI).
- New `yieldshield.seed_distribution` table — DA/MAO seed hand-outs
  scheduled and tallied per barangay (crop, barangay, ecosystem, seed
  type, quantity, beneficiary count, scheduled/distributed dates,
  status). Deliberately separate from `farm_input_log`, which records
  what a farmer actually planted, not what the office handed out.
  RLS mirrors `announcement`'s staff-wide read/write; the
  corn/palay/master-only restriction is enforced at the API layer
  (`require_admin_role`), same division of labor as `app_audit_log`.
- Adds `'seed_distribution'` to `app_audit_log.category` so the new
  router's create/update/delete actions get their own audit trail
  entries instead of overloading `'announcement'`.

**Reports (`reports.py` / `routers/reports.py`):** both report
builders now take an `ecosystem: "Irrigated" | "Rainfed" | "All"`
parameter — `"All"` sums both ecosystems into one sheet (equivalent to
the reference workbook's TOTAL tab) instead of requiring two separate
downloads. `build_planting_status_workbook` was rewritten as
`build_area_planted_workbook` to match the real template's column
layout (Target / Hybrid / Tagged CS Commercial / Tagged CS RCEF /
Farmer Saved Seeds / Total, each as Area Planted + No. of Farmers).
`build_area_harvested_workbook` got the same ecosystem parameter and
a fourth "Farmer Saved Seeds" column group for consistency. The
`/reports/planting-status` endpoint is renamed `/reports/area-planted`
to match the real title; `AdminFarms.tsx`'s Reports modal gained an
Irrigated/Rainfed/Overall toggle and its buttons were relabeled.

**Seed distribution screen:** new `routers/seed_distribution.py`
(list/create/update/delete, `require_admin_role("corn","palay")` —
master always included — plus a `_require_crop_scope` guard so a
corn-tier admin can't touch palay records or vice versa) and a new
`SeedDistribution.tsx` screen (nav-gated to master/corn/palay tiers
only, same pattern as `Planning.tsx`): a schedule table per barangay
with Mark Distributed / Edit / Delete actions, and a tally card
summarizing kg distributed vs. still-scheduled and beneficiary counts
per barangay. The office's own guideline — hybrid seed for irrigated
areas, certified (Tagged CS) seed for rainfed areas — is enforced as
a soft, non-blocking flag (`onGuideline` in the API response) rather
than a hard constraint, since farmers sometimes specifically request
hybrid in a rainfed area for its higher yield potential; the exact
same off-guideline check is duplicated (deliberately — no shared
frontend/backend code path) in the cropping form's seed-source picker.

**Cropping form (`MyFarm.tsx`):** restored the seed-source control
that a prior session had deliberately stubbed out ("temporarily
removed... can come back later without any data-model changes" — it
was right, no schema changes were needed). It's now a two-way toggle,
Farmer's own seed vs. From the Department of Agriculture; picking
"own" auto-sets `seed_type` to `"Farmer Saved Seeds"`, picking "DA"
reveals a dropdown of the three DA-subsidized categories, with the
same off-guideline note shown inline if the ecosystem/seed-type
combination departs from the usual pattern.

Not yet run against a live database — same limitation as every prior
session's changes here (see the top of this file). `python -m
py_compile` is clean on every touched backend file; `tsc --noEmit` is
clean on every touched frontend file (three pre-existing errors in
`MapPicker.tsx` and two spots in `store.tsx`'s `addField`/`addTask`
remain — present before this session's changes and unrelated to it).

**Follow-up cleanup (same session, on request):** fixed those three
pre-existing `tsc` errors, none related to seed distribution/reports:
- `MapPicker.tsx` and `FieldMapPlotter.tsx` each `declare global`-augment
  `Window.L` (the CDN-loaded Leaflet object) with a different shape —
  TypeScript requires every declaration of the same global member to
  match exactly. Made `MapPicker.tsx`'s match `FieldMapPlotter.tsx`'s
  fuller one (it only uses map/tileLayer/marker; the rest just need to
  be present so the two agree).
- `api.ts`'s `createField()` required a `notes` field that
  `FieldCreateRequest` (schemas.py) hasn't accepted since the location
  redesign — removed it from the type instead of papering over it with
  `notes?:`, since the backend never reads it at all.
- `api.ts`'s `createTask()`/`ApiCropTask.type` were missing
  `"pre_planting"`, even though migration 13 and
  `CropTaskCreateRequest`/`CropTaskOut` (schemas.py) have supported it
  for a while — a real frontend/backend type-contract gap, not just a
  lint nitpick. Added it to both.

`tsc --noEmit` is now fully clean, zero errors, across the whole
frontend.

---

## Smaller summary cards + WeekPlan empty-state sizing (this session)

The "row of 4 stat cards" pattern (Dashboard, AdminFarms, ManageUsers,
MyFarm, Planning x3, AuditLog) turned out to be the exact same markup
copy-pasted into 6 different files, each with its own local
`StatCard`/`SummaryCard`/`Stat` function. Extracted one shared
`components/StatCard.tsx` (smaller by default: `p-5`->`p-3.5`,
`h-10 w-10` icon box -> `h-8 w-8`, `text-2xl` value -> `text-xl`, plus
matching reductions to label/sub text and the grid gaps around every
row) and pointed all six call sites at it — MyFarm.tsx/Planning.tsx
import it aliased as `SummaryCard`/`Dashboard.tsx` as `Stat` to avoid
touching every call site's JSX. `AuditLog.tsx`'s inline markup was
replaced with a direct `<StatCard>` call. All six local function
definitions were deleted, not just superseded, so there's now exactly
one place this pattern's sizing lives.

`WeekPlan.tsx` ("What to do this week"): the empty state now gets
`aspect-square` added to the outer card only when there are zero
items — it stays a clean square regardless of its grid column's
width, exactly as wide as it is tall. As soon as there's real content,
that class is simply never applied, so the card returns to its normal
auto-height behavior (which is how it already worked) — no separate
"has content" styling was needed, only conditionally *withholding*
the square constraint.

`tsc --noEmit` clean, zero errors, after these changes.

---

## WeekPlan: show which cropping each task belongs to (this session)

A farmer with more than one plot had no way to tell "Apply fertilizer"
apart across plots on the "What to do this week" card — the reminder
text itself is generic (see `farm_calendar.py`'s `generate_activities`),
and nothing in the card said which cropping it was for, unlike the
harvest/planting-window items just below it, which already show
`plotId · crop`. Fixed by looking up each task's `predictionId`
against `visiblePredictions` and appending the same `plotId · crop`
label to the detail line (e.g. "Apply fertilizer · LOT-2026-201 ·
Palay") whenever the task is tied to one. A task with no
`predictionId` — a general reminder not linked to any specific plot,
addable from Calendar.tsx — falls back to just the category text,
exactly as before.

---

## Wired the unused crop_variety catalog into the app (this session)

Follow-up to the earlier "does the dataset have the new fields"
investigation: `yieldshield.crop_variety` (migration 08, NSIC/PhilRice
catalog — maturity days, average/max yield, drought/flood tolerance,
category) had been loaded by `etl_load.py` for a while but nothing in
the API or frontend actually read it; MyFarm.tsx's and Simulation.tsx's
variety pickers were each their own separate hardcoded free-text list.

**New `GET /crop-varieties?crop=...`** (`crop_varieties.py`) — read-only,
any signed-in user, same access pattern as other reference data.

**Variety pickers** (`MyFarm.tsx`'s CroppingModal, `Simulation.tsx`) now
populate from this catalog when it's loaded, falling back to the old
hardcoded lists otherwise. Whatever's currently selected is always kept
as a renderable option even if it isn't in whichever list wins — an
older saved record's free-text variety, or a legacy hardcoded name,
is never silently dropped from the dropdown. Picking a cataloged
variety shows its maturity days/category/average yield/drought
tolerance inline.

**Two real, if modest, effects on numbers the app produces:**
- `predictYield()`'s heuristic (`store.tsx`) now uses the selected
  variety's `average_yield_t_ha` as its baseline instead of a flat
  4.0 t/ha (corn) / 5.0 t/ha (palay) assumption, when that variety is
  in the catalog — the same environmental/timing/spacing multiplier
  then applies on top, same as before. Free-text/uncataloged varieties
  keep the exact old flat-baseline behavior.
- The auto-generated care schedule (`farm_calendar.py`'s
  `generate_activities`, called from `farm_input.py`) now anchors its
  maturity-based tasks and WeekPlan.tsx's/AdminFarms.tsx's/
  ManageUsers.tsx's harvest countdowns on the variety's real
  `maturity_days` (a 105-day variety and a 130-day variety no longer
  share one flat 120-day assumption) via a new `variety_maturity_days()`
  helper, with the flat default as fallback. Editing a cropping's
  variety (not just planting date/technique) now also triggers the
  schedule-recalculation path built earlier this session.

**Explicitly not touched:** the actual trained Random Forest/XGBoost
model. Variety was never a column in the historical training data
(`Crop Features` sheet) either, so this doesn't change what that model
predicts — only the client-side heuristic formula, which is a
different, hand-written code path (see farm_input.py's docstring on
`_HEURISTIC_MODEL_NAME`).

`python -m py_compile` / `tsc --noEmit` both clean after these changes.

---

## Editing a cropping's planting date/technique now recalculates its calendar (this session)

Editing a cropping (MyFarm.tsx's "Edit cropping") previously only
touched `farm_input_log` — the auto-generated care schedule plotted
at submission time (`farm_calendar.py`'s `generate_activities()`,
inserted into `crop_task`) stayed anchored to whatever planting date
the cropping *originally* had. Calendar.tsx and WeekPlan.tsx both just
read `crop_task` as-is, so changing the planting date silently left
every reminder's due date wrong.

**Migration 22** adds `crop_task.auto_generated` (default `FALSE`,
backfilled `TRUE` for all pre-existing rows — see the migration's own
comment for why that backfill call is safe here specifically). This
is what makes it safe to delete-and-recreate a schedule on edit
without also wiping out a task the farmer added by hand from the
Calendar — those stay `FALSE` and are never touched.

**`routers/farm_input.py`'s `update_farm_input`** now snapshots the
cropping's planting date and technique *before* applying the edit
(MyFarm.tsx's edit form always resends every field whether the farmer
actually changed it or not, so this comparison is required — checking
"was a value provided" isn't enough). If either genuinely changed, it
deletes that cropping's not-yet-done `auto_generated` tasks and
reruns `generate_activities()` against the new values, then sends a
"Care schedule updated" notification the same way the initial
"Farm schedule ready" one works at creation time. Completed tasks are
left alone as a record of what actually happened; hand-added tasks are
never touched regardless of their due date.

**`store.tsx`'s `updatePrediction`** now calls the existing
`refreshTasks()` helper after a successful edit, so Calendar.tsx and
WeekPlan.tsx (both already reading the same `tasks` list) pick up any
recalculated due dates immediately, without needing a full page
reload.

`python -m py_compile` / `tsc --noEmit` both clean after these changes.

---

## Seed source narrows the variety picker; reordered the cropping form (this session)

Two related fixes to `MyFarm.tsx`'s CroppingModal (used for both Add
and Edit — always was one shared component, so there was never a
code-level difference between the two; the actual issue was the
*order* fields appeared in).

**Variety now depends on seed source:**
- **Farmer's own seed** → every variety in the catalog stays offered,
  no restriction (a farmer can save seed from anything they grew).
- **From DA** → narrows once a specific seed type is picked, using
  `crop_variety.category`: choosing **Hybrid** shows only
  Hybrid/GM Hybrid varieties (that's what the Hybrid program actually
  hands out); choosing **Tagged CS (RCEF)** or **Tagged CS
  (Commercial)** shows only non-hybrid (Inbred/OPV) varieties (RCEF and
  Certified-Seed programs distribute certified inbred seed, not
  hybrid). Before a specific type is chosen, everything stays offered —
  there's no real basis to narrow anything until then, since DA runs
  programs across both categories.
- Switching source/type only ever reassigns the variety field in
  direct response to that click (never on mount/opening an existing
  record) — editing a cropping never silently rewrites its
  already-saved variety just because it doesn't fit the newly-picked
  category.
- **Simulation.tsx (admin)** deliberately keeps no seed-source concept
  at all and always offers every variety — that's the requirement, not
  an oversight, so it was left alone.

**Reordered the form:** Ecosystem + seed source now come right after
the crop selector, before Variety — necessary for the above to make
sense as a live flow (you can't usefully narrow a variety list before
asking what should narrow it). Everything else keeps its previous
order: Variety → Planting technique → Cropping ID/Area/Spacing →
Soil & climate → Seed quantity → Notes.

`tsc --noEmit` clean, zero errors, after these changes.

---

## Own-seed narrowed to Binalonan-common varieties + searchable variety picker (this session)

Checked first whether there's any real basis for "varieties actually
grown in Binalonan" beyond a guess: there isn't. `Planting Data`,
`Harvest Data`, `Raw Data`, and `Corn Data` are all area/production/
yield aggregates by barangay-season-year with no variety column at
all, and `Crop Varieties` (the NSIC/PhilRice catalog wired up last
session) is a national reference list with no location tagging. So
rather than fabricate a "grown here" flag, **Farmer's own seed now
narrows to the original curated 5-per-crop list** (`PALAY_VARIETIES`/
`CORN_VARIETIES` — the same list this form always defaulted new
croppings to already) instead of the full ~40-per-crop national
catalog. **From DA** keeps drawing on the full catalog, narrowed by
seed type as built last session.

**`SearchableSelect.tsx`** (new, shared) — a type-to-filter combobox
replacing the plain `<select>` for variety in both `MyFarm.tsx` and
`Simulation.tsx`. Typing filters by name; the full list shows when
empty. Simulation's variety picker keeps its own unrelated behavior
unchanged — no seed-source concept, always every catalog variety for
the crop — this was only a widget swap there, not a narrowing change.

**Final-product preview** now differs by source: own-seed shows the
curated list's hand-written description (`VARIETY_PRODUCT_TYPE` —
e.g. "Aromatic / Fragrant Rice" for Mestizo 20); a DA catalog pick
shows a plainer `category, grain type` line (e.g. "Hybrid, Long
grain") since the catalog's `grain_type` column is coarse — every
palay row is "Long", every corn row is "Yellow/White" — so it can't
honestly support anything more specific than that.

Switching crop/seed-source/seed-type only ever reassigns the variety
field from a click handler (`bestVarietyFor`, keeps the current pick
when it's still valid in whichever pool applies, only falls back to
that pool's first entry when it isn't) — never from a mount-time
effect, so opening an existing record for editing never silently
rewrites its saved variety.

`tsc --noEmit` clean, zero errors, after these changes.

---

## Traditional variety and technique terms (this session)

Checked accuracy before changing anything — verified via web search
rather than assumed, since getting Filipino agricultural vocabulary
wrong in a real thesis project would be a real embarrassment, not a
minor bug.

**Planting techniques were already well-translated.** Both
`technique.wetDirectSeeding.name`/`technique.dryDirectSeeding.name`
and `technique.transplanting.name` already use accurate root
vocabulary in Tagalog (`pagtatanim`/`paglilipat-tanim`) and Ilocano
(`panagmula`, confirmed against multiple Ilocano dictionary sources —
`agmula`/`panagmula` is indeed the standard verb for "to plant").
What was missing: Transplanting already carries a "(Pindot)" folk-term
suffix across all three languages, but direct seeding didn't have its
equivalent. Added **"(Sabog-Tanim)"** to both Wet and Dry Direct
Seeding, in all three languages — confirmed via PhilRice's own
PalayCheck extension materials and a Pangasinan-specific news source
(Bombo Radyo Dagupan, on Pangasinan farmers adopting "sabog-tanim")
that this is the standard, widely-recognized Filipino term for the
broadcast-seeding method, not a guess.

**Varieties had no traditional/heirloom representation at all** —
every option, in both the curated "own seed" list and the national
NSIC catalog, was a modern certified/commercial name. That's a real
gap specifically for "Farmer's own seed," since heirloom varieties
passed down across generations are exactly what that category is
supposed to represent. Added, to both `MyFarm.tsx` and
`Simulation.tsx`'s lists:
- Palay: **Sinandomeng, Wagwag, Dinorado, Milagrosa** — still
  nationally recognized, still commonly traded/grown lowland
  varieties (confirmed via multiple independent sources, not just
  one), appropriate for a lowland rice municipality like Binalonan.
- Corn: **Lagkitan** (white glutinous/waxy corn) — an open-pollinated
  heirloom variety with active breeding programs in the Ilocos Region
  specifically (MMSU Glut 1), one of the two most widely grown native
  corn types in the country.

**Found and fixed a pre-existing labeling error along the way:**
`MyFarm.tsx` listed `"Mestizo (Traditional)"`, but `Simulation.tsx`
correctly labels the same real-world variety `"Mestizo 20 (Hybrid)"` —
Mestizo is SL Agritech's hybrid rice line, not traditional at all
(confirmed via search). Removed it from `MyFarm.tsx`'s curated
own-seed list — a hybrid doesn't really belong there anyway, since
hybrid seed generally can't be successfully re-saved by a farmer for
the next season (F2 yield degrades), which is the whole premise of
"Farmer's own seed." Left `Simulation.tsx`'s correctly-labeled entry
alone; it has no seed-source restriction to violate.

`tsc --noEmit` clean, zero errors, after these changes.

---

## Seed quantity/rate: Auto vs Custom toggle (this session)

`MyFarm.tsx`'s CroppingModal always auto-computed seed quantity and
rate-per-hectare from area × the standard rate for the crop/technique,
with both fields locked read-only — a farmer who genuinely knew their
own seeding rate (their own long-standing practice, a rate their
supplier recommended, etc.) had no way to enter it.

Added a switch next to the section header: **Auto-calculated**
(default for a new cropping) vs **Custom**. Auto behaves exactly as
before — recomputed live as area/crop/technique change. Flipping to
Custom unlocks both fields for direct editing and stops the
auto-recompute effect from touching them, starting from whatever was
last auto-computed so there's a sensible baseline to adjust from
rather than a blank field.

Existing records default to **Custom** when opened for editing —
never Auto — so opening an existing cropping never silently
recalculates and overwrites its real saved figures just because the
modal reopened. The farmer can still flip it back to Auto themselves
if they'd rather have it recalculated, and doing so recomputes
immediately (a deliberate click, same reasoning as the variety-reset
handlers built earlier this session).

Purely a frontend UX toggle — no new field was added to
`farm_input_log` or sent to the backend; the actual `quantity`/
`seedRate` values are already columns that exist and get saved
regardless of how they were arrived at.

`tsc --noEmit` clean, zero errors, after this change.

---

## Bug fix: editing a cropping could silently fail to save entirely (this session)

Traced the whole edit-save path end to end (`MyFarm.tsx`'s `save()` →
`store.tsx`'s `updatePrediction` → `api.updateFarmInput` →
`PredictionUpdateRequest` → `update_farm_input`) rather than guessing.

**Root cause:** `PredictionUpdateRequest.quantity` required `gt=0`
(strictly greater than zero), same as the *create* endpoint. But a
record can end up with `quantity: 0` without ever going through
creation's validation — an older/imported row with no quantity
recorded, or `store.tsx`'s `apiFarmToPrediction` defaulting a NULL
from the database to `0` for display (`f.quantity ?? 0`). Opening
such a record for editing and saving *any* change — even one
unrelated to quantity — re-sent that same `0`, which Pydantic
rejected outright with a 422. Since FastAPI rejects the whole request
before the handler function even runs, **nothing on the record saved
at all**, not just quantity — exactly "edit won't save."

Three-part fix:
- **`schemas.py`**: `PredictionUpdateRequest.quantity` relaxed to
  `ge=0` — editing a record with a missing/zero quantity must still
  be possible; `FarmInputRequest`'s creation-time `gt=0` is untouched,
  a brand-new cropping should still require a real quantity.
- **`MyFarm.tsx`'s `buildPayload()`**: quantity now falls back to `0`
  if unparseable, matching the pattern already used for spacing/seed
  rate, instead of silently sending `NaN` (which serializes to JSON
  `null`).
- **`croppingToForm`**: the seed-rate Auto/Custom toggle (built
  earlier this session) now starts in **Auto** specifically when the
  loaded quantity is `0` — rather than sitting in Custom mode showing
  a bare unexplained "0" the farmer would have to notice and fix by
  hand, opening such a record immediately computes a sensible value.
  Any record with a real recorded quantity still starts in Custom,
  exactly as before.

**Not changed, flagged for awareness:** both `addPrediction` and
`updatePrediction` use an optimistic-UI pattern — the success toast
fires and the modal closes immediately, before the backend request
actually resolves; a failure only surfaces via a separate, easy-to-miss
toast a moment later ("Edits saved locally, but couldn't reach the
server"). That pattern is consistent across create and edit and wasn't
the root cause here (the 422 above would have hit either path), so it
was left alone — but it does mean a *different* failure in the future
could look the same way this one did. Happy to make the edit path
wait for real confirmation before closing if that's wanted.

`python -m py_compile` / `tsc --noEmit` both clean after these changes.

---

## Bug fix: 4 barangays could never successfully save a field or cropping (this session)

Traced from the barangay heatmap showing "—" for Camangaan, Santa
Catalina, Mangcasuy, and Santa Maria Norte even after seeding real
data for them — this turned out to be a real submission-blocking bug,
not just a map display glitch.

**Root cause:** the app has *two* independent, both-legitimate spellings
for the same 4 barangays, and nothing reconciled them:
- The GADM administrative boundary file (`src/imports/
  Binalonan_Pangasinan_Barangays.json`) — which `data/binalonan.ts`'s
  `BARANGAY_DATA`/`BARANGAY_FACTS` keys are deliberately built to
  match — spells them **Camangaan** (one g), **Mangcasuy** (c),
  **SantaCatalina**, **SantaMariaNorte**.
- `yieldshield.barangay` (populated by `etl_load.py` from the
  Municipal Agriculture Office's own historical Central Data records)
  spells the same 4 places **Camanggaan** (double g), **Mangkasuy**
  (k), **Sta. Catalina**, **Sta. Maria Norte**.

`store.tsx`'s `keyToLabel()`/`labelToKey()` — the only place that
translates between the frontend's GADM-based key and whatever string
gets sent to/read from the backend — assumed a plain
space-insert/strip transform worked for every barangay ("every
barangay in this dataset round-trips cleanly," the old comment said).
For these 4, it doesn't: `keyToLabel("SantaCatalina")` produced
"Santa Catalina", which the backend's exact-match barangay resolver
has never recognized — it only knows "Sta. Catalina". Any farmer in
one of these 4 barangays got "Unknown barangay" trying to save a
field or cropping at all, not just a cosmetic map issue.

**Fix:** added an explicit 4-entry exception map in `store.tsx`,
checked before falling back to the generic transform, in both
directions. Also found and fixed the same bug's *third* independent
occurrence in `SeedDistribution.tsx`, which built its own barangay
dropdown from `BARANGAY_DATA` keys but sent them to the seed-distribution
endpoint without going through `keyToLabel()` at all, and normalized
records coming back from that API the same way `apiFarmToPrediction`/
`apiFieldToField` already do (`load()`, `quickMarkDistributed()`, and
both branches of the schedule modal's `save()`). Also fixed two stale
comments in `api.ts` referencing a `barangayKeyFromLabel()` function
that doesn't exist — it's `labelToKey()`.

**Not fixed, because it isn't fixable this way:** Poblacion, Santo
Niño, and Canarvacanan will still show "—" on the heatmap — see the
seed-script correction earlier this session for why: those 3 don't
exist anywhere in the underlying municipal dataset at all, in any
spelling, so there's no barangay_id for them to resolve to regardless
of what string gets sent.

`tsc --noEmit` clean, zero errors, after these changes.

---

## Added the 3 barangays genuinely missing from the historical dataset (this session)

Re-checked the "3 barangays still missing" report from scratch — a
broader search (partial matches, alternate spellings, every file in
the project, not just the one workbook) than the earlier pass, and it
confirmed the same conclusion even more thoroughly: Poblacion, Santo
Niño, and Canarvacanan simply aren't in the Municipal Agriculture
Office's historical dataset, in any form, anywhere.

Checked whether this was even safe to fix rather than just document,
since `backend/app/ml/features.py`'s `get_area_context()` already
falls back to a crop-wide average when a barangay has no
`yieldshield.crop_features` history, and `soil_type` just needs to
reuse a category the model already saw in training — meaning a real
farmer registering in one of these 3, not just the seed script, would
get a working prediction once the barangay itself exists.

**Migration 23** adds all 3 to `yieldshield.barangay`. Every value is
either real or clearly flagged as estimated, not invented outright:
- `land_size_ha` is **computed directly from each barangay's actual
  GADM polygon** (shoelace formula on a local equirectangular
  projection) — 140.89 / 105.66 / 185.91 ha respectively, not guesses.
- `soil_type`/`terrain_type`/`elevation_m_asl` use the municipal mode
  (Sandy Loam / Flat-Lowland / 30m — what 19-20 of the 21 known
  barangays actually are).
- `nearest_water_body` is left NULL rather than naming a specific
  river with no basis for it.
- Barangay names are spelled to match the frontend's existing
  GADM-based keys exactly, so — unlike the 4 fixed earlier this
  session — none of these 3 need a new `keyToLabel`/`labelToKey`
  exception entry; the generic space-insert transform already
  round-trips them correctly.

**The seed script** now includes all 24 barangays. The 3 new ones get
municipal-average yield/pH/moisture/rainfall/temperature (no
barangay-specific history to draw from instead) and irrigated/rainfed
hectares scaled from their real land area — except Poblacion, which
gets a deliberately reduced farmed-land share reflecting that it's the
town center, more built-up than a typical barangay, not a guess this
session invented from nothing but a reasonable adjustment to an
otherwise-real number.

**Still not fixed, and won't be by this migration alone:**
`yieldshield.crop_features` (the barangay-level irrigated/rainfed
ratios etc. actually used as *model training* features, distinct from
the reference table above) has no rows for these 3 either, and won't
until a real ETL run over real submitted data for them accumulates —
the crop-wide-average fallback in `get_area_context()` is a reasonable
stand-in until then, not a replacement for it.

`python -m py_compile` (seed script) clean after these changes.

---

## Root cause of "Santo Niño still not found": Unicode normalization, not spelling (this session)

After migration 23 supposedly added Santo Niño, it *still* showed
"not found in the barangay table" on its own — Poblacion and
Canarvacanan resolved fine. Checked the actual bytes rather than
guessing again: "ñ" has two different valid byte-level
representations — one composed codepoint (U+00F1), or "n" + a
separate combining-tilde mark (U+0303) — which look identical
on screen but are different strings. The seed script's `norm()`
function strips anything `isalnum()` doesn't recognize, and a bare
combining mark isn't alphanumeric — so under the decomposed form,
"Niño" silently collapses to "Nino" while the composed form keeps
its ñ, and the two no longer match. Confirmed the two files I wrote
were internally consistent (both NFC) — the mismatch happened
somewhere in between (a text editor, terminal, or psql client
re-encoding one of them differently is a well-known way this
happens), not something under this script's own control to prevent
by "just typing it correctly."

**Fixed at every layer that compares a barangay name, not just the
one that surfaced it:**
- **Seed script** (`load_barangays`'s `norm()`): now calls
  `unicodedata.normalize("NFC", s)` before the alphanumeric filter,
  so either byte form of "ñ" produces the same normalized string.
- **`store.tsx`'s `labelToKey`**: same fix, `.normalize("NFC")` on
  whatever the backend sends before comparing — this exact failure
  mode could otherwise resurface silently in the live app for any
  accented barangay name, not just during seeding.
- **Backend** (`farm_input.py`/`seed_distribution.py`'s barangay
  resolvers, and the seed-distribution list endpoint's barangay
  filter): switched from a plain `=` to Postgres's own
  `normalize(col, NFC) = normalize(%s, NFC)`, so a real farmer's
  submission can't fail the same way depending on which form Postgres
  happens to have stored.
- **Migration 24**: normalizes any already-stored `barangay_name`
  values to NFC directly, fixing the specific inconsistency already
  sitting in the database, on top of making future comparisons robust
  regardless of it. Safe to re-run — a no-op once everything's already
  NFC.

`python -m py_compile` (backend + seed script) / `tsc --noEmit` all
clean after these changes.

---

## "Santo Niño" still failing after the NFC fix — the real cause was mojibake, not just NFC/NFD (this session)

The NFC-normalization fix (previous entry) was correct as far as it
went — verified it in isolation again, byte by byte, and it does
correctly unify composed vs. decomposed "ñ". But NFC/NFD are both
just different *valid* ways to represent the *same* character. There's
a third, more common failure mode that neither one touches: mojibake
— UTF-8 bytes decoded as Latin-1 somewhere upstream (a terminal, an
editor, or a database client's `client_encoding` not actually
matching what got sent) turns "ñ" (2 UTF-8 bytes) into two entirely
different, individually-valid Latin-1 characters ("Ã" + "±"). That's
not a normalization-form difference — it's a different string, full
stop — so no amount of NFC/NFD normalizing was ever going to catch it.
Tested it directly: a simulated mojibake corruption failed to match
under both the NFC and the diacritic-folding comparisons.

**`load_barangays()` now tries three independent, increasingly
aggressive comparisons** before giving up on a name: NFC-normalize
(handles composed/decomposed forms), fold to a plain-ASCII skeleton
(handles a stray or differently-placed combining mark), and reverse a
one-hop Latin-1/UTF-8 mojibake round-trip (handles the actual
corruption above) — tried on both the script's own name and the
database's, since either side could in principle be the corrupted one.
Verified all 9 combinations of {NFC, NFD, mojibake} x {script-side,
db-side} now resolve correctly, not just the one combination that had
been reported.

**Also added real diagnostics** instead of another blind guess if this
somehow still doesn't resolve: any name that still fails to match now
prints its own exact Unicode codepoints alongside the codepoints of
the closest-looking row actually in the database, so a repeat of this
can be diagnosed from real evidence instead of theorized about a
fourth time.

`python -m py_compile` clean after these changes.

---

## Guaranteed corn representation instead of a 15% coin flip (this session)

Checked the actual, not just expected, outcome before changing
anything: simulated the script's exact RNG sequence and confirmed the
15%-per-farmer coin flip landed on corn for only 2 of 21 farmers with
this script's fixed seed — 4 croppings out of 42 total, too sparse to
meaningfully exercise anything corn-specific (the corn coordinator's
crop-locking, the corn variety picker, corn seed distribution,
corn-only report columns).

Replaced the coin flip with a fixed pattern — every 3rd farmer (by
barangay order) grows corn — guaranteeing exactly 7 of 21 regardless
of what else this script's shared RNG gets used for, now or in any
future edit to it. No more depending on how one particular random
seed happens to land.

Also added `crop` as a column in the script's own printed account
summary, so it's obvious at a glance which test accounts to sign in
as for corn-specific testing instead of having to query the database
to find out.

`python -m py_compile` clean after these changes.

---

## Admin Dashboard's All/Corn/Palay tab wasn't actually filtering everything (this session)

Checked every stat card, chart, and section against the tab's filter
state instead of assuming the tab worked — it partially did.
`avgYieldTHa`, `avgMoisture`, `yieldTrend`, and the recent-predictions
table already correctly read from `scopedPredictions` (the tab-filtered
list). Two things didn't:

- **`BarangayHeatMap`** took no props at all and read `predictions`
  straight from the global store — so switching to "Palay" still
  showed corn plots mixed into the same map, ranking, and "N
  predictions" count. It now accepts an optional `crop` prop and
  filters internally; `Dashboard.tsx` passes its `cropTab` through.
- **The "Farmers" stat card** (`farmerCount`) always showed the
  town's total registered-farmer count regardless of the tab. It now
  shows that total only for "All" — switching to "Palay"/"Corn" shows
  the count of *distinct farmers with at least one prediction in that
  crop*, which is what "Farmers" should mean once you've narrowed to
  one crop.
- Bonus, same underlying bug: the farmer-facing (non-admin) "My
  Plots" count used the same unfiltered list — fixed to use
  `scopedPredictions` too, so a farmer growing both crops gets an
  accurate plot count per tab as well.

Left alone, deliberately: the "Today's Recommendation" card (which
crop's better suited to *today's* weather) and `WeekPlan` ("What to
do this week") — both are forward-looking/task widgets rather than
"here's a stat about the currently-viewed scope," and don't fit the
same filtering semantics as the count/chart cards above.

`tsc --noEmit` clean, zero errors, after these changes.

---

## "Not all populated" on the Palay/Corn heatmaps: a real data-coverage gap, not a filter bug (this session)

Checked the two screenshots against the actual seeded data before
changing anything — this was **not** a bug in the crop-filter fix
from earlier this session. Every barangay has exactly one farmer
account, and (until now) that farmer grew exactly one crop. So
filtering the Dashboard to "Palay" correctly showed "—" for every
barangay whose farmer happened to grow corn instead, and vice versa —
the filter was working exactly as built, it was just working *on top
of* a dataset where each barangay could only ever have one crop's
worth of data to show. Confirmed directly: cross-referencing the two
screenshots' blank barangays showed zero overlap — every barangay
missing from the Palay map had real data on the Corn map and vice
versa, which is only possible if the underlying partition is strict.

**Fix:** every farmer now gets *two* fields — one growing palay, one
growing corn — each placed at the barangay's real centroid but offset
by roughly 150-250m from each other so they don't sit exactly on top
of one another on the map. This is a realistic model too, not just a
convenient one: diversified Filipino smallholders splitting land
between rice and corn is common practice, not an invented scenario to
paper over a data gap. `make_field`/`build_plots` were restructured
(`build_plots` now orchestrates both crops per farmer; the actual
per-field/per-season logic moved into a new `build_field_for_crop`),
and each cropping's plot code now includes a crop-initial (P/C) since
a farmer scoped to one plot-code-uniqueness domain now creates four
croppings instead of two.

Every barangay now has real, independently-generated data for both
crops — switching the Dashboard's tab between Palay and Corn should
show every barangay populated in both, not a complementary pair of
partial maps.

`python -m py_compile` clean after these changes.

---

## Added a second completed season per crop, for a real harvest history (this session)

Follow-up to the two-fields-per-farmer fix above. Every farmer already
had exactly one harvested cropping per crop (DS 2025-2026), but "one
past record" isn't much of a harvest history to test against — the
yield trend chart had only one data point per crop, and "Harvest
records" as a feature read oddly with nothing to actually list more
than once per crop per farmer.

Added a third season, **WS 2025** (planted Jun/Jul 2025, harvested
Oct/Nov 2025) — chronologically before the existing DS 2025-2026
season, also fully completed with a real recorded yield. Every farmer
now has, per crop: two harvested croppings (WS 2025, DS 2025-2026) and
one still-standing one (WS 2026) — 4 completed + 2 standing per farmer
across both crops, 126 croppings total across all 21 farmers (up from
84). `build_plots`/`build_field_for_crop`'s season windows and the
plot-code scheme already handled a third distinct season name without
further changes; the printed summary and Area Harvested testing
instructions now mention both completed windows.

`python -m py_compile` clean after these changes.

---

## Area Harvested report: a real bug, plus a likely date-window mix-up (this session)

Checked the actual report-generation code line by line rather than
assuming the seed data was the whole story — found one genuine bug,
and one likely non-bug that looks identical to one from the outside.

**Real bug, now fixed:** the "Harvest Area (Ha)" column (in both the
"ALL SEED TYPE" section and every seed-type-specific group) was
displaying `area_ha` — every planted row regardless of whether it's
been harvested — instead of `harvested_area_ha`, the subset that
actually has a recorded yield. That made Harvest Area show a real,
non-zero number while Ave. Yield/Prod'n right next to it correctly
came back blank for the exact same rows — looking exactly like "some
columns have data and some don't" from a single underlying mistake.
Fixed in the per-barangay rows, the per-seed-type breakdown, and the
TOTAL row; removed the now-dead `totals["area"]` tracking that this
report never actually needed (that concept belongs to the *Area
Planted* report, not this one).

**Likely non-bug, worth ruling out first:** the Reports modal's
default date window is "6 months back from today" — with the app's
current date, that lands around Feb-Aug 2026, which doesn't overlap
either of the seed script's two actually-harvested seasons (Jun-Aug
2025, Dec 2025-Jan 2026) — it only overlaps WS 2026, which is
deliberately still growing with no yield recorded yet. Asking for
"Area Harvested" over a window that only contains still-growing crops
is a *correct*, empty result, not a bug — it looks identical to a
broken report from the outside, though.

**Added a permanent safeguard either way:** both `build_area_planted_
workbook` and `build_area_harvested_workbook` now write a visible,
highlighted notice across the data area — instead of a silent blank
table — whenever the query genuinely finds zero matching croppings for
the given crop/ecosystem/date range, explicitly suggesting (for the
harvested report specifically) that the window needs to cover an
actually-harvested season. This isn't just for this one conversation —
a real Municipal Agriculture Office user hitting the same "picked a
window with nothing harvested in it yet" situation will now get a
clear explanation instead of a report that looks silently broken.

`python -m py_compile` clean after these changes.

---

## Reports panel: separate Area Planted / Area Harvested tabs, each auto-suggesting its own real date range (this session)

Direct follow-up to the "Harvest Area" bug fix above — rather than
just add a warning message after the fact, addressed the actual root
cause: the Reports panel's one shared date range defaulted to "6
months back from today" regardless of which report was being
generated, with a real chance of landing on a window that doesn't
overlap anything for "harvested" specifically (a window full of
still-growing crops is a correct, empty result, not a bug, but looks
identical to one).

**New `GET /reports/date-range?crop=...&kind=planted|harvested`**
returns the real min/max planting date for that crop — filtered to
only croppings with a recorded actual yield when `kind=harvested`, so
it's genuinely "the window this report would find something in," not
just "the window any data exists in."

**The Reports panel is now two tabs**, Area Planted and Area
Harvested, replacing the previous single form with two separate
download buttons at the bottom. Switching tabs (or changing the crop)
calls the new endpoint and auto-fills the date range to whatever
window that combination actually has data in — editable afterward,
so a narrower window is still one click away, but the starting point
is now real data rather than a guess. If a crop genuinely has no
matching data yet, a note says so directly instead of silently
leaving a default that won't work either.

`python -m py_compile` / `tsc --noEmit` both clean after these changes.

---

## Seed distribution schedules now notify farmers and post an announcement (this session)

Creating a seed distribution schedule previously only wrote the
`seed_distribution` row and an audit log entry — nothing told any
farmer it existed. Added both notification paths rather than picking
one, since they serve different audiences:

- **A personal notification** (category `task`, same as the "Care
  schedule updated" notice from earlier) to every farmer registered in
  the target barangay specifically — they're the ones who actually
  need to know to show up on the scheduled date. Also sent as a push
  notification, same pattern as `farm_input.py`'s pending-pushes list
  (collected during the transaction, sent after it commits).
- **A municipality-wide announcement**, tagged `schedule` (an existing
  tag the frontend already fully supports — no frontend changes needed
  at all), authored under the creating coordinator's real name, same
  as a manually-posted announcement. This stays visible in the general
  Announcements feed afterward, and reaches anyone interested even if
  their own barangay registration happens to be off.

Scoped to creation only, not edits to an existing schedule (changing
the date/quantity/status of an already-announced distribution doesn't
re-notify) — that's a reasonable follow-up if wanted, not implemented
here since it wasn't asked for.

`_notify` is duplicated into `seed_distribution.py` rather than
imported from `farm_input.py`, matching how `_resolve_barangay_and_crop`
is already duplicated the same way between the two routers.

`python -m py_compile` clean after these changes.

---

## Full-system audit — no new functional bugs found; cleaned up stale documentation (this session)

Went through the system deliberately looking for problems rather than
just reviewing the last change, checking:

- **Compile checks** — `py_compile` across every backend file (including
  `app/ml/`) and the seed script, `tsc --noEmit` across the whole
  frontend. All clean.
- **Migration consistency** — file numbering (01-24, no gaps/dupes),
  and specifically whether newly-added tables (`seed_distribution`,
  `crop_variety`) have RLS set up consistently with how the rest of the
  schema does it. `crop_variety` deliberately has no RLS at all — this
  matches `barangay`/`crop_type`/`planting_technique`, the other
  read-only reference tables, none of which have RLS either. Not an
  oversight.
- **RLS actually permitting the new notify-on-schedule feature** — the
  seed distribution notification writes a `notification` row for a
  *different* user (the farmer) than the one making the request (the
  coordinator). Checked the actual policy rather than assuming: it's
  `current_app_role() = 'Admin' OR user_id = current_app_user_id()`,
  and every caller of that endpoint is guaranteed `role = 'Admin'` by
  `require_admin_role()` before it can even run — so this was already
  correctly permitted, not something that needed a policy change.
- **`generate_activities()`'s crop-scoping** — confirmed the
  palay-only "is this transplanted?" check is nested inside `if crop
  == "Palay (Rice)"` and can't accidentally apply to corn regardless
  of what a corn technique's name happens to contain.
- **Barangay-key handling across every file that touches it** —
  `ManageUsers.tsx`, `Profile.tsx`, `Login.tsx`'s registration flow,
  `SeedDistribution.tsx` — all correctly round-trip through
  `keyToLabel`/`labelToKey` at the API boundary. No further instances
  of the bug fixed a few sessions back.
- **A real portability bug caught before it shipped**: the new seed-
  distribution notification used `strftime("%B %-d, %Y")` —
  `%-d` (no leading zero) is a Linux-only strftime extension that
  raises `ValueError` on Windows. Fixed to a portable f-string
  construction before this was ever reported, not after.

**Found and fixed: 6 stale comments** (across `AdminFarms.tsx`,
`store.tsx`, `api.ts` x2, `schemas.py` x2) still calling the Area
Planted report "Planting Status" — its name from before that rename
a few sessions back. No functional effect (comments only), but
misleading for anyone reading the code afterward, including a future
session of this same work.

No other functional bugs found in this pass.

---

## Clarified why the saved prediction can differ from the live preview while editing (this session)

Traced a real user report — "the prediction changes while editing but
doesn't change after saving" — all the way through rather than
guessing. Confirmed this is by-design, not a bug, but confusing UX
worth fixing anyway:

- **The "Live prediction" shown while typing** is `store.tsx`'s
  client-side heuristic (`score()`) — it reacts to everything: soil
  readings, planting date, ecosystem, seed source, variety, technique.
- **The prediction actually saved and displayed afterward** comes from
  `_score_submission()` → `predict_for_submission()` (the real trained
  model), whose function signature only ever takes barangay, crop, and
  planting date — confirmed by reading it directly, not assumed. It
  genuinely never sees ecosystem/seed source/variety/technique.
- Verified this isn't a stale-data bug either: the "latest prediction"
  query (`farms.py`) correctly orders by `date_generated DESC`, and
  the frontend correctly overwrites its optimistic client-side number
  with whatever the server actually returns once the save completes —
  editing *does* re-score against the real model every time, it just
  won't move for changes the real model was never built to weigh.

Added a plain-language note directly under the Live Prediction banner
in `MyFarm.tsx`'s cropping form (add and edit, not Simulation, which
never touches the real model at all) explaining this *before* saving,
rather than letting the number silently change afterward with no
explanation. This is the same "trained on barangay+season aggregates,
not individual-plot detail" scale limitation flagged earlier when the
crop_variety catalog was wired in — not a new gap, just one that
hadn't been surfaced to the person actually using the form yet.

`tsc --noEmit` clean after this change.

---

## Fixed: Calendar showing doubled activities after editing a cropping (this session)

Traced this to a real, specific gap rather than guessing at the cause.
The edit-triggered schedule recalculation (built a while back) deletes
only `auto_generated = TRUE, done = FALSE` rows before inserting the
new schedule. Migration 22 backfilled every row that existed *at that
moment* to TRUE — but any cropping schedule generated *after* that
migration ran and *before* the matching code change (`submit_farm_
input` explicitly setting `auto_generated = TRUE` on insert) was
actually deployed got the column's plain default instead: FALSE.
Editing one of those croppings later — on an otherwise fully
up-to-date deployment — runs the recalculation correctly, but its
DELETE step can't find those FALSE-flagged rows to remove, so the new
schedule lands *next to* the old one instead of replacing it. Ruled
out a frontend rendering bug first: every task list keys by the task's
actual database ID, so this is genuinely two separate rows, not a
render duplicate.

**Migration 25**, in two steps:
1. Retroactively flags any mislabeled row as `auto_generated = TRUE`
   by matching `generate_activities()`'s known, fixed task-text
   patterns (as prefixes, to account for its optional appended weather
   note) — these are specific agronomic phrases a hand-typed task
   wouldn't plausibly duplicate, so this is a safe way to identify them
   after the fact regardless of the flag's historical accuracy.
2. Removes the duplicates that gap already produced: every row one
   `generate_activities()` call inserts shares the exact same
   `created_at` (Postgres's `now()` is fixed per-transaction, not
   per-statement), so grouping by `(input_log_id, created_at)`
   reliably tells one generation batch from another — keeping only the
   most recent batch per cropping removes exactly the stale schedule.
   Completed tasks and hand-added ones are untouched either way.

This is a one-time historical gap, not an ongoing bug — every current
code path that creates these rows already sets the flag correctly.

---

## Follow-up: pinned down exactly why an edited prediction can look completely unchanged, even after reload (this session)

Direct follow-up to the "live preview differs from saved prediction"
explanation from earlier — the person reported a sharper version of
it: the number didn't change at all, even after a full page reload
(ruling out a stale-cache theory). Traced this to a specific,
verifiable mechanism instead of re-stating the earlier general
explanation:

`features.py`'s `get_climate_features()` looks up climate data by
**`(year, month_no)` only** — `WHERE cr.year = %s AND cr.month_no =
%s`. Two planting dates that fall in the same calendar month produce
*mathematically identical* climate inputs to the model, and since
ecosystem/seed source/variety/technique already don't factor in at
all (per the earlier finding), an edit that changes the day but not
the month is guaranteed to produce a byte-for-byte identical
prediction. That's the correct, unchanged output for that input — not
evidence the edit failed to save.

Also directly ruled out two genuine-bug candidates before landing on
this explanation: confirmed `yield_prediction` has no RLS at all (so
nothing could be silently blocking the INSERT for an admin editing on
behalf of a farmer), and re-read the entire `update_farm_input`
prediction-recalculation block end to end looking for a logic error —
found none; it correctly re-scores and re-inserts on every edit,
exactly as designed.

Updated the note added earlier in `MyFarm.tsx`'s cropping form to
name this precisely — "won't move ... for a planting date change that
stays within the same calendar month as before" — rather than leaving
it as a vaguer "may differ" caveat.

`tsc --noEmit` clean after this change.

---

## Investigated "cropping fields revert on reload" — two real fixes, one structural, one root-cause (this session)

This took a genuinely exhaustive investigation before landing anywhere,
specifically to avoid guessing: checked RLS on `farm_input_log` for a
farmer editing their own record (correctly permitted), checked every
DB-level CHECK constraint against what the API/frontend can actually
send (including specifically re-verifying "Farmer Saved Seeds" against
the `seed_type` constraint, since that exact category was added in a
later migration than the original constraint — it was correctly
updated), checked the request serialization path, and checked the ML
model's exception handling end to end. Found no single confirmed crash
that fully explains every report, but found two real, independently
worthwhile things to fix:

**1. Root-cause bug, confirmed against the actual deployed model
files, not assumed:** `_encode_categorical()` in `model.py` did
`set(spec["dummy_levels"])` and `for level in spec["dummy_levels"]`
directly. R's `jsonlite` auto-unboxes a length-1 character vector into
a bare JSON string instead of a 1-element array — and `crop_type`
(Corn/Palay) and `season_type` (DS/WS) are both binary, so their
"non-reference levels" list is exactly length 1. Loaded the actual
`feature_manifest.json`/`rf_trees.json` from `backend/app/ml/artifacts/`
and confirmed directly: `dummy_levels` for `crop_type` is the bare
string `"Palay"`, not `["Palay"]` — meaning the old code iterated it
character-by-character (`'P'`, `'a'`, `'l'`, `'y'`), producing
`crop_type.P`/`crop_type.a`/etc. instead of `crop_type.Palay`. Cross-
checked all 500 trees' actual feature references against this and
found 177 nodes across the forest referencing `crop_type.Palay` or
`season_type.WS` — features the old code could never produce. Every
Palay or Wet-Season prediction therefore (a) always encoded crop/
season as their reference values regardless of the real input, and
(b) always triggered the "unseen category" confidence penalty (-20)
it was never supposed to. This is very likely a real contributor to
the noticeably-lower confidence scores observed earlier this session.
Fixed by normalizing a bare string to a 1-element list before use, and
verified against the real deployed files that this brings all 177
mismatches to zero.

**2. Structural fix, regardless of whichever failure caused any one
report:** `updatePrediction` (store.tsx) applied its optimistic local
update and returned immediately, with the actual server save happening
in the background — a real failure only ever surfaced as an easy-to-
miss toast a moment later, with the edited values staying on screen as
if nothing had gone wrong until the next reload silently revealed the
server never received it. This was flagged as a known risk several
sessions ago and left as-is at the time; this report is what that risk
predicted. `updatePrediction` now returns a Promise: the optimistic
update still applies instantly for responsive UI, but a save failure
now rolls the on-screen values back to the last confirmed-good state
and rejects the Promise. `MyFarm.tsx`'s save() now awaits it — success
closes the modal as before; failure keeps the modal open with a real,
specific error instead of quietly closing as if it worked. Checked:
`updatePrediction` had exactly one call site, so this is a fully
contained change.

`python -m py_compile` / `tsc --noEmit` both clean after these changes.

---

## Polished the seed quantity/rate section's visual design (this session)

Purely a UI polish pass on the Auto/Custom toggle section built a
few sessions back — no behavior changes.

What was off: the section label stayed "Seed qty (auto)" even in
Custom mode (stale/contradictory), the Auto/Custom indicator was a
plain text label sitting loosely next to the switch rather than
reading as one control, and the 3-column layout put a permanently-
disabled "Unit" box (always just "kg") between two active,
editable ones — visually uneven and not doing much work for a value
that never changes.

Changed to a 2-column layout: each field now shows its unit as an
inline suffix inside the input itself ("40 kg", "40 kg/ha") — a
standard, more compact pattern for a fixed unit — and the Auto/Custom
indicator is now one cohesive pill (colored background, state text,
and the switch together) instead of two separate elements side by
side. The section label is now state-agnostic ("Seed quantity"),
correct whether it's currently Auto or Custom.

`tsc --noEmit` clean after this change.

---

## A field's remaining area is now tracked across all its active croppings (this session)

Previously, the cropped-area cap only ever checked a single cropping
against the field's *total* size — a field could have an active
cropping already using its entire area, and the form would still
happily let you add another cropping for the same full area again,
double-counting the same physical land.

**Now:** area is capped against what's actually still free — the
field's total minus every *other* still-growing cropping on it
(anything with no recorded actual yield yet; a harvested cropping's
land is correctly treated as free again for the next planting).
Editing an existing cropping excludes that cropping's own current area
from the calculation, so opening Edit never makes the field look
smaller than it actually is.

- The area input clamps live as you type, same pattern as the
  existing field-size cap it replaces.
- A field with zero space left shows the input disabled with a clear
  red explanation instead of a puzzling "why can't I type here."
- A field with some space left shows exactly how much ("1.2 of 2.0 ha
  still free on Bued Ricefield").
- Save is validated against the same number either way, so this can't
  be bypassed by typing past what the UI suggests.

Simulation mode is untouched — it never actually claims field area in
the first place, so nothing about it should be capped by this.

`tsc --noEmit` clean after these changes.

---

## Stopped users before opening the form, not just inside it, when a field has no space left (this session)

Direct follow-up to the field-area-occupancy fix above — moved the
block earlier in the flow, and found a third place it needed to apply
that wasn't obvious from MyFarm.tsx alone.

Extracted the "how much of this field is actually still free" rule
into one shared function (`remainingFieldArea` in store.tsx) instead
of leaving it duplicated, since it turned out to be needed in three
places, not the one:

- **MyFarm.tsx's field-detail "Add Cropping" button** — now disabled
  outright (grayed out, with a hover tooltip explaining why) instead
  of opening the form only to immediately reject you, with a visible
  banner underneath spelling out the same reason.
- **AdminFarms.tsx's on-behalf-of field picker** — a field with no
  space left now shows a "Full" badge and can't be selected from the
  list at all, same reasoning, since this is a second, independent
  entry point into the exact same form that the first fix alone
  wouldn't have covered.
- The CroppingModal's own in-form cap (from the previous fix) is
  unchanged and still there as a second layer — e.g. for the case
  where a field goes from "some space" to "no space" while the form
  happens to already be open in another tab.

The "no croppings yet" empty-state button doesn't need this: a field
with zero croppings has zero occupied area by definition, so it can
never actually be full.

`tsc --noEmit` clean after these changes.

---

## Fixed a real CSS bug in the redesigned seed-rate toggle (this session)

The pill redesign from last session had a genuine sizing bug: the
thumb circle (`h-4 w-4`, 16px) was exactly as tall as its own track
(`h-4`, 16px) — with the `top-0.5` offset applied on top of that, it
had nowhere to actually fit, so it rendered pinched/overflowing
instead of sitting cleanly inside the track.

Rebuilt using the exact same proportions as the original, larger
toggle switch (proven to render correctly): a 36x20px track with a
16px thumb, 2px of padding on every side in both positions — verified
this precisely, not just eyeballed, since "proportions look about
right" was exactly what produced the bug the first time. The pill
wrapper's padding was bumped up slightly to comfortably fit this
correctly-proportioned control instead of the undersized one from the
previous version.

`tsc --noEmit` clean after this change.

---

## Checked the Crop Varieties sheet thoroughly, wired in a genuine new factor, corrected a stale assumption (this session)

Went back and pulled every column from `binalonan_crop_data4.xlsx`'s
"Crop Varieties" sheet directly, rather than relying on what I'd
extracted from it several sessions ago. It has more than
`maturity_days`/`category`: `average_yield_t_ha`, `maximum_yield_t_ha`,
`recommended_ecosystem`, `grain_type`, `drought_tolerance`,
`flood_tolerance`, `disease_resistance`, `source`.

**Important honest finding, checked rather than assumed:** within
every (crop, category) group — Palay Inbred, Palay Hybrid, Corn
Hybrid, Corn GM Hybrid, Corn OPV — every one of these columns is a
*constant*. "Rc160" and "Rc216" (both Palay Inbred) carry identical
average_yield_t_ha, maturity_days, and every other column. This sheet
differentiates by category, not by individual named variety, despite
appearing to be per-variety data. Also found `disease_resistance` is
literally "Varies" for every single row (zero information) and
`flood_tolerance` only differs by crop, not variety — neither is worth
surfacing as if it were meaningful per-variety detail.

**Already wired in, confirmed by reading the code, not assumed:**
`average_yield_t_ha` and `maturity_days` were already flowing through
to both the UI display and the actual yield heuristic
(`varietyAvgYieldTHa` in store.tsx's `score()`) — for DA-catalog
varieties specifically; own-seed/traditional varieties were never in
this catalog to begin with, so they still use the flat crop-generic
baseline.

**Newly wired in:** `recommended_ecosystem` was sitting completely
unused. Added a real, if modest (-8%), adjustment to the yield
heuristic when a selected DA-catalog variety's recommended ecosystem
genuinely conflicts with the ecosystem the cropping is actually set to
(an "Irrigated Lowland" variety grown rainfed, or vice versa) — a
real, documented agronomic risk the catalog itself was already
flagging but nothing used. Paired with a visible amber note in the
form explaining exactly why, so a lower number has a reason attached
instead of just appearing lower with no explanation.

**Also fixed in passing:** a stale comment on `score()` claiming
"there's no live ML model service in this build yet" — that was true
when this heuristic was written, but the real trained-model
integration (`_score_submission` in farm_input.py) has existed for a
while now; this heuristic is the *fallback* path, not the only path.

**Scope, stated plainly:** this only affects the client-side quick
estimate and its fallback role in `update_farm_input`. It does not
change what's feasible for the official trained Random Forest model —
that model's training data still has no per-variety/ecosystem-at-farm
information at all (see the previous session's finding: 874
barangay-season rows, barangay/soil/season/climate columns only), and
this sheet — being category-level, not variety-level, and living in
the deployment's reference catalog rather than the ML training
pipeline's own dataset — doesn't change that.

`tsc --noEmit` clean after these changes.

---

## New: Field Info panel with a map showing where the field was plotted (this session)

Checked the existing field-detail view first — it showed name, address
text, area, and notes, but nothing about *where* the field actually is:
no map, no coordinates, no visualization of the boundary a farmer may
have plotted corner-by-corner when the field was created.

Added an "info" icon next to the field name that opens a new **Field
Info** panel showing:
- **A map** of the field's actual recorded location — the plotted
  boundary polygon if one exists (satellite or street view, toggleable),
  falling back to a plain pin if only a single point was ever set, and a
  clear "no location recorded" state if neither exists. This is a new,
  deliberately lightweight, read-only component
  (`FieldLocationMap.tsx`) — the two existing map components
  (`MapPicker`, `FieldMapPlotter`) are both interactive *editing* tools
  (dragging pins, plotting corners) and would have needed to be forced
  into a fake read-only mode to reuse; a small dedicated viewer was the
  cleaner fit.
- Barangay, registered area, address, and cropping-period count.
- **The boundary's actual enclosed area**, computed from the plotted
  corners themselves (reusing `polygonAreaHa` from `lib/geo.ts`,
  already used by the plotting tool itself) — shown alongside the
  registered area with a flag if they meaningfully disagree, since a
  hand-typed estimate and an actually-plotted shape can legitimately
  differ, which is useful information rather than a bug to hide.
- Coordinates with a one-click copy button, when a location was set.

Scoped to `MyFarm.tsx`'s field-detail view specifically, where this
gap actually was — `AdminFarms.tsx` has its own, separately-designed
field list/table and wasn't touched; happy to extend this same panel
there too if wanted.

`tsc --noEmit` clean after these changes.

---

## Unit-conversion dropdown indicator + full filter audit (this session)

**Unit dropdowns** (`YieldValue`/`AreaValue`/`SeedRateValue` in
`UnitValue.tsx`, plus the standalone one in MyFarm.tsx's harvest-
recording form) used `appearance-none` to strip the native `<select>`
arrow, with nothing put in its place — so a value like "4.63 t/ha" gave
no visual hint that "t/ha" was actually clickable to switch units.
Added a small "⏷" next to every one of these, consistently, so every
unit-conversion control in the app now reads the same way at a glance.

**Filter audit:** went through every filter control in the app —
`AuditLog`'s category chips, `ManageUsers`'s role filter, `SeedDistribution`'s
barangay/status/crop filters, `Notifications`'s category and
announcement-tag filters, `AdminFarms`'s search/crop-scope filtering,
`Planning`'s priority filter, `Calendar`'s crop/field filters — checking
both that each one's state actually narrows the displayed list, and
that its option list matches the real underlying data type (a common
way filters look present but quietly do nothing). All of them checked
out correctly; no bug found in this pass. If something specific still
isn't behaving as expected, a concrete example (which screen, which
filter, what's expected vs. what's shown) would help track down
whatever this code-level review didn't surface.

`tsc --noEmit` clean after these changes.

---

## Extended Field Info to the admin field list too (this session)

Direct follow-up to the Field Info panel from last session — flagged
at the time that `AdminFarms.tsx` has its own, separately-built field
list and wasn't covered yet. Added the same info icon there now,
reusing the exact same modal rather than building a second one:

- Exported `FieldInfoModal` from `MyFarm.tsx` (it was a local,
  unexported function) and imported it into `AdminFarms.tsx` — one
  modal, two entry points, so the map/boundary-area/coordinates
  display can't drift out of sync between the farmer's own view and
  the admin's.
- Added the info icon to both row states in the admin's per-barangay
  field list: a field with no croppings filed yet, and a field with
  one or more. Each row's own click-to-expand/click-to-add-cropping
  behavior still works exactly as before — the info icon stops its
  click from bubbling up to that, rather than triggering both at once.
- Cropping count shown respects the same corn/palay coordinator
  scoping already used everywhere else in this view — a crop-locked
  admin sees the count for their own crop only, consistent with
  everything else they can see on that screen, not an
  under-count bug.

`tsc --noEmit` clean after these changes.

---

## Dedicated search-filter audit — 3 real bugs found and fixed (this session)

Checked every search input in the app specifically (different failure
modes than dropdown/tab filters) — `AdminFarms.tsx` (both its main list
and its on-behalf-of picker), `AuditLog.tsx`, `ManageUsers.tsx`,
`Planning.tsx`, and `SearchableSelect.tsx` (the variety/technique
picker). `ManageUsers.tsx` and both `AdminFarms.tsx` searches were
already correct — checked as a baseline before concluding anything.

**`AuditLog.tsx` and `Planning.tsx`** both trimmed the query only for
their "is this empty" check, not for the actual string used to match
against — so a search with an accidental leading/trailing space (a
stray space bar tap, or pasted text) needed that exact same space in
the same spot in the target text to match at all, silently missing
results it should have found. Fixed both to trim the same string
that's actually used for matching, same pattern `ManageUsers.tsx` and
`AdminFarms.tsx` already used correctly.

**`SearchableSelect.tsx`** (the variety/technique picker) only matched
against an option's bare name, never its subtitle — even though the
subtitle (category, grain type, maturity, e.g. "Hybrid · Yellow/White
grain") is visible text sitting right there in the open dropdown.
Typing "hybrid" to narrow down to hybrid varieties found nothing,
despite "Hybrid" being visibly displayed on multiple options. Now
matches against both.

`tsc --noEmit` clean after these changes.
