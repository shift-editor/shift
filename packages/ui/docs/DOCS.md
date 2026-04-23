# Shared UI (`@shift/ui`)

Shared UI component library for Shift, wrapping Base UI primitives with Tailwind styling and Shift design tokens.

## Architecture Invariants

- **Architecture Invariant:** Every component wraps a `@base-ui-components/react` primitive -- never raw HTML elements. This keeps accessibility, keyboard handling, and ARIA attributes delegated to Base UI.
- **Architecture Invariant:** Components are style-only wrappers. They add Tailwind classes via `cn` but do not contain business logic. All application state lives in the consuming app, not in this package.
- **Architecture Invariant:** Each component lives in its own directory with a barrel `index.ts`. The package root `index.ts` re-exports everything -- consumers import from `@shift/ui`, never from deep paths.
- **Architecture Invariant:** The `cn` utility (clsx + tailwind-merge) must be used for all className composition. This ensures Tailwind class conflicts are resolved correctly when consumers pass overrides.
- **Architecture Invariant:** The package is source-only (`main` and `exports` both point to `./src/index.ts`). There is no build step -- consuming apps bundle it directly via their own bundler.

## Codemap

```
packages/ui/
  src/
    index.ts               -- barrel re-export of all components, types, cn, and Search icon
    lib/
      utils.ts             -- cn utility (clsx + tailwind-merge)
    components/
      button/Button.tsx    -- Button with variant/size/isActive/icon props
      collapsible/         -- Collapsible, CollapsibleTrigger, CollapsiblePanel
      dialog/              -- Dialog, DialogBackdrop, DialogPortal, DialogPopup, DialogTitle, DialogClose
      input/Input.tsx      -- Input with label/icon positioning
      separator/           -- Separator (horizontal/vertical)
      toast/               -- ToastProvider, ToastViewport, ToastRoot, ToastTitle, ToastDescription, ToastClose, useToastManager
      tooltip/             -- Tooltip, TooltipTrigger, TooltipContent, TooltipProvider
  vitest.config.ts         -- jsdom test config (no tests yet)
```

## Key Types

- **`ButtonProps`** -- extends Base UI `ButtonProps` with `variant` (`"default" | "ghost" | "primary"`), `size` (`"sm" | "md" | "lg" | "icon" | "icon-sm"`), `isActive`, and `icon`.
- **`InputProps`** -- extends Base UI `Input` props with `label`, `labelPosition`, `icon`, and `iconPosition`.
- **`SeparatorProps`** -- adds `orientation` (`"horizontal" | "vertical"`) to the Base UI separator.
- **`DialogProps`** / **`DialogBackdropProps`** / **`DialogPopupProps`** / **`DialogTitleProps`** -- thin wrappers over Base UI Dialog sub-component props.
- **`CollapsibleProps`** / **`CollapsibleTriggerProps`** / **`CollapsiblePanelProps`** -- thin wrappers over Base UI Collapsible sub-component props.
- **`ToastProviderProps`** -- `children` and `timeout` (default 2000ms).
- **`ToastRootProps`** -- requires a `toast` object (from `useToastManager`) plus `children` and optional `className`.

## How it works

Each component follows the same pattern: import the Base UI primitive, wrap it in a `React.forwardRef` (or plain function for root/provider components), apply Shift design tokens via Tailwind classes using `cn`, and forward all remaining props. Consumers never interact with Base UI directly.

**Button** is the most opinionated component, defining three visual variants (`default`, `ghost`, `primary`) and five size presets. It also supports an `isActive` data attribute for toggled toolbar buttons and an `icon` slot.

**Input** adds label and icon positioning logic (left/right for each) on top of the Base UI input, adjusting padding classes dynamically.

**Toast** is the most complex component family. `ToastProvider` wraps Base UI's provider with a default 2-second timeout. `ToastViewport` renders through a portal, centered at the top of the viewport. Individual toasts use enter/exit opacity transitions. Consumers call `useToastManager` (re-exported directly from Base UI) to imperatively add toasts.

**Tooltip** supports an optional per-instance `delayDuration` override. When provided, it wraps the tooltip root in its own `TooltipProvider`; otherwise it inherits from the nearest ancestor `TooltipProvider`.

The package also re-exports the `Search` icon from `lucide-react` as a convenience for the glyph finder UI.

## Workflow recipes

### Add a new component

1. Create `src/components/<name>/<Name>.tsx`.
2. Import the Base UI primitive: `import { X as BaseX } from "@base-ui-components/react/x"`.
3. Define a props interface extending the Base UI props, adding any Shift-specific props.
4. Wrap the Base UI primitive with `React.forwardRef`, apply Tailwind classes via `cn`.
5. Set `displayName` on the forwarded ref component.
6. Create `src/components/<name>/index.ts` barrel file exporting the component and its types.
7. Add the export to `src/index.ts`.
8. Run `pnpm typecheck` from the package root.

### Override styles from a consumer

Pass a `className` prop -- `cn` (tailwind-merge) will resolve conflicts with the component's default classes, letting the consumer's classes win.

## Gotchas

- **No build step**: The package ships raw TypeScript/TSX. If a consumer's bundler does not handle `.tsx` imports from `node_modules`/workspaces, it will fail. The desktop app's Vite config handles this.
- **No tests yet**: `vitest.config.ts` is configured with `passWithNoTests: true`. The test infrastructure (jsdom, testing-library) is wired up but no test files exist.
- **Toast timeout**: `ToastProvider` defaults to 2000ms. Consumers that need longer-lived toasts must pass an explicit `timeout` prop to `ToastProvider`, not to individual toasts.
- **Tooltip delay inheritance**: `Tooltip` with `delayDuration` creates its own `TooltipProvider`, overriding any ancestor. Without it, delay comes from the nearest `TooltipProvider` (default 0ms). Mixing both patterns in the same tree can produce surprising delay behavior.
- **`Search` icon re-export**: The `Search` icon from `lucide-react` is re-exported from the package barrel. This is a convenience coupling -- if more icons are needed, they should be added here rather than importing `lucide-react` directly in the app.

## Verification

- `pnpm typecheck` -- type-checks all components against Base UI and React types.
- `pnpm test` -- runs vitest (currently passes with no tests).

## Related

- **`@base-ui-components/react`** -- the unstyled primitive library all components wrap.
- **`cn`** -- className merge utility used by every component and by consumer code (e.g., `SidebarSection`).
- **`useToastManager`** -- Base UI hook re-exported for imperative toast creation (used in `ZoomToast`).
- **`@shift/types`** -- domain types package (separate from UI types).
