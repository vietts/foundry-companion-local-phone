/** Pure helpers for the GM notes tab (no Foundry globals, so they run under `node --test`). */

/** Lowercase, without accents: "Città" and "citta" match. */
export function normalize(text) {
  return String(text ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Every word of the query appears in the name, in any order. */
export function matchesQuery(name, query) {
  const target = normalize(name);
  return normalize(query).split(/\s+/).filter(Boolean).every(word => target.includes(word));
}

/**
 * Folders and entries as a flat list of rows in display order, descending only into open folders.
 * A flat list keeps the template free of recursive partials.
 * @param {{id: string, name: string, parentId: string|null, sort: number}[]} folders
 * @param {{id: string, name: string, folderId: string|null, sort: number}[]} entries
 * @param {Set<string>} openFolders
 * @returns {{kind: "folder"|"entry", id: string, name: string, depth: number, open?: boolean}[]}
 */
export function buildTree(folders, entries, openFolders) {
  const bySort = (a, b) => (a.sort - b.sort) || a.name.localeCompare(b.name);
  const rows = [];
  const walk = (parentId, depth) => {
    for (const folder of folders.filter(f => f.parentId === parentId).sort(bySort)) {
      const open = openFolders.has(folder.id);
      rows.push({ kind: "folder", id: folder.id, name: folder.name, depth, open });
      if (open) walk(folder.id, depth + 1);
    }
    for (const entry of entries.filter(e => e.folderId === parentId).sort(bySort)) {
      rows.push({ kind: "entry", id: entry.id, name: entry.name, depth });
    }
  };
  walk(null, 0);
  return rows;
}

/** Most recent first, no duplicates, at most `max`. */
export function pushRecent(list, id, max = 5) {
  return [id, ...list.filter(other => other !== id)].slice(0, max);
}

/** Title of a quick note: the local date and time, e.g. "22 set 2026, 18:40". */
export function quickNoteName(date, locale) {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
  }).format(date);
}
