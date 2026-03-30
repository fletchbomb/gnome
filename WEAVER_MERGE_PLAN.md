# Weaver Merge Plan (index.html + weaver.html)

## Short answer
Yes — you now have enough information to do a successful merge, **if** you treat it as an integration project in phases (visual integration first, transaction logic second), and avoid reusing legacy Weaver selectors.

## What is already in `index.html` that helps

- A dedicated Weaver screen container (`#screen-weaver`) with an existing render flow (`showWeaverShopModal` → `renderWeaverScreen`).
- Body state toggles (`weaver-manage-open`, `weaver-overlay-v2`) that already gate interactivity.
- Existing live HUD/readouts (trouble + socks in `#header`) and initiative UI (`#gnome-panels`) that can be kept visible beneath an overlay.
- Mid-house and between-house Weaver modes are already explicit in state (`mode: 'room'` vs `mode: 'between'` and `syncWeaverScreenMode`).

## Why merges have been painful so far

`index.html` has multiple generations of Weaver CSS that target the same selectors (`.weaver-shell`, `.weaver-panel`, `#screen-weaver`) in several places. A direct paste from `weaver.html` into existing class names will keep re-triggering style collisions.

## Recommended integration strategy

### 1) Keep current Weaver logic, add a new visual namespace

Do **not** replace logic first. Keep the current JS flow and build a new visual layer under a unique namespace, for example:

- `#screen-weaver-v3` (or class flag `weaver-v3` on `#screen-weaver`)
- `.wv3-shell`, `.wv3-store-grid`, `.wv3-drawer`, `.wv3-chipstack`

This prevents collisions with existing `.weaver-*` blocks.

### 2) Reuse live game HUD and gnome stack under overlay

For your target behavior, do not duplicate counters/initiative inside the new panel. Instead:

- Keep `#header` visible and readable.
- Keep `#gnome-panels` visible above blur/dim layer.
- Apply input lock to board/gameplay areas while Weaver is open.

### 3) Add one overlay mask layer that blurs and blocks play area

Implement a single backdrop/mask for mid-house Weaver mode that:

- darkens + blurs board area,
- blocks pointer events for gameplay,
- leaves HUD + gnome stack above it.

For between-houses mode, switch to a non-blurred/solid intermission treatment.

### 4) Force compact gnome panel state while Weaver is open

When Weaver opens:

- force all gnome cards into compact/collapsed form,
- keep current active gnome highlighted,
- allow shopper switching only in between-houses mode.

This should be class-driven (e.g., body `.weaver-v3-open`) and never depend on ad hoc inline styles.

### 5) Port `weaver.html` layout ideas, not its full page scaffolding

From `weaver.html`, port only the Weaver-specific internals:

- storefront grid pattern,
- attached right-side drawer interaction,
- compact chip-stack behavior semantics.

Do **not** port the mock topbar/playfield wrappers since `index.html` already owns the live game shell.

### 6) Milestone order (important)

1. **Visual prototype in-game** (open/close, blur lock, visible HUD/stack, compact gnomes, between-vs-mid treatment).
2. **Wire live data into new UI** (offers, banked socks, satchel/hat compare, disabled states).
3. **Re-enable transactions incrementally** (reroll → simple buys → mixed payment → revive/reduce).
4. **Remove legacy Weaver CSS/DOM paths only after parity**.

## Concrete merge checklist

- [ ] Add new Weaver namespace classes (no `.weaver-shell` reuse).
- [ ] Add `body`/screen mode class for v3 open state.
- [ ] Add overlay mask layer with mode-dependent styling.
- [ ] Keep `#header` and `#gnome-panels` above mask.
- [ ] Add compact-gnome CSS rules gated by v3-open class.
- [ ] Add shopper-switch click handling only for between mode.
- [ ] Keep old Weaver path as fallback flag until full parity.

## Risk controls

- Use a feature flag (`USE_NEW_WEAVER_OVERLAY`-style) to switch between old/new rendering.
- Never mix old and new CSS selectors in the same component.
- Don’t migrate transaction logic until visual integration is stable.


## Questions to lock before implementation

To avoid another painful merge cycle, these decisions should be confirmed up front:

1. **Feature-flag behavior**
   - Should the new overlay be enabled by default behind `USE_NEW_WEAVER_OVERLAY`, with a quick rollback to legacy on any regression?

2. **DOM strategy**
   - Do you want to keep using the existing `#screen-weaver` node with a new `weaver-v3` class, or mount a parallel `#screen-weaver-v3` node and switch by flag?

3. **Visibility and clickability contract while Weaver is open**
   - Confirm exact intent:
     - `#header` visible + non-interactive (recommended),
     - `#gnome-panels` visible + compact,
     - gnome click-to-switch enabled **only** between houses,
     - board/actions/sidebar/log fully non-interactive.

4. **Layering/z-index contract**
   - Which should be highest priority in order: weaver shell, payment drawer, gnome stack, header, dim/blur mask, board?

5. **Mode visuals**
   - Mid-house: darken + blur board.
   - Between-houses: solid intermission background (no blur).
   - Confirm exact between-house background style (reuse current theme vs new flat treatment).

6. **Compact gnome card definition**
   - Confirm exactly what remains visible in compact state (portrait, name, status badges, action pips yes/no, hat icon yes/no).

7. **Shopper-switch rules**
   - Between houses only: may KO gnomes be selected as shopper? (default: no).
   - If no valid shoppers remain, should we auto-fallback to current gnome or block purchases?

8. **Exit behavior**
   - Mid-house close action: return to same turn with no side effects.
   - Between-houses close action: immediately `advanceHouse()`.
   - Confirm button labels and whether keyboard `Esc` should also close.

9. **Scope of first code PR**
   - Confirm first PR is **visual integration only** with inert/stub-safe trading interactions (no risky transaction rewiring).

If these are confirmed, implementation can proceed with low ambiguity.

## Decisions made for implementation (defaults chosen)

- **Q1 (Feature flag):** Use the existing `USE_NEW_WEAVER_OVERLAY` switch and keep the new overlay enabled by default, so rollback remains one toggle away if regressions appear.
- **Q2 (DOM strategy):** Reuse the existing `#screen-weaver` container and apply a new `weaver-overlay-v3` class namespace instead of introducing a second parallel Weaver screen node.

## Decision

Your previous GPT guidance is directionally correct and sufficient as a plan.

The key to success is **strict namespacing + phased integration in the real file**. If you follow that, this merge is very achievable.

## What’s next (immediate execution order)

1. **Stabilize this visual scaffold in live play**  
   - Verify opening/closing Weaver in both contexts repeatedly (mid-house and between-houses) with no class/z-index drift.
   - Confirm board remains non-interactive while overlay is open, while counters + initiative remain visible.

2. **Polish compact stack behavior**  
   - Confirm active gnome appears exactly like a normal non-active card while Weaver is open.
   - Confirm between-house shopper highlight is visible and shopper switching feels clear.

3. **Data/UX parity pass (still low-risk)**  
   - Ensure offer cards, costs, disabled states, reroll, and leave flow all reflect current live state correctly.
   - Add final copy polish to the right-side Weaver helper panel.

4. **Targeted transaction pass (incremental order)**  
   - Validate reroll end-to-end.
   - Validate simple purchases end-to-end.
   - Validate mixed payment consumption and destruction behavior.
   - Validate revive/reduce edge cases.

5. **Cleanup pass (after parity)**  
   - Remove or retire unused v2-only Weaver styling/markup paths.
   - Keep the rollback flag until at least one full house cycle is verified without regression.
