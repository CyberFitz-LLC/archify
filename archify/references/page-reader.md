# Page reader (opt-in)

CyberFitz fork note: the standard reader is the infinite canvas, which has no
fit requirement. Read this file only when the user explicitly asks for the boxed
single-screen page reader and the source sets `meta.layout_mode: "page"`. The
size limits below are the price of that choice; they never apply to the canvas,
and they are never a reason to shrink a canvas diagram.

## First-screen contract

Treat the standalone desktop viewer as a first-screen artifact by default, not a shallow strip. Generate one responsive artifact for laptops and external displays—never device-specific HTML or alternate topology. The viewer may adapt only the outer reading width from the live viewport height; it must preserve the authored SVG/viewBox, proportions, semantic geometry, and normal document flow. On a wide or tall desktop, use enough authored vertical rhythm that the diagram panel and its necessary conclusion cards occupy the screen as a balanced whole; runtime scaling cannot repair an over-compressed Y layout or an undersized explicit `meta.viewBox`. Before handoff, open the real HTML at 1440×900, 1600×1000, and 1920×1080; additionally check 2048×1320 whenever the composition is intended for a large desktop display. Require `document.documentElement.scrollWidth <= window.innerWidth` and `scrollHeight <= window.innerHeight` at every checked size, while visually checking that the diagram remains comfortably readable and vertically balanced at the largest checked viewport. Repair overflow by removing only genuinely redundant content or compacting spacing before shrinking nodes, labels, or the main panel. If the largest viewport still has a conspicuous empty lower band at the viewer's width cap, redistribute authored Y positions and increase the viewBox height proportionally; do not add filler copy or decorative cards. Never counterfeit a pass with `overflow: hidden`, clipped content, an internal diagram scroller, stretched SVG height, or smaller typography. Narrow/mobile layouts may scroll vertically when containment requires it.

In the page reader the showcase gate also requires node context text to project
to at least 6px inside the 930px desktop diagram slot, which caps the practical
viewBox width. If the subject does not fit these limits, the honest answer is
the canvas reader, not a smaller subject.
