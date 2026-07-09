/**
 * Checks whether a window message carries the expected local port handoff.
 *
 * @remarks
 * Packaged and E2E renderers load from an opaque `file:` origin, where the
 * browser cannot report an exact origin. HTTP renderers retain the stricter
 * same-origin check.
 *
 * @param event - Message event received by the current renderer window.
 * @param type - Port handoff discriminator expected by the caller.
 * @returns Whether the message came from this window and has the expected type.
 */
export function isCurrentWindowPortMessage(event: MessageEvent, type: string): boolean {
  if (event.source !== window) return false;
  if (window.location.protocol !== "file:" && event.origin !== window.location.origin) return false;

  return (event.data as { type?: string } | null)?.type === type;
}
