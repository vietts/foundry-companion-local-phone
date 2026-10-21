/* QR cards as a PDF, written by hand: A4 pages, six cards each, QR drawn as filled squares. No Foundry globals. */

const PAGE = { w: 595.28, h: 841.89 };
const MARGIN = 28;
const GAP = 14;
const COLS = 2;
const ROWS = 3;
const QR_SIZE = 160;
/* Scanners want about four modules of white around the code: the name and the note keep their distance. */
const QR_TOP = 60;

/** PDF text with the standard fonts is WinAnsi: Latin-1 covers Italian and most names, anything else becomes "?". */
function pdfText(s) {
  return Array.from(String(s), ch => {
    const code = ch.charCodeAt(0);
    if (ch === "(" || ch === ")" || ch === "\\") return `\\${ch}`;
    if (code < 32 || code > 255 || ch.length > 1) return "?";
    return ch;
  }).join("");
}

const n = v => (Math.round(v * 100) / 100).toString();

/** Dark modules as rectangles, merging each row's horizontal runs. */
function qrRects(qr, x, y, size) {
  const count = qr.count;
  const cell = size / count;
  const ops = [];
  for (let r = 0; r < count; r++) {
    let c = 0;
    while (c < count) {
      if (!qr.isDark(r, c)) { c++; continue; }
      const start = c;
      while (c < count && qr.isDark(r, c)) c++;
      ops.push(`${n(x + start * cell)} ${n(y + size - (r + 1) * cell)} ${n((c - start) * cell)} ${n(cell)} re`);
    }
  }
  return ops.length ? `${ops.join("\n")}\nf` : "";
}

/**
 * @param {{name: string, note: string, qr: {count: number, isDark: (r: number, c: number) => boolean}}[]} cards
 * @param {{textWidth?: (text: string, size: number, bold: boolean) => number, title?: string}} [options]
 *   textWidth measures a string in points (for centering); without it the text is centered on an estimate.
 * @returns {Uint8Array}
 */
export function cardsPdf(cards, { textWidth, title = "QR" } = {}) {
  const width = textWidth ?? ((text, size, bold) => String(text).length * size * (bold ? 0.6 : 0.52));
  const cardW = (PAGE.w - 2 * MARGIN - (COLS - 1) * GAP) / COLS;
  const cardH = (PAGE.h - 2 * MARGIN - (ROWS - 1) * GAP) / ROWS;
  const perPage = COLS * ROWS;
  const pages = [];
  for (let i = 0; i < cards.length; i += perPage) pages.push(cards.slice(i, i + perPage));
  if (!pages.length) pages.push([]);

  const centered = (text, size, bold, cx, y) => {
    let s = size;
    // Long names shrink to fit the card instead of spilling over its border.
    while (s > 8 && width(text, s, bold) > cardW - 24) s -= 1;
    const x = cx - width(text, s, bold) / 2;
    return `BT /${bold ? "F2" : "F1"} ${s} Tf ${n(x)} ${n(y)} Td (${pdfText(text)}) Tj ET`;
  };

  const streams = pages.map(page => page.map((card, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x = MARGIN + col * (cardW + GAP);
    const top = PAGE.h - MARGIN - row * (cardH + GAP);
    const cx = x + cardW / 2;
    return [
      "0 g 1.5 w",
      `${n(x)} ${n(top - cardH)} ${n(cardW)} ${n(cardH)} re S`,
      centered(card.name, 20, true, cx, top - 34),
      qrRects(card.qr, cx - QR_SIZE / 2, top - QR_TOP - QR_SIZE, QR_SIZE),
      centered(card.note, 9, false, cx, top - QR_TOP - QR_SIZE - 24)
    ].join("\n");
  }).join("\n"));

  // Objects: 1 catalog, 2 pages, 3-4 fonts, 5 info, then a page + content pair per page.
  const objects = [];
  const pageIds = streams.map((_, i) => 6 + i * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  objects[5] = `<< /Title (${pdfText(title)}) /Producer (Phone Companion) >>`;
  streams.forEach((content, i) => {
    const id = pageIds[i];
    objects[id] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.w} ${PAGE.h}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${id + 1} 0 R >>`;
    objects[id + 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });

  let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // Every character is a single byte (pdfText keeps them under 256), so offsets above are byte offsets.
  return Uint8Array.from(out, ch => ch.charCodeAt(0));
}
