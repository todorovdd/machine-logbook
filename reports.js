// Generates the per-factory service-history report ("Справка") that gets
// downloaded as either an .xlsx workbook or a client-facing .pdf — meant to
// be sent to customers every 6 / 12 months summarizing what was done on
// each of their machines.
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { fmtDate } = require('./dateFmt');
const assets = require('./assets-bundled');

const STATUS_LABELS = ['В ремонт', 'Не се използва'];

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u',
  ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sht', ъ: 'a', ь: 'y', ю: 'yu', я: 'ya',
};

function asciiSlug(str) {
  const base = String(str).toLowerCase().split('')
    .map((ch) => (TRANSLIT[ch] !== undefined ? TRANSLIT[ch] : ch))
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'spravka';
}

function measurementsText(record, recordFieldDefs) {
  if (!record.custom_fields) return '';
  const parts = [];
  for (const f of recordFieldDefs) {
    const val = record.custom_fields[f.key];
    if (val === undefined || val === null || val === '') continue;
    const display = f.field_type === 'date' ? fmtDate(val) : val;
    parts.push(`${f.label}: ${display}`);
  }
  return parts.join(' · ');
}

function periodLabel(from, to) {
  if (!from && !to) return 'Целият период';
  if (from && to) return `Период: ${fmtDate(from)} – ${fmtDate(to)}`;
  if (from) return `Период: от ${fmtDate(from)}`;
  return `Период: до ${fmtDate(to)}`;
}

async function buildExcelReport({ factory, data, recordFieldDefs, machineFieldDefs }, from, to) {
  // "Продукт" is a machine-level custom field (defined by the admin in
  // Полета) — look up its key once so we can show its value right under
  // each machine's name, same as in the PDF report.
  const productFieldDef = (machineFieldDefs || []).find(
    (f) => f.label && f.label.trim().toLowerCase() === 'продукт'
  );

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Дигитален дневник';
  wb.created = new Date();
  const sheet = wb.addWorksheet('Справка');

  const LAST_COL = 'E'; // Дата, Извършено, Техник, Измервания, Бележки
  let r = 1;

  sheet.mergeCells(`A${r}:${LAST_COL}${r}`);
  sheet.getCell(`A${r}`).value = `Справка за обслужване — ${factory.name}`;
  sheet.getCell(`A${r}`).font = { bold: true, size: 14 };
  r++;

  sheet.mergeCells(`A${r}:${LAST_COL}${r}`);
  sheet.getCell(`A${r}`).value = periodLabel(from, to);
  sheet.getCell(`A${r}`).font = { italic: true, color: { argb: 'FF666666' } };
  r++;

  sheet.mergeCells(`A${r}:${LAST_COL}${r}`);
  sheet.getCell(`A${r}`).value = `Генерирано на: ${fmtDate(new Date().toISOString().slice(0, 10))}`;
  sheet.getCell(`A${r}`).font = { size: 9, color: { argb: 'FF999999' } };
  r += 2; // blank spacer row

  const headers = ['Дата', 'Извършено', 'Техник', 'Измервания', 'Бележки'];

  for (const { machine, records } of data) {
    sheet.mergeCells(`A${r}:${LAST_COL}${r}`);
    sheet.getCell(`A${r}`).value = machine.name;
    sheet.getCell(`A${r}`).font = { bold: true, size: 12, color: { argb: 'FF8A6D1E' } };
    r++;

    const metaBits = [];
    if (machine.model) metaBits.push(machine.model);
    if (machine.serial_number) metaBits.push('сериен №: ' + machine.serial_number);
    if (metaBits.length) {
      sheet.mergeCells(`A${r}:${LAST_COL}${r}`);
      sheet.getCell(`A${r}`).value = metaBits.join(' · ');
      sheet.getCell(`A${r}`).font = { italic: true, size: 9, color: { argb: 'FF777777' } };
      r++;
    }

    const productValue = productFieldDef && machine.custom_fields ? machine.custom_fields[productFieldDef.key] : null;
    if (productValue) {
      sheet.mergeCells(`A${r}:${LAST_COL}${r}`);
      sheet.getCell(`A${r}`).value = `Продукт: ${productValue}`;
      sheet.getCell(`A${r}`).font = { size: 9.5, color: { argb: 'FF555555' } };
      r++;
    }

    const headerRow = sheet.getRow(r);
    headers.forEach((h, i) => { headerRow.getCell(i + 1).value = h; });
    headerRow.font = { bold: true };
    headerRow.eachCell((c) => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
      c.border = { bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } } };
    });
    r++;

    if (!records.length) {
      sheet.mergeCells(`A${r}:${LAST_COL}${r}`);
      sheet.getCell(`A${r}`).value = 'Няма записи за периода';
      sheet.getCell(`A${r}`).font = { italic: true, color: { argb: 'FF999999' } };
      r++;
    } else {
      for (const rec of records) {
        const row = sheet.getRow(r);
        row.getCell(1).value = fmtDate(rec.service_date);
        row.getCell(2).value = rec.work_done || '';
        row.getCell(3).value = rec.technician || '';
        row.getCell(4).value = measurementsText(rec, recordFieldDefs);
        row.getCell(5).value = rec.notes || '';
        r++;
      }
    }
    r++; // blank spacer row before the next machine
  }

  sheet.getColumn(1).width = 14;
  sheet.getColumn(2).width = 28;
  sheet.getColumn(3).width = 20;
  sheet.getColumn(4).width = 32;
  sheet.getColumn(5).width = 36;
  [2, 4, 5].forEach((i) => { sheet.getColumn(i).alignment = { wrapText: true, vertical: 'top' }; });

  return wb.xlsx.writeBuffer();
}

