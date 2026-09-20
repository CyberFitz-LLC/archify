// CyberFitz fork: reader layout resolution.
//
// Upstream Archify ships one reader: a boxed "page" whose diagram must fit the
// first screen. This fork makes an infinite canvas the standard reader, so the
// authored viewBox can be as large as the subject needs. Everything the fork
// adds for that decision lives here so upstream merges stay small.
//
// Resolution order: authored meta.layout_mode, then ARCHIFY_DEFAULT_LAYOUT
// (used by the inherited upstream test suite, which asserts page behaviour),
// then the fork default.

export const FORK_DEFAULT_LAYOUT = 'canvas';
const LAYOUTS = new Set(['canvas', 'page']);

export function resolveLayoutMode(meta, env = process.env) {
  const authored = meta?.layout_mode;
  if (LAYOUTS.has(authored)) return authored;
  const fromEnv = env?.ARCHIFY_DEFAULT_LAYOUT;
  return LAYOUTS.has(fromEnv) ? fromEnv : FORK_DEFAULT_LAYOUT;
}

export function isCanvasLayout(meta, env = process.env) {
  return resolveLayoutMode(meta, env) === 'canvas';
}

// The page reader only emits the upstream <html> tag, byte for byte, so
// upstream goldens and receipts remain valid in page mode.
export function layoutHtmlAttr(layoutMode) {
  return layoutMode === 'canvas' ? ' data-layout="canvas"' : '';
}
