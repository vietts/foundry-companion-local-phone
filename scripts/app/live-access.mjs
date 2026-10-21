import { MODULE_ID, SETTINGS } from "../constants.mjs";
import { getSetting } from "../settings.mjs";
import { qrTarget, newPassword, uniqueUserName } from "./live-data.mjs";

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

  /** One Player account per ticked character without one: named after the character, owner of it, no password. */
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
      const user = await User.create({ name, role: CONST.USER_ROLES.PLAYER, character: actor.id, password: "" });
      await actor.update({ [`ownership.${user.id}`]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER });
    }
    ui.notifications.info(game.i18n.format("FCP.Live.Created", { n: missing.length }));
    this.render();
  }

  /**
   * Printable cards, one per ticked character with an account.
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
    // Opened before the awaits below, while the click still counts as a user gesture for the popup blocker.
    const win = window.open("", "fcp-live-cards");
    if (!win) {
      ui.notifications.error("FCP.Live.PopupBlocked", { localize: true });
      return;
    }
    const { default: qrcode } = await import("../vendor/qrcode.mjs");
    const joinUrl = new URL(foundry.utils.getRoute("join"), window.location.origin).href;
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
      cards.push({ name: actor.name, user: user.name, svg: qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true }) });
    }
    win.document.open();
    win.document.write(cardsHtml(cards, { direct: !!loginUrl, host: new URL(joinUrl).host }));
    win.document.close();
    win.focus();
  }
}

const escape = s => foundry.utils.escapeHTML?.(s) ?? String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

function cardsHtml(cards, { direct, host }) {
  const loc = key => game.i18n.localize(key);
  const how = name => direct
    ? escape(loc("FCP.Live.CardDirect"))
    : escape(game.i18n.format("FCP.Live.CardJoin", { host, name }));
  const body = cards.map(c => `
    <article class="card">
      <h2>${escape(c.name)}</h2>
      <div class="qr">${c.svg}</div>
      <p>${how(c.user)}</p>
    </article>`).join("");
  return `<!doctype html><html lang="${escape(game.i18n.lang)}"><head><meta charset="utf-8">
<title>${escape(loc("FCP.Live.Title"))}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Georgia, "Times New Roman", serif; color: #2b241c; background: #fff; }
  .bar { padding: 12px 16px; font: 14px/1.4 system-ui, sans-serif; display: flex; gap: 12px; align-items: center; }
  .bar button { font: inherit; padding: 6px 14px; }
  .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8mm; padding: 0 16px 16px; }
  .card { border: 2px solid #2b241c; padding: 8mm 6mm; text-align: center; break-inside: avoid; }
  .card h2 { margin: 0 0 4mm; font-size: 22pt; }
  .qr svg { width: 62mm; height: 62mm; display: block; margin: 0 auto; }
  .card p { margin: 4mm 0 0; font-size: 11pt; }
  @media print { .bar { display: none; } .grid { padding: 0; } }
</style></head><body>
<div class="bar"><button onclick="window.print()">${escape(loc("FCP.Live.PrintNow"))}</button><span>${escape(game.i18n.format("FCP.Live.CardCount", { n: cards.length }))}</span></div>
<main class="grid">${body}</main>
</body></html>`;
}
