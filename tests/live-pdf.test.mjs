import { test } from "node:test";
import assert from "node:assert/strict";
import qrcode from "../scripts/vendor/qrcode.mjs";
import { cardsPdf } from "../scripts/app/live-pdf.mjs";

const card = (name, data = "https://vtt.example/accesso/#u=abc&p=xyz") => {
  const qr = qrcode(0, "M");
  qr.addData(data);
  qr.make();
  return { name, note: "Inquadra il QR", qr: { count: qr.getModuleCount(), isDark: (r, c) => qr.isDark(r, c) } };
};
const text = bytes => String.fromCharCode(...bytes);

test("cardsPdf puts six cards per page", () => {
  const pdf = text(cardsPdf(Array.from({ length: 7 }, (_, i) => card(`PG ${i}`))));
  assert.match(pdf, /^%PDF-1\.4/);
  assert.match(pdf, /\/Count 2 >>/);
  assert.match(pdf, /%%EOF\n$/);
});

test("cardsPdf xref offsets point at their objects", () => {
  const pdf = text(cardsPdf([card("Khari"), card("Pell")]));
  const xref = Number(pdf.match(/startxref\n(\d+)/)[1]);
  const entries = pdf.slice(xref).match(/^\d{10} 00000 n $/gm);
  entries.forEach((line, i) => assert.equal(pdf.slice(Number(line.slice(0, 10))).split("\n")[0], `${i + 1} 0 obj`));
});

test("cardsPdf escapes parentheses and keeps Latin-1 accents as single bytes", () => {
  const bytes = cardsPdf([card("Niccolò (il Rosso)")]);
  const pdf = text(bytes);
  assert.ok(pdf.includes("(Niccol\xF2 \\(il Rosso\\)) Tj"));
  assert.ok(bytes.every(b => b < 256));
});
