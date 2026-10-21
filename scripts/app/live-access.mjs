import { MODULE_ID, SETTINGS } from "../constants.mjs";
import { getSetting } from "../settings.mjs";
import { qrTarget, newPassword, uniqueUserName } from "./live-data.mjs";
import { cardsPdf } from "./live-pdf.mjs";

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
      printCards: LiveAccessApp.#onPrintCards
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/live-access.hbs`, scrollable: [".fcp-la-list"] }
  };

  /** Characters the GM ticked; on first render, the ones that already have an account. */
  #selected = null;

  get loginUrl() {
    return String(getSetting(SETTINGS.LIVE_LOGIN_URL) ?? "").trim();
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
    this.#selected ??= new Set(actors.filter(a => this.#userFor(a)).map(a => a.id));
    return {
      liveOn: !!getSetting(SETTINGS.LIVE_DAY),
      direct: !!this.loginUrl,
      rows: actors.map(a => {
        const user = this.#userFor(a);
        return {
          id: a.id,
          name: a.name,
          img: a.img,
          folder: a.folder?.name ?? "",
          user: user?.name ?? null,
          active: !!user?.active,
          checked: this.#selected.has(a.id)
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
    if (loginUrl) {
      const ok = await DialogV2.confirm({
        window: { title: game.i18n.localize("FCP.Live.Print") },
        content: `<p>${game.i18n.localize("FCP.Live.NewPasswordsWarning")}</p>`,
        rejectClose: false
      });
      if (!ok) return;
    }
    const { default: qrcode } = await import("../vendor/qrcode.mjs");
    const joinUrl = new URL(foundry.utils.getRoute("join"), window.location.origin).href;
    const host = new URL(joinUrl).host;
    const cards = [];
    for (const { actor, user } of rows) {
      let password = null;
      if (loginUrl) {
        password = newPassword();
        await user.update({ password });
      }
      const qr = qrcode(0, "M");
      qr.addData(qrTarget({ loginUrl, joinUrl, userId: user.id, password }));
      qr.make();
      const note = loginUrl
        ? game.i18n.localize("FCP.Live.CardDirect")
        : game.i18n.format("FCP.Live.CardJoin", { host, name: user.name });
      cards.push({ name: actor.name, note, qr: { count: qr.getModuleCount(), isDark: (r, c) => qr.isDark(r, c) } });
    }
    const pdf = cardsPdf(cards, { textWidth: measureText, title: game.i18n.localize("FCP.Live.Title") });
    const file = `${game.i18n.localize("FCP.Live.FileName")}-${game.world.id}.pdf`;
    foundry.utils.saveDataToFile(pdf, "application/pdf", file);
    ui.notifications.info(game.i18n.format("FCP.Live.Saved", { n: cards.length, file }));
  }
}

/** Arial has Helvetica's metrics, so the canvas measures what the PDF viewer will draw. */
let ctx = null;
function measureText(text, size, bold) {
  ctx ??= document.createElement("canvas").getContext("2d");
  ctx.font = `${bold ? "bold " : ""}${size}px Helvetica, Arial, sans-serif`;
  return ctx.measureText(text).width;
}
