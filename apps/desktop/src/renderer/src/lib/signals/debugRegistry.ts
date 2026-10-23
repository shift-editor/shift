import { signalDebug } from "@shift/editor/signals";

// Imported before the app, so dev builds list every signal for `signalDebug.dumpByName`
// and `find`. Packaged builds skip the listing, which costs a WeakRef per signal.
if (import.meta.env.DEV) signalDebug.registerNodes();
