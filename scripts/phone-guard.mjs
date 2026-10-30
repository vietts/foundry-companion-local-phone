/*
 * On a phone the companion is the whole interface, but other modules still run there and open their own things:
 * Carolingian UI asks every client where to put Daggerheart's Fear tracker (and "yes" tries to change a world
 * setting), Daggerheart Quick Rules adds a floating "?" and a 1050 px window. A player who has never seen Foundry
 * is stuck in front of them. Windows are made to fit the screen by the CSS (body.fcp-active rules); this file
 * answers the questions that make no sense on a phone.
 */

/** Dialog titles (translation keys) answered "no" on a phone, with the button that means "leave things as they are". */
const ANSWER_NO = [
  "CRLNGN_UI.ui.dhFearDock.title",
  "CRLNGN_UI.ui.carouselWelcome.title"
];

/** Body classes other modules use to restyle Foundry's notices in ways a phone cannot read. */
const NOTICE_CLASSES = ["crlngn-compact-notifications"];

/**
 * Carolingian's compact notices are closed pills at the top: on a phone only a colour change showed, and a player
 * never read "not enough Hope" or "connection lost". In the companion the notices stay plain and readable.
 */
export function keepNoticesReadable() {
  const strip = () => {
    for (const cls of NOTICE_CLASSES) if (document.body.classList.contains(cls)) document.body.classList.remove(cls);
  };
  strip();
  new MutationObserver(strip).observe(document.body, { attributes: true, attributeFilter: ["class"] });
}

export function installPhoneGuard() {
  Hooks.on("renderDialogV2", (app, element) => {
    const title = app.options?.window?.title ?? app.title ?? "";
    const match = ANSWER_NO.some(key => title === key || (game.i18n?.has?.(key) && title === game.i18n.localize(key)));
    if (!match) return;
    const root = element instanceof HTMLElement ? element : element?.[0];
    const no = root?.querySelector('button[data-action="no"]');
    if (no) no.click();
    else app.close();
  });
}
