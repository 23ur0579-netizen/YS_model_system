import { Prediction } from "./store";

const labelizeBarangay = (b: string) => b.replace(/([a-z])([A-Z])/g, "$1 $2");

function csvCell(v: string | number | undefined | null): string {
  const s = v == null ? "" : String(v);
  // Escape quotes and wrap fields containing commas/quotes/newlines.
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Triggers a client-side download of the given text as a file.
function download(filename: string, text: string, mime = "text/csv;charset=utf-8;") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const COLUMNS: { header: string; get: (p: Prediction) => string | number }[] = [
  { header: "Plot ID", get: (p) => p.plotId },
  { header: "Farmer", get: (p) => p.farmer },
  { header: "Barangay", get: (p) => labelizeBarangay(p.barangay) },
  { header: "Crop", get: (p) => p.crop.replace(" (Rice)", "") },
  { header: "Area (ha)", get: (p) => p.area },
  { header: "Planting Date", get: (p) => p.plantingDate },
  { header: "Predicted Yield (t/ha)", get: (p) => p.predictedYield },
  { header: "Actual Yield (t/ha)", get: (p) => p.actualYield ?? "" },
  { header: "Confidence (%)", get: (p) => p.confidence },
  { header: "Harvest Date", get: (p) => p.harvestDate ?? "" },
];

// Opens a print-ready HTML page in a new tab for PDF saving / office printing.
export function exportPredictionsPDF(predictions: Prediction[], title = "YieldShield — Yield Prediction Report") {
  const stamp = new Date().toLocaleString("en-PH", { dateStyle: "long", timeStyle: "short" });
  const total = predictions.reduce((s, p) => s + p.area, 0);
  const avgYield = predictions.length
    ? (predictions.reduce((s, p) => s + (p.actualYield ?? p.predictedYield), 0) / predictions.length).toFixed(2)
    : "0";

  const rows = predictions.map((p) => {
    const barangay = labelizeBarangay(p.barangay);
    const crop = p.crop.replace(" (Rice)", "");
    return `
      <tr>
        <td>${p.plotId}</td>
        <td>${p.farmer}</td>
        <td>${barangay}</td>
        <td>${crop}</td>
        <td>${p.area}</td>
        <td>${p.plantingDate}</td>
        <td>${p.predictedYield}</td>
        <td>${p.actualYield ?? "—"}</td>
        <td>${p.confidence}%</td>
        <td>${p.harvestDate ?? "—"}</td>
      </tr>`;
  }).join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${title}</title>
<style>
  @page { size: A4 landscape; margin: 18mm 14mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "Segoe UI", Arial, sans-serif; font-size: 10pt; color: #1e293b; }
  header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 18px; border-bottom: 2px solid #10b981; padding-bottom: 10px; }
  header h1 { font-size: 15pt; color: #065f46; }
  header .meta { font-size: 8pt; color: #64748b; line-height: 1.6; text-align: right; }
  .summary { display: flex; gap: 20px; margin-bottom: 18px; }
  .stat { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 8px 14px; min-width: 120px; }
  .stat .label { font-size: 7.5pt; color: #64748b; text-transform: uppercase; letter-spacing: .04em; }
  .stat .value { font-size: 14pt; font-weight: 700; color: #065f46; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
  thead tr { background: #065f46; color: #fff; }
  thead th { padding: 6px 8px; text-align: left; font-weight: 600; white-space: nowrap; }
  tbody tr:nth-child(even) { background: #f8fafc; }
  tbody td { padding: 5px 8px; border-bottom: 1px solid #e2e8f0; vertical-align: middle; }
  footer { margin-top: 18px; font-size: 7.5pt; color: #94a3b8; text-align: center; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
<header>
  <div>
    <h1>YieldShield · Binalonan, Pangasinan</h1>
    <div style="font-size:9pt;color:#475569;margin-top:3px;">Municipal Agricultural Office — Yield Prediction Report</div>
  </div>
  <div class="meta">
    <div>Generated: ${stamp}</div>
    <div>${predictions.length} plot${predictions.length !== 1 ? "s" : ""} · ${total.toFixed(1)} ha total</div>
  </div>
</header>
<div class="summary">
  <div class="stat"><div class="label">Plots</div><div class="value">${predictions.length}</div></div>
  <div class="stat"><div class="label">Total area</div><div class="value">${total.toFixed(1)} ha</div></div>
  <div class="stat"><div class="label">Avg yield</div><div class="value">${avgYield} t/ha</div></div>
  <div class="stat"><div class="label">Harvested</div><div class="value">${predictions.filter((p) => p.actualYield != null).length}</div></div>
</div>
<table>
  <thead>
    <tr>
      <th>Plot ID</th><th>Farmer</th><th>Barangay</th><th>Crop</th>
      <th>Area (ha)</th><th>Planting Date</th>
      <th>Pred. Yield</th><th>Actual Yield</th><th>Confidence</th><th>Harvest Date</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>
<footer>YieldShield · Municipal Agricultural Office, Binalonan, Pangasinan · Confidential</footer>
<script>window.onload = () => { window.print(); };<\/script>
</body>
</html>`;

  const w = window.open("", "_blank");
  if (!w) { alert("Pop-up blocked — allow pop-ups for this site to export PDF."); return; }
  w.document.write(html);
  w.document.close();
}

// Exports a set of predictions as a CSV report, downloaded in the browser.
export function exportPredictionsCSV(predictions: Prediction[], filenamePrefix = "yieldshield-report") {
  const stamp = new Date().toISOString().slice(0, 10);
  const header = COLUMNS.map((c) => csvCell(c.header)).join(",");
  const rows = predictions.map((p) => COLUMNS.map((c) => csvCell(c.get(p))).join(","));
  const total = predictions.reduce((s, p) => s + p.area, 0);
  const avgYield = predictions.length
    ? (predictions.reduce((s, p) => s + (p.actualYield ?? p.predictedYield), 0) / predictions.length).toFixed(2)
    : "0";
  // Summary footer.
  const footer = [
    "",
    `Total plots,${predictions.length}`,
    `Total area (ha),${total.toFixed(1)}`,
    `Average yield (t/ha),${avgYield}`,
    `Generated,${new Date().toLocaleString("en-PH")}`,
  ];
  const csv = [header, ...rows, ...footer].join("\n");
  download(`${filenamePrefix}-${stamp}.csv`, csv);
}
