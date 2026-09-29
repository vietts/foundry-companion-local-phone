import { DEFAULT_SPAN, layout, centerOf, gesture } from "./map-view.mjs";

/** Movement (px) past which a touch is a drag and no longer a tap on the map. */
const DRAG_PX = 8;
const WHEEL_STEP = 1.15;

function place(map, box) {
  map.style.width = `${box.w}px`;
  map.style.height = `${box.h}px`;
  map.style.transform = `translate(${box.tx}px, ${box.ty}px)`;
}

function measure(pointers) {
  const pts = Array.from(pointers.values());
  const mid = { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
  const dist = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
  return { mid, dist };
}

/**
 * Zoom and pan of the phone map: follows the user's token, one finger drags, two fingers pinch, the wheel zooms.
 * The map part is rebuilt on every token move, so the state lives here and each new map is attached again.
 */
export class MapViewport {
  /** `follow`: keep the user's token in the middle. `center` (fractions) is used once the user has dragged. */
  state = { span: DEFAULT_SPAN, overview: false, follow: true, center: null };

  #wrap = null;
  #map = null;
  #observer = null;
  /** Last box applied, so a rebuilt map starts where the previous one was and glides to its new place. */
  #last = null;
  #lastMine = null;
  #pointers = new Map();
  #gesture = null;
  #dragged = false;

  attach(wrap) {
    if (!wrap) return this.detach();
    if (wrap === this.#wrap) return this.apply();
    this.#observer?.disconnect();
    this.#wrap = wrap;
    this.#map = wrap.querySelector(".fcp-minimap");
    this.#pointers.clear();
    this.#gesture = null;
    this.#dragged = false;
    if (!this.#map) return;
    wrap.classList.add("zoomable");
    wrap.addEventListener("pointerdown", this.#onDown);
    wrap.addEventListener("pointermove", this.#onMove);
    wrap.addEventListener("pointerup", this.#onUp);
    wrap.addEventListener("pointercancel", this.#onUp);
    wrap.addEventListener("click", this.#onClick, true);
    wrap.addEventListener("wheel", this.#onWheel, { passive: false });
    this.#observer = new ResizeObserver(() => this.apply());
    this.#observer.observe(wrap);
    this.apply({ glide: true });
  }

  detach() {
    this.#observer?.disconnect();
    this.#observer = null;
    this.#wrap = this.#map = null;
  }

  /** Back on the user's token, at the current zoom. */
  recenter() {
    this.state.follow = true;
    this.state.overview = false;
    this.apply();
  }

  /** The whole map, or back to the regular zoom around the token. */
  toggleOverview() {
    const s = this.state;
    if (this.#last?.fit) {
      s.overview = false;
      if (s.span >= this.#last.maxSpan) s.span = DEFAULT_SPAN;
      s.follow = true;
    } else {
      s.overview = true;
    }
    this.apply();
  }

  #box(center) {
    const wrap = this.#wrap;
    const map = this.#map;
    if (!wrap?.isConnected || !map) return null;
    const vw = wrap.clientWidth;
    const vh = wrap.clientHeight;
    const ratio = Number(map.dataset.ratio);
    const cell = Number(map.dataset.cell);
    if (!vw || !vh || !(ratio > 0) || !(cell > 0)) return null;
    const s = this.state;
    const focus = map.dataset.fx ? { x: Number(map.dataset.fx), y: Number(map.dataset.fy) } : { x: 0.5, y: 0.5 };
    center ??= s.follow || !s.center ? focus : s.center;
    const box = layout({ vw, vh, ratio, cell, span: s.overview ? Infinity : s.span, center });
    return { ...box, vw, vh, ratio, cell };
  }

  apply({ glide = false } = {}) {
    const box = this.#box();
    if (!box) return;
    const wrap = this.#wrap;
    const map = this.#map;
    const mine = map.querySelector(".fcp-mm-token.mine");
    const now = mine ? { id: mine.dataset.id, left: mine.style.left, top: mine.style.top } : null;
    const prev = this.#last;
    // A rebuilt map: put it (and the user's token) where the old one was, then let the transitions run.
    if (glide && prev && prev.vw === box.vw && prev.vh === box.vh && prev.ratio === box.ratio && prev.cell === box.cell) {
      wrap.classList.add("fcp-still");
      place(map, prev);
      if (now && this.#lastMine?.id === now.id) {
        mine.style.left = this.#lastMine.left;
        mine.style.top = this.#lastMine.top;
      }
      map.getBoundingClientRect();
      wrap.classList.remove("fcp-still");
      if (now) {
        mine.style.left = now.left;
        mine.style.top = now.top;
      }
    }
    place(map, box);
    this.#last = box;
    this.#lastMine = now;
    // Keep the dragged center within the map, so the next drag does not start from a point off screen.
    if (!this.state.follow) this.state.center = centerOf(box);
    wrap.classList.toggle("following", this.state.follow);
    wrap.classList.toggle("overview", box.fit);
  }

  /* Gestures */

  #start() {
    const { mid, dist } = measure(this.#pointers);
    return { box: this.#last, span: this.#last?.span, mid, dist };
  }

  #onDown = ev => {
    if (ev.pointerType === "mouse" && ev.button !== 0) return;
    if (!this.#pointers.size) this.#dragged = false;
    this.#pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    this.#gesture = this.#start();
  };

  #onMove = ev => {
    const p = this.#pointers.get(ev.pointerId);
    const g = this.#gesture;
    if (!p || !g?.box) return;
    p.x = ev.clientX;
    p.y = ev.clientY;
    const { mid, dist } = measure(this.#pointers);
    if (!this.#dragged) {
      if (Math.hypot(mid.x - g.mid.x, mid.y - g.mid.y) < DRAG_PX && Math.abs(dist - g.dist) < DRAG_PX) return;
      this.#dragged = true;
      this.#wrap.classList.add("fcp-still");
      // Captured only once it is a drag: a captured tap would not reach the map below as a click.
      try { this.#wrap.setPointerCapture(ev.pointerId); } catch (err) { /* already released */ }
    }
    const rect = this.#wrap.getBoundingClientRect();
    const focal = { x: g.mid.x - rect.left, y: g.mid.y - rect.top };
    // Fingers apart: fewer cells across the screen.
    const span = g.dist && dist ? g.span * (g.dist / dist) : g.span;
    const result = gesture(g.box, { focal, delta: { x: mid.x - g.mid.x, y: mid.y - g.mid.y }, span });
    Object.assign(this.state, { span: result.span, center: result.center, follow: false, overview: false });
    this.apply();
  };

  #onUp = ev => {
    if (!this.#pointers.delete(ev.pointerId)) return;
    // A finger lifted mid-pinch: carry on with the others from where the map is now.
    if (this.#pointers.size) this.#gesture = this.#start();
    else {
      this.#gesture = null;
      this.#wrap?.classList.remove("fcp-still");
    }
  };

  /** After a drag the finger comes up on the map: that is not a tap to move there. */
  #onClick = ev => {
    if (!this.#dragged) return;
    this.#dragged = false;
    ev.stopPropagation();
    ev.preventDefault();
  };

  #onWheel = ev => {
    const box = this.#last;
    if (!box || !ev.deltaY) return;
    ev.preventDefault();
    const rect = this.#wrap.getBoundingClientRect();
    const focal = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
    const span = box.span * (ev.deltaY > 0 ? WHEEL_STEP : 1 / WHEEL_STEP);
    const result = gesture(box, { focal, span });
    Object.assign(this.state, { span: result.span, center: result.center, follow: false, overview: false });
    this.apply();
  };
}
