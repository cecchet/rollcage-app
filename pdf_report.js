// PDF report generator -- pure "data in, .pdf out" module, no knowledge of
// app.js's state/rules internals. app.js assembles a plain data object (see
// the shape documented above generate() below) and hands it here. Mirrors
// the report-writer pattern already proven in the sibling PassTech project
// (safety-gear-check/src/lib/pdfReport.ts): a running Y cursor,
// ensureSpace() for automatic page breaks, and small text/image helpers
// built on jsPDF (loaded from a CDN in index.html, window.jspdf.jsPDF).
(function () {
  "use strict";

  const MARGIN = 15;
  const PAGE_WIDTH = 210; // A4 mm
  const PAGE_HEIGHT = 297;
  const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

  const COLOR = {
    text: [30, 30, 30],
    muted: [110, 110, 110],
    faint: [150, 150, 150],
    accent: [37, 84, 179], // matches style.css's --accent
    green: [4, 120, 87],
    red: [185, 28, 28],
    amber: [161, 98, 7],
  };
  const TIER_COLOR = { green: COLOR.green, orange: COLOR.amber, red: COLOR.red };

  class PdfReportWriter {
    constructor() {
      this.doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4" });
      this.y = MARGIN;
    }

    ensureSpace(needed) {
      if (this.y + needed > PAGE_HEIGHT - MARGIN) {
        this.doc.addPage();
        this.y = MARGIN;
      }
    }

    newPage() {
      this.doc.addPage();
      this.y = MARGIN;
    }

    spacer(h) { this.y += h; }

    text(value, opts) {
      opts = opts || {};
      const size = opts.size || 10;
      const indent = opts.indent || 0;
      this.doc.setFont("helvetica", opts.bold ? "bold" : opts.italic ? "italic" : "normal");
      this.doc.setFontSize(size);
      this.doc.setTextColor.apply(this.doc, opts.color || COLOR.text);
      const maxWidth = CONTENT_WIDTH - indent;
      const lines = this.doc.splitTextToSize(String(value == null ? "" : value), maxWidth);
      const lineHeight = size * 0.42;
      this.ensureSpace(lines.length * lineHeight + 1);
      this.doc.text(lines, MARGIN + indent, this.y);
      this.y += lines.length * lineHeight;
    }

    // "Label: value" on one wrapped block, label bold -- the workhorse for
    // every captured element/answer in the report. jsPDF has no rich-text
    // run API, so the label is measured and written separately, then the
    // value is written starting right after it (falls back to its own line
    // if the label alone doesn't leave room, so a long label never clips).
    row(label, value, opts) {
      opts = opts || {};
      const size = opts.size || 9.5;
      const indent = opts.indent || 0;
      this.doc.setFont("helvetica", "bold");
      this.doc.setFontSize(size);
      const labelText = label + ": ";
      const labelWidth = this.doc.getTextWidth(labelText);
      const maxWidth = CONTENT_WIDTH - indent;
      if (labelWidth < maxWidth * 0.6) {
        this.ensureSpace(size * 0.42 * 2);
        this.doc.setTextColor.apply(this.doc, COLOR.text);
        this.doc.text(labelText, MARGIN + indent, this.y);
        this.doc.setFont("helvetica", "normal");
        const lines = this.doc.splitTextToSize(String(value == null || value === "" ? "--" : value), maxWidth - labelWidth);
        this.doc.setTextColor.apply(this.doc, opts.valueColor || COLOR.text);
        this.doc.text(lines, MARGIN + indent + labelWidth, this.y);
        const lineHeight = size * 0.42;
        this.y += Math.max(1, lines.length) * lineHeight;
      } else {
        this.text(label, { size, bold: true, indent });
        this.text(value == null || value === "" ? "--" : value, { size, indent: indent + 3, color: opts.valueColor });
      }
    }

    bullet(value, opts) {
      this.text("-  " + value, Object.assign({ indent: 3 }, opts));
    }

    heading(value) {
      this.ensureSpace(12);
      this.spacer(2);
      this.doc.setDrawColor.apply(this.doc, COLOR.accent);
      this.doc.setLineWidth(0.5);
      this.doc.line(MARGIN, this.y, PAGE_WIDTH - MARGIN, this.y);
      this.spacer(4);
      this.text(value, { size: 14, bold: true, color: COLOR.accent });
      this.spacer(2);
    }

    subheading(value) {
      this.spacer(2);
      this.text(value, { size: 11, bold: true, color: COLOR.text });
      this.spacer(0.5);
    }

    categoryLabel(value) {
      this.spacer(1.5);
      this.text(value.toUpperCase(), { size: 8.5, bold: true, color: COLOR.muted });
      this.spacer(0.5);
    }

    // Adds an image sized to fit within maxWidth x maxHeight, preserving its
    // own aspect ratio -- reads real pixel dimensions via jsPDF's own
    // getImageProperties rather than assuming a fixed size, since photos and
    // 3D-view captures each have different native aspect ratios. Wrapped in
    // try/catch so one photo jsPDF can't decode never aborts the whole
    // report (same defensive approach PassTech's pdfReport.ts uses).
    image(dataUrl, opts) {
      opts = opts || {};
      const maxWidth = opts.maxWidth || CONTENT_WIDTH;
      const maxHeight = opts.maxHeight || 90;
      let props;
      try {
        props = this.doc.getImageProperties(dataUrl);
      } catch (e) {
        return false;
      }
      let w = maxWidth;
      let h = (props.height / props.width) * w;
      if (h > maxHeight) { h = maxHeight; w = (props.width / props.height) * h; }
      this.ensureSpace(h + 3);
      try {
        this.doc.addImage(dataUrl, props.fileType || "JPEG", MARGIN, this.y, w, h);
      } catch (e) {
        return false;
      }
      this.y += h + 3;
      return true;
    }

    save(filename) {
      this.doc.save(filename);
    }
  }

  function renderCover(w, data) {
    w.text("Rollcage Inspection Report", { size: 20, bold: true, color: COLOR.accent });
    w.spacer(1);
    w.text("by Frog Racing", { size: 10, color: COLOR.muted });
    w.spacer(6);
    (data.vehicleLines || []).forEach((line) => w.row(line.label, line.value));
    w.spacer(2);
    const generatedLine = "Generated " + data.generatedAt + (data.buildNumber ? "  --  Build " + data.buildNumber : "");
    w.text(generatedLine, { size: 8.5, color: COLOR.faint, italic: true });
    if (data.vehiclePhotos && data.vehiclePhotos.length) {
      w.spacer(4);
      data.vehiclePhotos.forEach((p) => {
        w.subheading(p.label);
        w.image(p.dataUrl, { maxWidth: 120, maxHeight: 90 });
      });
    }
  }

  function renderAngleImages(w, angleImages) {
    if (!angleImages || !angleImages.length) return;
    w.newPage();
    w.heading("Rollcage 3D Model overview");
    angleImages.forEach((shot) => {
      w.subheading(shot.label);
      w.image(shot.dataUrl, { maxHeight: 95 });
    });
  }

  function renderCategoryRows(w, rows) {
    rows.forEach((row) => {
      if (row.kind === "table") {
        w.text(row.label, { size: 9.5, bold: true });
        if (!row.subRows.length) {
          w.text("No rows captured.", { size: 9, indent: 4, italic: true, color: COLOR.muted });
        } else {
          row.subRows.forEach((sub) => w.row(sub.label, sub.value, { size: 9, indent: 4 }));
        }
        w.spacer(1);
      } else {
        w.row(row.label, row.value);
      }
    });
  }

  function renderParts(w, parts) {
    parts.forEach((part) => {
      w.newPage();
      w.heading(part.phaseLabel);
      part.categories.forEach((cat) => {
        w.categoryLabel(cat.name);
        renderCategoryRows(w, cat.rows);
      });
    });
  }

  const LEVEL_COLOR = { pass: COLOR.green, fail: COLOR.red, warn: COLOR.amber };
  function renderLogbook(w, logbook) {
    if (!logbook) return;
    w.newPage();
    w.heading("Logbook / Compliance");
    w.text(logbook.verdictLabel, { size: 11, bold: true, color: LEVEL_COLOR[logbook.verdictLevel] || COLOR.text });
    if (logbook.verdictDetail) w.text(logbook.verdictDetail, { size: 9, color: COLOR.muted });
    w.spacer(2);
    w.row("Required items satisfied", logbook.requiredSatisfied + " / " + logbook.requiredTotal);
    if (logbook.failures && logbook.failures.length) {
      w.subheading("Failing");
      logbook.failures.forEach((f) => w.bullet(f, { color: COLOR.red }));
    }
    if (logbook.unresolved && logbook.unresolved.length) {
      w.subheading("Unresolved / needs verification");
      logbook.unresolved.forEach((f) => w.bullet(f, { color: COLOR.amber }));
    }
    if (logbook.advisories && logbook.advisories.length) {
      w.subheading("Advisories");
      logbook.advisories.forEach((f) => w.bullet(f, { color: COLOR.muted }));
    }
  }

  // categories: [{ categoryLabel, pictures: [{photoDataUrl, screenshotDataUrl, tags}] }],
  // already grouped and ordered by app.js's buildReportPictures to match
  // PICTURE_CATEGORIES' order (overview, main rollbar, backstay, roof,
  // doors) -- the same order the on-screen Pictures section uses.
  function renderPictures(w, categories) {
    if (!categories || !categories.length) return;
    w.newPage();
    w.heading("Pictures");
    categories.forEach((cat) => {
      w.categoryLabel(cat.categoryLabel);
      cat.pictures.forEach((pic, idx) => {
        w.subheading("Picture " + (idx + 1));
        if (pic.photoDataUrl) w.image(pic.photoDataUrl, { maxWidth: 90, maxHeight: 70 });
        if (pic.tags && pic.tags.length) {
          w.text("Tagged elements: " + pic.tags.join("; "), { size: 8.5, color: COLOR.muted });
        } else {
          w.text("No elements tagged.", { size: 8.5, italic: true, color: COLOR.faint });
        }
        if (pic.screenshotDataUrl) {
          w.text("Selected parts (3D):", { size: 8.5, color: COLOR.muted });
          w.image(pic.screenshotDataUrl, { maxWidth: 90, maxHeight: 60 });
        }
        w.spacer(3);
      });
    });
  }

  function renderSafetyScore(w, safetyScore) {
    if (!safetyScore) return;
    w.newPage();
    w.heading("Safety Score Assessment");
    w.text(
      "First-pass, provisional ratings (green/orange/red, worth 5/2/0 points) per a set of safety rules of thumb -- independent of any specific sanctioning body's requirements.",
      { size: 8.5, italic: true, color: COLOR.muted }
    );
    w.spacer(2);
    (safetyScore.rows || []).forEach((row) => {
      w.row(row.label, row.valueText + "  (" + (row.points > 0 ? "+" : "") + row.points + " pts)", { valueColor: TIER_COLOR[row.tier] || COLOR.text });
    });
    w.spacer(3);
    w.text(
      "Total: " + (safetyScore.totalPoints > 0 ? "+" : "") + safetyScore.totalPoints + " points across " + safetyScore.ratedRows + " rated item" + (safetyScore.ratedRows === 1 ? "" : "s"),
      { size: 12, bold: true, color: COLOR.accent }
    );
  }

  // logbookApplicationDetails is optional -- only the "Logbook application
  // PDF" button sets it (generateLogbookApplicationPdf in app.js); the
  // plain "PDF report" button leaves it out and this section is skipped.
  function renderLogbookApplicationDetails(w, lines) {
    if (!lines || !lines.length) return;
    w.newPage();
    w.heading("Logbook Application Details");
    lines.forEach((line) => w.row(line.label, line.value));
  }

  // homologationPhotos is optional -- only set (and only non-empty) when
  // the logbook application PDF was generated with homologation_route ===
  // "homologated" (see generateLogbookApplicationPdf in app.js).
  function renderHomologationPhotos(w, photos) {
    if (!photos || !photos.length) return;
    w.newPage();
    w.heading("Homologation Paperwork");
    photos.forEach((dataUrl, i) => {
      w.subheading("Page " + (i + 1));
      w.image(dataUrl, { maxHeight: 220 });
    });
  }

  // data: {
  //   filename, generatedAt, buildNumber, vehicleLines: [{label,value}],
  //   vehiclePhotos: [{label, dataUrl}],
  //   angleImages: [{label, dataUrl}],
  //   parts: [{ phaseLabel, categories: [{ name, rows: [
  //     {kind:"element", label, value} | {kind:"table", label, subRows:[{label,value}]}
  //   ]}]}],
  //   logbook: {verdictLabel, verdictDetail, verdictLevel, requiredTotal, requiredSatisfied, failures, unresolved, advisories} | null,
  //   pictures: [{ categoryLabel, pictures: [{photoDataUrl, screenshotDataUrl, tags}] }],
  //   safetyScore: {rows:[{label,valueText,tier,points}], totalPoints, ratedRows} | null,
  //   logbookApplicationDetails: [{label,value}] | undefined,
  //   homologationPhotos: [dataUrl] | undefined,
  // }
  function build(data) {
    const w = new PdfReportWriter();
    renderCover(w, data);
    renderAngleImages(w, data.angleImages);
    renderParts(w, data.parts || []);
    renderLogbook(w, data.logbook);
    renderPictures(w, data.pictures);
    renderSafetyScore(w, data.safetyScore);
    renderLogbookApplicationDetails(w, data.logbookApplicationDetails);
    renderHomologationPhotos(w, data.homologationPhotos);
    return w;
  }

  function generate(data) {
    build(data).save(data.filename || "rollcage-report.pdf");
  }

  window.PdfReport = {
    generate,
    // Same rendering as generate(), returning the raw PDF bytes instead of
    // triggering a browser download -- used by automated verification
    // (headless/sandboxed environments where a real download can't be
    // observed) rather than normal app usage.
    generateDataUri: (data) => build(data).doc.output("datauristring"),
  };
})();
