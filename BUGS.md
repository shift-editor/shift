# Scatchpad for Bugs

- ~~cmd+q is triggered even when the window is not active~~ - Fixed 2025-01-25: Added mainWindow?.isFocused() check
- `const freshCtx = this.#editor.createToolContext();` this everywhere in the tool feels wrong - Deferred: Architectural debt, requires API redesign
- keyboard shortcuts should be disabled during tool drag ops
- if you have a field focused on the sidebar, and you hover back to canvas, your keyboard events should stay in the sidebar (e.g clicking escape should not delete a point)
- smooth points should only be "toggle-able" if they its between two cubics
- ## need to add more smart edit rules