function buildPdfReport({ factory, data, recordFieldDefs, machineFieldDefs }, from, to) {
  return new Promise((resolve, reject) => {
    try {
      // "Продукт" is a machine-level custom field (defined by the admin in
      // Полета) — look up its key once so we can show its value under each
      // machine's name in the report, if such a field exists.
      const productFieldDef = (machineFieldDefs || []).find(
        (f) => f.label && f.label.trim().toLowerCase() === 'продукт'
      );

      // font: null skips pdfkit's default eager load of Helvetica.afm from
      // disk at construction time — that file lives inside node_modules and
      // is never bundled into the Netlify Function (esbuild only bundles
      // code, not files read via fs.readFileSync at runtime), so leaving
      // the default in place would crash every PDF request in production
      // even though it works fine locally. We only ever use our own
      // embedded TTF fonts (registered below), so the standard fonts are
      // never needed.
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 50, bufferPages: true, font: null });
      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.registerFont('Regular', Buffer.from(assets.fontRegular, 'base64'));
      doc.registerFont('Bold', Buffer.from(assets.fontBold, 'base64'));
      const logo = Buffer.from(assets.logoPng, 'base64');
      doc.font('Regular');

      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const left = doc.page.margins.left;

      // ---- Header: logo + title block ----
      const logoW = 60;
      doc.image(logo, left, doc.y, { width: logoW });
      const textX = left + logoW + 16;
      const textW = pageWidth - logoW - 16;
      doc.font('Bold').fontSize(16).fillColor('#111111')
        .text('Справка за обслужване', textX, doc.y, { width: textW });
      doc.font('Bold').fontSize(13).fillColor('#8a6d1e')
        .text(factory.name, textX, doc.y, { width: textW });
      doc.font('Regular').fontSize(9).fillColor('#777777')
        .text(periodLabel(from, to), textX, doc.y, { width: textW });
      doc.font('Regular').fontSize(8).fillColor('#999999')
        .text(`Генерирано на: ${fmtDate(new Date().toISOString().slice(0, 10))}`, textX, doc.y, { width: textW });

      doc.y = Math.max(doc.y, doc.page.margins.top + 62);
      doc.moveDown(0.6);
      doc.moveTo(left, doc.y).lineTo(left + pageWidth, doc.y).strokeColor('#dddddd').lineWidth(1).stroke();
      doc.moveDown(1);

      // ---- Per-machine table ----
      const colWidths = { date: 65, work: 150, tech: 90, meas: 120 };
      colWidths.notes = pageWidth - colWidths.date - colWidths.work - colWidths.tech - colWidths.meas;
      const colLabels = ['Дата', 'Извършено', 'Техник', 'Измервания', 'Бележки'];
      const colKeys = ['date', 'work', 'tech', 'meas', 'notes'];

      function ensureSpace(height) {
        if (doc.y + height > doc.page.height - doc.page.margins.bottom) {
          doc.addPage();
          return true;
        }
        return false;
      }

      function drawTableHeader() {
        let cx = left;
        doc.font('Bold').fontSize(9).fillColor('#333333');
        const y = doc.y;
        colKeys.forEach((k, i) => {
          doc.text(colLabels[i], cx + 2, y, { width: colWidths[k] - 4 });
          cx += colWidths[k];
        });
        doc.y = y + 14;
        doc.moveTo(left, doc.y).lineTo(left + pageWidth, doc.y).strokeColor('#cccccc').lineWidth(0.5).stroke();
        doc.moveDown(0.4);
      }

      for (const { machine, records } of data) {
        ensureSpace(50);
        doc.font('Bold').fontSize(12).fillColor('#8a6d1e')
          .text(machine.name, left, doc.y, { width: pageWidth });
        const metaBits = [];
        if (machine.model) metaBits.push(machine.model);
        if (machine.serial_number) metaBits.push('сериен №: ' + machine.serial_number);
        if (metaBits.length) {
          doc.font('Regular').fontSize(9).fillColor('#777777')
            .text(metaBits.join(' · '), left, doc.y, { width: pageWidth });
        }
        const productValue = productFieldDef && machine.custom_fields ? machine.custom_fields[productFieldDef.key] : null;
        if (productValue) {
          doc.font('Regular').fontSize(9.5).fillColor('#555555')
            .text(`Продукт: ${productValue}`, left, doc.y, { width: pageWidth });
        }
        doc.moveDown(0.5);

        if (!records.length) {
          doc.font('Regular').fontSize(9.5).fillColor('#999999')
            .text('Няма записи за избрания период.', left, doc.y, { width: pageWidth });
          doc.moveDown(1.2);
          continue;
        }

        ensureSpace(24);
        drawTableHeader();

        for (const r of records) {
          const cellText = {
            date: fmtDate(r.service_date),
            work: STATUS_LABELS.includes(r.work_done) ? r.work_done : (r.work_done || ''),
            tech: r.technician || '',
            meas: measurementsText(r, recordFieldDefs),
            notes: r.notes || '',
          };
          doc.font('Regular').fontSize(9);
          const heights = colKeys.map((k) => doc.heightOfString(cellText[k] || '', { width: colWidths[k] - 4 }));
          const rowHeight = Math.max(...heights, 12) + 6;

          if (ensureSpace(rowHeight + 4)) {
            drawTableHeader();
          }

          const rowY = doc.y;
          let cx = left;
          doc.fillColor('#222222');
          colKeys.forEach((k) => {
            doc.text(cellText[k] || '', cx + 2, rowY, { width: colWidths[k] - 4 });
            cx += colWidths[k];
          });
          doc.y = rowY + rowHeight;
          doc.moveTo(left, doc.y - 2).lineTo(left + pageWidth, doc.y - 2)
            .strokeColor('#eeeeee').lineWidth(0.5).stroke();
        }
        doc.moveDown(1.3);
      }

      // ---- Footer page numbers ----
      // Drawing inside the bottom margin area normally triggers pdfkit's
      // automatic page-break logic (it thinks the content overflowed the
      // page), which would silently insert a blank extra page just to fit
      // the footer text. Temporarily zeroing the bottom margin during this
      // one text() call disables that check.
      const pageCount = doc.bufferedPageRange().count;
      const generatedOn = fmtDate(new Date().toISOString().slice(0, 10));
      for (let i = 0; i < pageCount; i++) {
        doc.switchToPage(i);
        const savedBottom = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        doc.font('Regular').fontSize(8).fillColor('#aaaaaa')
          .text(`Страница ${i + 1} от ${pageCount}  ·  Генерирано на: ${generatedOn}`, left, doc.page.height - savedBottom + 12, {
            width: pageWidth, align: 'center', lineBreak: false,
          });
        doc.page.margins.bottom = savedBottom;
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { buildExcelReport, buildPdfReport, asciiSlug };
