import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SPAN, MIN_SPAN, layout, maxSpan, centerOf, gesture } from "../scripts/app/map-view.mjs";

// A 40×30-cell scene on a 400×300 px viewport: when it fits, a cell is 10 px.
const view = { vw: 400, vh: 300, ratio: 40 / 30, cell: 1 / 40 };
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≉ ${b}`);

test("the widest zoom shows the whole map", () => {
  near(maxSpan(view.vw, view.vh, view.ratio, view.cell), 40);
  const box = layout({ ...view, span: Infinity, center: { x: 0.9, y: 0.1 } });
  assert.equal(box.fit, true);
  near(box.w, 400);
  near(box.h, 300);
  near(box.tx, 0);
  near(box.ty, 0);
});

test("a tall viewport fits the map by width and centers it vertically", () => {
  const box = layout({ ...view, vh: 600, span: Infinity, center: { x: 0.5, y: 0.5 } });
  near(box.w, 400);
  near(box.ty, 150);
});

test("zoomed in, the center point lands in the middle of the viewport", () => {
  const box = layout({ ...view, span: 10, center: { x: 0.5, y: 0.5 } });
  near(box.w, 1600);
  near(box.tx, 200 - 800);
  near(box.ty, 150 - 600);
  const c = centerOf({ ...view, ...box });
  near(c.x, 0.5);
  near(c.y, 0.5);
});

test("near an edge the map stops at the edge instead of showing past it", () => {
  const box = layout({ ...view, span: 10, center: { x: 0, y: 1 } });
  near(box.tx, 0);
  near(box.ty, 300 - box.h);
});

test("the default is the regular zoom and the span stays within bounds", () => {
  assert.equal(layout({ ...view, center: { x: 0.5, y: 0.5 } }).span, DEFAULT_SPAN);
  assert.equal(layout({ ...view, span: 1, center: { x: 0.5, y: 0.5 } }).span, MIN_SPAN);
  near(layout({ ...view, span: 500, center: { x: 0.5, y: 0.5 } }).span, 40);
});

test("a map smaller than the minimum zoom just fits", () => {
  const box = layout({ ...view, cell: 1 / 2, span: 10, center: { x: 0.5, y: 0.5 } });
  assert.equal(box.fit, true);
  near(box.w, 400);
});

test("a drag moves the map with the finger", () => {
  const box = { ...view, ...layout({ ...view, span: 10, center: { x: 0.5, y: 0.5 } }) };
  const { center, span } = gesture(box, { focal: { x: 100, y: 100 }, delta: { x: 160, y: 0 } });
  assert.equal(span, 10);
  near(center.x, 0.5 - 160 / 1600);
  near(center.y, 0.5);
});

test("a pinch keeps the point between the fingers where it is", () => {
  const box = { ...view, ...layout({ ...view, span: 10, center: { x: 0.5, y: 0.5 } }) };
  const focal = { x: 300, y: 80 };
  const under = { x: (focal.x - box.tx) / box.w, y: (focal.y - box.ty) / box.h };
  const { center, span } = gesture(box, { focal, span: 5 });
  const after = layout({ ...view, span, center });
  near(after.tx + under.x * after.w, focal.x);
  near(after.ty + under.y * after.h, focal.y);
});
