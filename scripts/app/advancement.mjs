/**
 * dnd5e's level up window on the phone. The steps stay the system's (hit points, ASI or feat, features), so
 * nothing about the rules changes: the window just switches to dnd5e's own light theme, parchment like the
 * companion, and the CSS in companion.css makes it full width with bigger controls. Choices from a list
 * inside it (spells, feats, subclass) open the phone picker instead (picker.mjs).
 */
let installed = false;

export function installAdvancementTheme() {
  if (installed) return;
  installed = true;
  Hooks.on("renderAdvancementManager", (app, element) => {
    if (!document.body.classList.contains("fcp-active")) return;
    element.classList.remove("theme-dark");
    element.classList.add("themed", "theme-light", "fcp-advancement");
  });
}
