---
name: ui
description: Design, implement, audit, or review Shift user interfaces and shared UI components. Use for React components, Base UI primitives, Tailwind styling or theme tokens, Figma/reference matching, accessibility, icon-only actions, tooltips, menus, popovers, dialogs, forms, layout, and visible UI regressions.
---

# /ui — Shift Interface Work

Build interfaces that match the supplied design, use Shift's shared primitives and semantic theme, and remain accessible in every interaction state.

## Sources of truth

Read these before editing an unfamiliar UI surface:

1. `docs/architecture/index.md` for documentation routing.
2. `packages/ui/docs/DOCS.md` for the shared component boundary.
3. `apps/desktop/src/renderer/index.css` for Tailwind v4 theme tokens, fonts, and custom utilities.
4. The relevant existing component and its neighboring components for local composition and density.
5. Any supplied Figma frame, screenshot, or product reference. Treat it as the visual target, not merely inspiration.

When library behavior or composition is unclear, inspect the installed Base UI types and current Base UI documentation. Do not guess from Radix, shadcn, or an older Base UI API.

## Architecture boundary

- Check whether Base UI has a matching primitive before implementing an interactive control.
- Shared primitives live in `packages/ui/src/components/{component}/` and wrap `@base-ui-components/react/{component}`.
- Application code imports shared controls from `@shift/ui`; never import Base UI directly in the desktop app.
- Keep application state and domain behavior in the consuming app. Shared wrappers own primitive composition, reusable visual defaults, and widget-local behavior only.
- Use the Base UI component name for its Shift wrapper: `Button`, `Menu`, `Popover`, `Tooltip`, and so on.
- Re-export every shared component and public prop type through its component barrel and `packages/ui/src/index.ts`.
- Prefer `React.ComponentPropsWithoutRef`, `React.ElementRef`, and `React.forwardRef` so wrappers preserve the primitive contract. Set `displayName` on forwarded components.
- Compose Base UI triggers with its `render` prop. Produce exactly one interactive DOM element: no nested buttons, no trigger-only wrapper spans, and no duplicated event targets.
- Use Base UI state attributes such as `data-[disabled]`, `data-[highlighted]`, `data-[active]`, and `data-[starting-style]` instead of duplicating primitive state in React.

## Tailwind and theme tokens

Shift uses Tailwind CSS v4. The renderer theme is declared in the `@theme` block in `apps/desktop/src/renderer/index.css`, and that stylesheet scans shared UI source with:

```css
@source "../../../../packages/ui/src/**/*.tsx";
```

Follow these rules:

- Use semantic theme utilities before raw Tailwind palette colors or literals: `bg-surface`, `bg-panel`, `bg-input`, `bg-hover`, `text-primary`, `text-secondary`, `text-muted`, `border-line-subtle`, `ring-accent`, and related tokens.
- Remember that Shift overrides Tailwind's typography scale: `text-sm` is 12px, `text-ui` is 11px, and `text-xs` is 10px. Check the theme instead of assuming Tailwind defaults.
- Use opacity modifiers on semantic tokens when appropriate, such as `bg-hover/50`.
- Do not copy legacy hard-coded hex values or generic palette classes when an existing semantic token expresses the role.
- Add a new theme token only for a stable semantic role that will be reused or themed. Name the role, not the component or current color.
- Reserve literal colors and inline styles for genuinely data-driven graphics, canvas/SVG rendering, or platform-defined colors such as native window controls.
- Use `cn` from `@shift/ui` or the package-local utility for conditional classes and consumer overrides. Shared wrappers must merge `className` through `cn` so `tailwind-merge` resolves conflicts.
- Keep reusable visual defaults in the shared wrapper. Do not restyle the same primitive independently at many call sites.

## Matching a visual reference

Before changing styles, identify the reference's:

