/* Zoom and pan of the phone map. Pure: no Foundry globals, no DOM. */

/**
 * The zoom is kept as the number of grid cells across the viewport width ("span"): it means the same on any
 * scene and any screen. Fewer cells = closer.
 */
export const DEFAULT_SPAN = 10;
export const MIN_SPAN = 5;

/** Size in px of the whole map when it fits the viewport. */
export function fitSize(vw, vh, ratio) {
  const w = Math.min(vw, vh * ratio);
  return { w, h: w / ratio };
}

/** Cells across the viewport width when the whole map fits: the widest zoom. `cell` is a cell's share of the map width. */
export function maxSpan(vw, vh, ratio, cell) {
  return vw / (fitSize(vw, vh, ratio).w * cell);
}

export function clampSpan(span, max) {
  return Math.min(Math.max(span, MIN_SPAN), max);
}

/** Offset of the map on one axis: centered when it fits, otherwise around `f` without showing past its edges. */
function offset(view, size, f) {
  if (size <= view) return (view - size) / 2;
  return Math.min(0, Math.max(view - size, view / 2 - f * size));
}

/**
 * Where the map goes in a viewport of `vw`×`vh` px: its size `w`×`h` and its offset `tx`,`ty`.
 * `center` is the map point (as a fraction of its width and height) to bring to the middle.
 */
export function layout({ vw, vh, ratio, cell, span, center }) {
  const max = maxSpan(vw, vh, ratio, cell);
  const s = clampSpan(span ?? DEFAULT_SPAN, max);
  const w = vw / (s * cell);
  const h = w / ratio;
  return {
    w, h,
    tx: offset(vw, w, center.x),
    ty: offset(vh, h, center.y),
    span: s,
    maxSpan: max,
    fit: s >= max - 1e-9
  };
}

/** The map point (fractions) at the middle of the viewport. */
export function centerOf({ vw, vh, w, h, tx, ty }) {
  return { x: (vw / 2 - tx) / w, y: (vh / 2 - ty) / h };
}

/**
 * Pan and pinch from a starting `box` (a layout plus `vw`, `vh`, `ratio`, `cell`): the map point under `focal`
 * (px in the viewport) ends under `focal + delta`, at the new `span`. Returns the clamped span and the new center.
 */
export function gesture(box, { focal, delta = { x: 0, y: 0 }, span = box.span }) {
  const s = clampSpan(span, box.maxSpan);
  const fx = (focal.x - box.tx) / box.w;
  const fy = (focal.y - box.ty) / box.h;
  const w = box.vw / (s * box.cell);
  const h = w / box.ratio;
  const tx = focal.x + delta.x - fx * w;
  const ty = focal.y + delta.y - fy * h;
  return { span: s, center: centerOf({ vw: box.vw, vh: box.vh, w, h, tx, ty }) };
}
