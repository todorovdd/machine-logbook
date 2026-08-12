// Dates are stored as ISO "YYYY-MM-DD" (needed by <input type="date"> and for
// correct chronological sorting), but displayed to the user in the Bulgarian
// "ДД.ММ.ГГГГ" format. Shared by the EJS templates (via app.js's render())
// and the Excel/PDF report generator (reports.js).
function fmtDate(iso) {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

module.exports = { fmtDate };