- typography and density;
- foreground, background, border, and shadow roles;
- spacing, dimensions, radius, and alignment;
- hover, focus, pressed, selected, disabled, read-only, open, error, and empty states;
- popup side, offset, collision behavior, layering, and arrow treatment.

Map those roles to existing theme tokens first. Compare the finished implementation with the reference at the app's actual scale. Do not declare a match from class names alone.

If the reference is ambiguous or conflicts with an established interaction pattern, ask which behavior wins before inventing a new one.

## Accessibility and interaction

- Every icon-only action needs an accessible name and a concise visible tooltip.
- Tooltip text always names the action. Keep the same tooltip and accessible name when the action is unavailable; disabled styling and behavior communicate availability without replacing the action name with an explanation.
- If an unavailable control must retain its tooltip, use `aria-disabled`, guard its action, and style that state. Do not use native `disabled`, which removes focus and pointer interaction.
- Preserve keyboard navigation supplied by Base UI. Verify `focus-visible`, not only pointer hover.
- Use semantic roles and labels for toolbars, navigation, dialogs, groups, sliders, and form controls.
- Keep focus indicators visible. Do not remove outlines without an equivalent token-based focus treatment.
- Portal popups above application content and give their positioner the shared layering class.
- Close, menu, popover, and dialog triggers are actions too; icon-only compound triggers follow the same label and tooltip rules.

## Coverage audits

For broad UI work such as "add all missing tooltips," do not patch only the first reported control.

1. Define the invariant being audited, such as “every icon-only user action has an accessible name and tooltip.”
2. Trace the actual component tree for every requested surface.
3. Search by primitive (`Button`, `MenuTrigger`, `PopoverTrigger`, `DialogClose`, toolbar controls), icon names, and accessible labels. A single grep pattern is not a complete audit.
4. Include persistent and hover-revealed controls, compound triggers, read-only or disabled states, dialogs, and both home and editor views.
5. Record a temporary coverage ledger while working: surface, control, shared owner, enabled state, unavailable state, accessible label, and tooltip copy.
6. Centralize repeated behavior in the narrowest existing shared component when that removes omissions without hiding domain-specific copy.
7. Recheck the complete inventory after edits. Do not equate “wrapper exists in source” with “tooltip works in the rendered app”; verify compound trigger composition and the active build.

## Testing and review evidence

Test observable behavior, not styling implementation:

- Do not add unit or E2E tests that assert Tailwind classes, static tooltip wiring, component nesting, or Base UI behavior.
- Add tests when Shift adds meaningful behavior: unavailable controls remain tooltip-accessible, keyboard interaction changes state, focus is restored, a form validates, or a menu action changes application state.
- For thin wrappers, typechecking plus focused visual/manual verification is usually the right evidence.
- For materially visible work, capture the actual implementation in each affected state for review. Use the remote E2E workflow when automated Electron verification is warranted; do not open Electron on the user's current Mac.
- Never update a visual baseline without inspecting the diff and confirming it matches the intended design.

## Validation

Run the smallest relevant checks, then the shared checks for cross-cutting UI changes:

```bash
pnpm format:files <changed files...>
pnpm lint:check
pnpm typecheck
```

Run repository commands inside the Nix dev shell as required by `AGENTS.md`. If behavior changed, run the focused owning test. If only visual defaults or declarative wiring changed, report the focused manual verification instead of inventing a low-value test.

## Completion checklist

- [ ] Supplied reference matched at actual application scale.
- [ ] Existing Base UI primitive and `@shift/ui` wrapper used.
- [ ] Exactly one interactive element per composed trigger.
- [ ] Semantic theme tokens used; no avoidable raw colors.
- [ ] Pointer, keyboard, disabled/read-only, and open states considered.
- [ ] Icon-only actions have accessible names and tooltips.
- [ ] Requested surfaces were audited completely, not sampled.
- [ ] Shared styling lives in the shared wrapper.
- [ ] Formatting, lint, and typecheck pass.
- [ ] Visible changes have appropriate manual or screenshot evidence.
