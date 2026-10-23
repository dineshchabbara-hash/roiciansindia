# Website logo decisions

**Scope:** the public website logo only. It does not change the legal company name, **Roicians Tech Pvt. Ltd.**, or any approved legal information.

**Related decision (owner, 2026-10-22, made after this logo decision):** the India website's public brand name is **ROICIANS** (previously ROICIANS TECH), so the logo and the name now match. The name is set in one place, separate from the legal identity. See `docs/requirements/PHASE_22_APPROVED_DESIGN.md` §4 and §4.1.

## Current decision (owner, 2026-10-22)

The website uses the **original ROICIANS logo on its own, with no TECH**. There are no dividers and no added lettering.

| Where | What is shown |
|---|---|
| Header | The original R symbol and ROICIANS wordmark side by side, in a clean horizontal arrangement |
| Footer | The original stacked ROICIANS logo. The tagline "Practical technology training for the AI era" sits beneath it as normal text, not part of the logo |
| Favicon | The original R symbol alone |

The owner's reason: the original logo is already strong, recognisable and professional, and adding TECH made the identity look unnecessarily complicated.

### How the original is preserved

**Master file:** [`roicians-logo-original.png`](roicians-logo-original.png). It is never modified.
- Size: 433 × 370 px, transparent PNG.
- SHA-256: `13ecd0b8ae36b9686ec4ee53c93b65fb2a9890646ba3b1af039169f6849e5ca8`.

**Website copies,** in `docs/prototypes/website-v2/assets/brand/`:

| File | What it is |
|---|---|
| `roicians-logo-web.png` | The full stacked logo, with only its empty transparent margin trimmed (footer) |
| `roicians-symbol.png`, `roicians-wordmark.png` | Straight crops of the original (header) |
| `roicians-favicon.png` | The symbol's unchanged pixels on a transparent 180 × 180 square |
| `roicians-touch-icon.png` | The same symbol on white, for phone home screens (they show transparency as black) |

**Proportions:**
- In the header, the symbol and wordmark are shown at the same scale as in the original logo. The wordmark image is always 57/180 of the symbol image height, so their relative size never changes.
- The wordmark's letters are centred on the symbol.
- The symbol is 56 px tall on desktop and 46 px on phones.
- The footer logo is 140 px wide on desktop and 124 px on phones.

**Colour:** the original navy, about `#2E496C`. The logo is shown on white or soft blue only, never on dark backgrounds.

**Distortion:** none. Nothing is recoloured, redrawn, stretched or squeezed. The logo images ignore the site-wide image width limit, so a narrow layout cannot distort them.

**Still recommended:** a vector (SVG) or larger master before launch. It would also sharpen the favicon at 16 px.

## Review history

| # | Proposal | Outcome | Where to see it |
|---|---|---|---|
| 1 | Prototype v1: a text wordmark placeholder | Rejected with v1 | `docs/prototypes/roicians-tech-homepage-prototype.html` |
| 2 | **Header Option B:** symbol, wordmark, vertical divider, widely spaced TECH. **Footer Option A:** stacked logo with TECH between horizontal rules | Provisionally chosen, then withdrawn: dated, and the header and footer were inconsistent | Commit `8db3c00` (`logo-options.html`) |
| 3 | **Revision 2, two options:** TECH in Instrument Sans SemiBold, either alongside the wordmark on its baseline or beneath the end of the wordmark | Not adopted | Commit `745c8df` (`logo-options.html`) |
| 4 | **Original ROICIANS logo without TECH** | **Current website logo decision** | `docs/prototypes/website-v2/logo.html` |

Earlier versions stay in the repository history. For example, `git show 745c8df:docs/prototypes/website-v2/logo-options.html` shows the revision-2 page.
