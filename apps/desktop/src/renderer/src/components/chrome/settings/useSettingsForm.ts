import { useCallback, useRef } from "react";
import { useForm, useWatch, type DefaultValues, type FieldValues } from "react-hook-form";
import type { SettingsForm, SettingsFormOptions } from "./types";

/**
 * Maintains an editable form over a refreshed workspace-owned value.
 *
 * @remarks
 * Canonical updates replace clean fields while React Hook Form preserves dirty
 * fields. A successful save adopts the refreshed value unless a newer local
 * edit exists, in which case only clean fields are refreshed.
 *
 * @param options - canonical value, persistence operation, and fallback error copy.
 * @returns a reactive draft with transform-based editing and commit operations.
 */
export function useSettingsForm<T extends FieldValues>(
  options: SettingsFormOptions<T>,
): SettingsForm<T> {
  const saveRef = useRef(options.save);
  const revisionRef = useRef(0);
  saveRef.current = options.save;

  const form = useForm<T>({
    defaultValues: options.canonical as DefaultValues<T>,
    values: options.canonical,
    resetOptions: {
      keepDirtyValues: true,
    },
  });
  const draft = useWatch({ control: form.control }) as T;

  const update = useCallback(
    (transform: (value: T) => T): T => {
      const next = transform(form.getValues());
      revisionRef.current += 1;
      form.setValues(next, { shouldDirty: true });
      return next;
    },
    [form],
  );

  const commit = useCallback(
    async (candidate?: T): Promise<void> => {
      const submitted = candidate ?? form.getValues();
      const submittedRevision = revisionRef.current;
      form.clearErrors("root.server");

      try {
        const refreshed = await saveRef.current(submitted);
        if (revisionRef.current === submittedRevision) {
          form.reset(refreshed);
          return;
        }

        form.reset(refreshed, { keepDirtyValues: true });
      } catch (cause) {
        form.setError("root.server", {
          type: "workspace",
          message: cause instanceof Error ? cause.message : options.errorMessage,
        });
      }
    },
    [form, options.errorMessage],
  );

  const updateAndCommit = useCallback(
    async (transform: (value: T) => T): Promise<void> => {
      const next = update(transform);
      await commit(next);
    },
    [commit, update],
  );

  return {
    draft,
    error: form.formState.errors.root?.server?.message ?? null,
    form,
    update,
    commit,
    updateAndCommit,
  };
}
