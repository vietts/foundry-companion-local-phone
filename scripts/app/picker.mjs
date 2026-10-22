/**
 * Phone picker for dnd5e choices.
 *
 * dnd5e asks every "pick from a list" through `CompendiumBrowser.select` / `selectOne`: spells and feats while
 * leveling up, the subclass, an item of a class. On a phone that two-column window does not fit, so while the
 * companion is open the same request opens this list instead. The rules stay the system's: the filters are
 * computed by a CompendiumBrowser that is never rendered, results come from `CompendiumBrowser.fetch`,
 * prerequisites from the caller's own validator, and the answer is the same (a Set of UUIDs, or null).
 */
import { MODULE_ID, log } from "../constants.mjs";

const t = key => game.i18n.localize(key);
const f = (key, data) => game.i18n.format(key, data);

/** Lowercase without accents, so "palla di fuoco" finds "Palla di Fuoco" and "invisibilita" finds "Invisibilità". */
const fold = s => String(s ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

const escape = s => foundry.utils.escapeHTML(String(s ?? ""));

let installed = false;

export function installPicker() {
  const CB = globalThis.dnd5e?.applications?.CompendiumBrowser;
  if (installed || !CB?.select) return;
  installed = true;
  const original = CB.select;
  CB.select = function(options = {}, renderOptions = {}) {
    const choosing = options.selection?.min || options.selection?.max;
    if (!document.body.classList.contains("fcp-active") || !choosing) return original.call(this, options, renderOptions);
    return pick(CB, options).catch(err => {
      console.error(`${MODULE_ID} | picker failed, falling back to the compendium browser`, err);
      return original.call(this, options, renderOptions);
    });
  };
  log("phone picker installed over CompendiumBrowser.select");
}

/** Same filters and results the compendium browser would show for these options. */
async function fetchEntries(CB, options) {
  const browser = new CB(options);
  const context = await browser._prepareContext({});
  const filters = CB.applyFilters(context.filterDefinitions, context.filters);
  if (context.filters.arbitrary?.length) filters.push(...context.filters.arbitrary);
  const { validate, fullDocuments } = browser.options.prerequisites;
  const entries = await CB.fetch(CONFIG[context.filters.documentClass].documentClass, {
    filters,
    types: context.filters.types,
    index: !(validate && fullDocuments),
    indexFields: new Set(["system.source", "system.level", "system.school", "system.type"])
  });
  // The companion's own requests can leave out what the character already has (e.g. spells in the book).
  const exclude = options.fcpExclude;
  const shown = exclude?.size ? entries.filter(e => !exclude.has(e.uuid.split(".").pop())) : entries;
  return { browser, entries: shown, documentClass: context.filters.documentClass };
}

/** Prerequisite check from the caller (e.g. a feat that needs Strength 13): disabled when invalid and enforced. */
function prerequisites(browser, entry) {
  const validate = browser.options.prerequisites.validate;
  const results = validate?.(entry);
  if (!results?.size) return null;
  const list = [...results.values()];
  const invalid = list.some(r => r.valid === false);
  return {
    disabled: invalid && browser.options.prerequisites.enforce,
    invalid,
    text: list.filter(r => r.quiet !== true || r.valid === false).map(r => r.label).join(", ")
  };
}

function subtitle(entry, documentClass) {
  if (entry.type === "spell") {
    const lvl = entry.system?.level;
    const school = CONFIG.DND5E.spellSchools?.[entry.system?.school]?.label;
    return [CONFIG.DND5E.spellLevels?.[lvl], school].filter(Boolean).join(" · ");
  }
  // Feats: their category (general, origin, fighting style, epic boon) says more than "feature".
  if (entry.type === "feat") {
    const type = entry.system?.type;
    const cfg = CONFIG.DND5E.featureTypes?.[type?.value];
    const label = cfg?.subtypes?.[type?.subtype] ?? cfg?.label;
    if (label) return t(label);
  }
  return CONFIG[documentClass]?.typeLabels?.[entry.type] ? t(CONFIG[documentClass].typeLabels[entry.type]) : "";
}

/** Spells are grouped by level (cantrips first); anything else is one alphabetical list. */
function groups(rows) {
  if (!rows.length || !rows.every(r => r.entry.type === "spell")) return [{ label: null, rows }];
  const byLevel = new Map();
  for (const r of rows) {
    const lvl = r.entry.system?.level ?? 0;
    if (!byLevel.has(lvl)) byLevel.set(lvl, []);
    byLevel.get(lvl).push(r);
  }
  return [...byLevel.entries()].sort((a, b) => a[0] - b[0])
    .map(([lvl, list]) => ({ label: CONFIG.DND5E.spellLevels?.[lvl] ?? String(lvl), rows: list }));
}

function pick(CB, options) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = value => {
      if (done) return;
      done = true;
      root.remove();
      resolve(value);
    };

    const root = document.createElement("section");
    root.id = "fcp-picker";
    root.innerHTML = `<p class="fcp-picker-loading">${escape(t("FCP.Picker.Loading"))}</p>`;
    document.body.append(root);

    fetchEntries(CB, options).then(({ browser, entries, documentClass }) => {
      const { min, max } = browser.options.selection;
      const selected = new Set();
      const rows = entries.map(entry => ({ entry, sub: subtitle(entry, documentClass), pre: prerequisites(browser, entry) }));
      // What the character cannot take yet (prerequisites) goes to the bottom, still visible as on the desktop.
      rows.sort((a, b) => Number(!!a.pre?.disabled) - Number(!!b.pre?.disabled));
      let query = "";

      const countText = () => {
        const n = selected.size;
        if (max === 1) return n ? t("FCP.Picker.OneChosen") : t("FCP.Picker.ChooseOne");
        if (max) return f("FCP.Picker.CountMax", { n, max });
        return f("FCP.Picker.Count", { n });
      };
      const valid = () => selected.size >= (min || 1) && selected.size <= (max || Infinity);

      const rowHtml = r => {
        const on = selected.has(r.entry.uuid);
        const dis = r.pre?.disabled;
        return `<li class="fcp-pk-row${on ? " on" : ""}${dis ? " disabled" : ""}" data-uuid="${escape(r.entry.uuid)}">
          <button type="button" class="fcp-pk-choose" data-pick ${dis ? "disabled" : ""} aria-pressed="${on}">
            <img src="${escape(r.entry.img)}" alt="">
            <span class="fcp-pk-text">
              <span class="fcp-pk-name">${escape(r.entry.name)}</span>
              ${r.sub ? `<span class="fcp-pk-sub">${escape(r.sub)}</span>` : ""}
              ${r.pre?.text ? `<span class="fcp-pk-pre${r.pre.invalid ? " bad" : ""}">${escape(r.pre.text)}</span>` : ""}
            </span>
            <span class="fcp-pk-check" aria-hidden="true">${on ? "✓" : ""}</span>
          </button>
          <button type="button" class="fcp-pk-info" data-info aria-label="${escape(t("FCP.Picker.Details"))}">i</button>
          <div class="fcp-pk-desc" hidden></div>
        </li>`;
      };

      const renderList = () => {
        const q = fold(query);
        const shown = q ? rows.filter(r => fold(r.entry.name).includes(q)) : rows;
        const list = root.querySelector(".fcp-pk-list");
        list.innerHTML = shown.length ? groups(shown).map(g =>
          (g.label ? `<h3 class="fcp-pk-group">${escape(g.label)}</h3>` : "") + `<ul>${g.rows.map(rowHtml).join("")}</ul>`
        ).join("") : `<p class="fcp-pk-empty">${escape(t("FCP.Picker.Empty"))}</p>`;
      };

      const renderFooter = () => {
        root.querySelector(".fcp-pk-count").textContent = countText();
        root.querySelector("[data-confirm]").disabled = !valid();
      };

      root.innerHTML = `
        <header class="fcp-pk-head">
          <div class="fcp-pk-title">
            <span class="fcp-pk-kicker">${escape(t("FCP.Picker.Kicker"))}</span>
            <h2>${escape(browser.options.hint ?? t("FCP.Picker.Title"))}</h2>
          </div>
          <input type="search" class="fcp-pk-search" placeholder="${escape(t("FCP.Picker.Search"))}" autocomplete="off">
        </header>
        <div class="fcp-pk-list"></div>
        <footer class="fcp-pk-foot">
          <span class="fcp-pk-count"></span>
          <button type="button" data-cancel>${escape(t("FCP.Picker.Cancel"))}</button>
          <button type="button" class="fcp-primary" data-confirm>${escape(t("FCP.Picker.Confirm"))}</button>
        </footer>`;
      renderList();
      renderFooter();

      root.querySelector(".fcp-pk-search").addEventListener("input", event => {
        query = event.target.value;
        renderList();
      });
      root.querySelector("[data-cancel]").addEventListener("click", () => finish(null));
      root.querySelector("[data-confirm]").addEventListener("click", () => {
        if (!valid()) return;
        Hooks.callAll("dnd5e.compendiumBrowserSelection", browser, selected);
        finish(new Set(selected));
      });
      root.querySelector(".fcp-pk-list").addEventListener("click", async event => {
        const li = event.target.closest("[data-uuid]");
        if (!li) return;
        const uuid = li.dataset.uuid;
        if (event.target.closest("[data-info]")) return toggleDescription(li, uuid);
        if (!event.target.closest("[data-pick]") || li.classList.contains("disabled")) return;
        if (selected.has(uuid)) selected.delete(uuid);
        else {
          if (max === 1) selected.clear();
          else if (max && selected.size >= max) return ui.notifications.warn(f("FCP.Picker.TooMany", { max }));
          selected.add(uuid);
        }
        // Only the touched rows change: re-rendering the whole list would jump the scroll.
        for (const row of root.querySelectorAll(".fcp-pk-row")) {
          const on = selected.has(row.dataset.uuid);
          row.classList.toggle("on", on);
          row.querySelector("[data-pick]").setAttribute("aria-pressed", on);
          row.querySelector(".fcp-pk-check").textContent = on ? "✓" : "";
        }
        renderFooter();
      });
    }).catch(err => {
      if (done) return;
      done = true;
      root.remove();
      reject(err);
    });
  });
}

async function toggleDescription(li, uuid) {
  const box = li.querySelector(".fcp-pk-desc");
  if (!box.hidden) { box.hidden = true; return; }
  box.hidden = false;
  if (box.dataset.loaded) return;
  box.textContent = t("FCP.Picker.Loading");
  const doc = await fromUuid(uuid);
  const TE = foundry.applications.ux.TextEditor.implementation;
  box.innerHTML = doc ? await TE.enrichHTML(doc.system?.description?.value ?? "", { relativeTo: doc }) : "";
  box.dataset.loaded = "1";
}
