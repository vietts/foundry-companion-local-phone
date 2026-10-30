import { MODULE_ID, SETTINGS } from "../constants.mjs";
import { getSetting, setSetting } from "../settings.mjs";
import { qrTarget, newPassword, uniqueUserName } from "./live-data.mjs";
import { cardsPdf } from "./live-pdf.mjs";
import { showOnDisplay, hideFromDisplay } from "../live-display.mjs";

const { HandlebarsApplicationMixin, ApplicationV2, DialogV2 } = foundry.applications.api;

/**
 * Live day accesses: one account per pregen and a printable card with its QR code.
 * Opened from the module settings (GM only).
 */
export class LiveAccessApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "fcp-live-access",
    tag: "section",
    classes: ["fcp-live-access"],
    window: { title: "FCP.Live.Title", icon: "fa-solid fa-qrcode", resizable: true },
    position: { width: 520, height: "auto" },
    actions: {
      createAccounts: LiveAccessApp.#onCreateAccounts,
      printCards: LiveAccessApp.#onPrintCards,
      showOnDisplay: LiveAccessApp.#onShowOnDisplay,
      useLoginPage: LiveAccessApp.#onUseLoginPage,
      hideDisplay: LiveAccessApp.#onHideDisplay
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/live-access.hbs`, scrollable: [".fcp-la-list"] }
  };

  /**
   * Characters the GM ticked; on first render, those with an account nobody is using right now.
   * A new password ends the sessions of that account: reprinting one lost card must not log out the whole table.
   */
  #selected = null;

  /** User whose screen shows the QR codes: a non-GM without a character, chosen by the GM and remembered. */
  #displayId = getSetting(SETTINGS.LIVE_DISPLAY) || null;

  #displays() {
    return game.users.filter(u => !u.isGM && !u.character);
  }

  get loginUrl() {
    return String(getSetting(SETTINGS.LIVE_LOGIN_URL) ?? "").trim();
  }

  /** The usual place of the login page next to Foundry (tools/live-login). */
  static DEFAULT_LOGIN_PATH = "/accesso/";

  /** Whether the login page answers at its usual place: checked once per window, only when no address is set. */
  #probe = null;

  async #loginPageFound() {
    // Foundry answers unknown paths too (redirects, its own pages): only our page, recognised by its content, counts.
    this.#probe ??= fetch(new URL(LiveAccessApp.DEFAULT_LOGIN_PATH, window.location.origin), { cache: "no-store", credentials: "omit", redirect: "manual" })
      .then(async r => r.ok && (await r.text()).includes("Phone Companion"))
      .catch(() => false);
    return this.#probe;
  }

  #characters() {
    return game.actors.filter(a => a.type === "character")
      .sort((a, b) => (a.folder?.name ?? "").localeCompare(b.folder?.name ?? "") || a.name.localeCompare(b.name));
  }

  #userFor(actor) {
    return game.users.find(u => !u.isGM && u.character?.id === actor.id) ?? null;
  }

  async _prepareContext(options) {
    const actors = this.#characters();
    this.#selected ??= new Set(actors.filter(a => { const u = this.#userFor(a); return u && !u.active; }).map(a => a.id));
    const displays = this.#displays();
    if (!displays.some(u => u.id === this.#displayId)) this.#displayId = null;
    const liveOn = !!getSetting(SETTINGS.LIVE_DAY);
    const direct = !!this.loginUrl;
    return {
      // Without a login page the cards open Foundry's own join page: user list, password, warnings. Say it loudly.
      loginMissing: liveOn && !direct,
      loginFound: liveOn && !direct && await this.#loginPageFound(),
      loginPath: LiveAccessApp.DEFAULT_LOGIN_PATH,
      noDisplay: !this.#displayId,
      displays: displays.map(u => ({ id: u.id, name: u.name, active: u.active, selected: u.id === this.#displayId })),
      liveOn,
      direct,
      rows: actors.map(a => {
        const user = this.#userFor(a);
        return {
          id: a.id,
          name: a.name,
          img: a.img,
          folder: a.folder?.name ?? "",
          user: user?.name ?? null,
          active: !!user?.active,
          checked: this.#selected.has(a.id),
          // Showing a code changes the password: not for someone playing with that account right now.
          canShow: !!user && !user.active && !!this.#displayId
        };
      })
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    for (const box of this.element.querySelectorAll("input[name=actor]")) {
      box.addEventListener("change", () => {
        if (box.checked) this.#selected.add(box.value);
        else this.#selected.delete(box.value);
      });
    }
    this.element.querySelector("select[name=display]")?.addEventListener("change", async ev => {
      this.#displayId = ev.target.value || null;
      await setSetting(SETTINGS.LIVE_DISPLAY, this.#displayId ?? "");
      this.render();
    });
  }

  #selectedActors() {
    return this.#characters().filter(a => this.#selected.has(a.id));
  }

  /**
   * One Player account per ticked character without one: named after the character, owner of it.
   * With a login page the account gets a random password right away (the cards set a new one when printed):
   * Foundry's join page is on the internet, and a passwordless account there is open to anyone.
   */
  static async #onCreateAccounts() {
    const missing = this.#selectedActors().filter(a => !this.#userFor(a));
    if (!missing.length) {
      ui.notifications.info("FCP.Live.NothingToCreate", { localize: true });
      return;
    }
    const taken = new Set(game.users.map(u => u.name));
    for (const actor of missing) {
      const name = uniqueUserName(actor.name, taken);
      taken.add(name);
      const password = this.loginUrl ? newPassword() : "";
      const user = await User.create({ name, role: CONST.USER_ROLES.PLAYER, character: actor.id, password });
      await actor.update({ [`ownership.${user.id}`]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER });
    }
    ui.notifications.info(game.i18n.format("FCP.Live.Created", { n: missing.length }));
    this.render();
  }

  /**
   * A PDF with one card per ticked character with an account: name on top, QR below.
   * With a login page the QR carries a fresh password (older cards stop working); without, it opens the join page.
   */
  static async #onPrintCards() {
    const rows = this.#selectedActors().map(actor => ({ actor, user: this.#userFor(actor) })).filter(r => r.user);
    if (!rows.length) {
      ui.notifications.warn("FCP.Live.NoAccounts", { localize: true });
      return;
    }
    const loginUrl = this.loginUrl;
    if (!loginUrl && getSetting(SETTINGS.LIVE_DAY)) {
      const ok = await DialogV2.confirm({
        window: { title: game.i18n.localize("FCP.Live.Print") },
        content: `<p>${game.i18n.localize("FCP.Live.NoLoginPageConfirm")}</p>`,
        rejectClose: false
      });
      if (!ok) return;
    }
    if (loginUrl) {
      const playing = rows.filter(r => r.user.active).map(r => foundry.utils.escapeHTML(r.actor.name));
      let content = `<p>${game.i18n.localize("FCP.Live.NewPasswordsWarning")}</p>`;
      if (playing.length) content += `<p><strong>${game.i18n.format("FCP.Live.PlayingWarning", { n: playing.length, names: playing.join(", ") })}</strong></p>`;
      const ok = await DialogV2.confirm({
        window: { title: game.i18n.localize("FCP.Live.Print") },
        content,
        rejectClose: false
      });
      if (!ok) return;
    }
    // The PDF is built before any password changes: if it fails, the cards already on the table keep working.
    const issued = [];
    for (const { actor, user } of rows) issued.push({ actor, user, ...(await this.#makeQr(user)) });
    const build = list => cardsPdf(list.map(({ actor, note, qr }) => ({
      name: actor.name, note, qr: { count: qr.getModuleCount(), isDark: (r, c) => qr.isDark(r, c) }
    })), { textWidth: measureText, title: game.i18n.localize("FCP.Live.Title") });
    let pdf = build(issued);
    const done = [];
    for (const card of issued) {
      try {
        if (card.password !== null) await card.user.update({ password: card.password });
        done.push(card);
      } catch (err) {
        ui.notifications.error(game.i18n.format("FCP.Live.PasswordFailed", { name: card.actor.name }));
      }
    }
    if (!done.length) return;
    if (done.length !== issued.length) pdf = build(done);
    const file = `${game.i18n.localize("FCP.Live.FileName")}-${game.world.id}.pdf`;
    foundry.utils.saveDataToFile(pdf, "application/pdf", file);
    ui.notifications.info(game.i18n.format("FCP.Live.Saved", { n: done.length, file }));
  }

  /** The QR code that logs this user in, and with a login page the new password it carries (not set yet). */
  async #makeQr(user) {
    const loginUrl = this.loginUrl;
    const { default: qrcode } = await import("../vendor/qrcode.mjs");
    const joinUrl = new URL(foundry.utils.getRoute("join"), window.location.origin).href;
    const password = loginUrl ? newPassword() : null;
    const qr = qrcode(0, "M");
    const actor = user.character;
    qr.addData(qrTarget({ loginUrl, joinUrl, userId: user.id, password, name: actor?.name ?? user.name, img: actor?.img ?? "" }));
    qr.make();
    const note = loginUrl
      ? game.i18n.localize("FCP.Live.CardDirect")
      : game.i18n.format("FCP.Live.CardJoin", { host: new URL(joinUrl).host, name: user.name });
    return { qr, note, password };
  }

  /** A QR code with its password already set: any card or screen showing an older code for this user stops working. */
  async #issueQr(user) {
    const made = await this.#makeQr(user);
    if (made.password !== null) await user.update({ password: made.password });
    return made;
  }

  /** One character's QR, full screen on the display, until that character logs in or the GM hides it. */
  static async #onShowOnDisplay(event, target) {
    const actor = game.actors.get(target.dataset.actorId);
    const user = actor && this.#userFor(actor);
    if (!user || !this.#displayId) return;
    const display = game.users.get(this.#displayId);
    // Nobody would see it, and the password would change for nothing.
    if (!display?.active) {
      ui.notifications.warn(game.i18n.format("FCP.Live.ShownOffline", { name: actor.name, display: display?.name ?? "" }));
      return;
    }
    // A new code means a new password: the printed card of this character stops working.
    if (this.loginUrl) {
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: game.i18n.localize("FCP.Live.ShowOnDisplay") },
        content: `<p>${game.i18n.format("FCP.Live.ShowNewPassword", { name: foundry.utils.escapeHTML(actor.name) })}</p>`,
        rejectClose: false
      });
      if (!ok) return;
    }
    const { qr, note } = await this.#issueQr(user);
    const svg = qr.createSvgTag({ cellSize: 8, margin: 4, scalable: true });
    showOnDisplay(this.#displayId, {
      userId: user.id,
      name: actor.name,
      note,
      src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    });
    ui.notifications.info(game.i18n.format("FCP.Live.Shown", { name: actor.name, display: display.name }));
  }

  static async #onUseLoginPage() {
    await setSetting(SETTINGS.LIVE_LOGIN_URL, LiveAccessApp.DEFAULT_LOGIN_PATH);
    ui.notifications.info(game.i18n.format("FCP.Live.LoginPageSet", { path: LiveAccessApp.DEFAULT_LOGIN_PATH }));
    this.render();
  }

  static #onHideDisplay() {
    // After a reload of the GM's page the module no longer knows what is shown: ask the selected display anyway.
    hideFromDisplay(this.#displayId);
  }
}

/** Arial has Helvetica's metrics, so the canvas measures what the PDF viewer will draw. */
let ctx = null;
function measureText(text, size, bold) {
  ctx ??= document.createElement("canvas").getContext("2d");
  ctx.font = `${bold ? "bold " : ""}${size}px Helvetica, Arial, sans-serif`;
  return ctx.measureText(text).width;
}
