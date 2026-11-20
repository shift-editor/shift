import { signal } from "@shift/editor/signals";
import type { AppNotification } from "@/types/notification";

/**
 * The latest notification. Every `notify` call publishes a new object, so an
 * identical message shown twice in a row still reaches `AppNotifications`.
 */
export const appNotificationCell = signal<AppNotification | null>(null);

/** Tells the user something that no panel owns. Safe to call from any command. */
export function notify(message: string): void {
  appNotificationCell.set({ message });
}
