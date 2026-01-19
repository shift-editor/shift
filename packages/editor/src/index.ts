/**
 * @shift/editor - Core editor functionality
 *
 * This package contains the core editor infrastructure:
 * - Command pattern interfaces
 * - Selection management
 * - Viewport calculations
 *
 * Note: The main Editor class and concrete command implementations
 * remain in the application where they have access to FontEngine.
 */

// Command pattern
export type { Command, CommandContext } from "./commands";
export { BaseCommand, CompositeCommand } from "./commands";
