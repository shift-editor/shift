import { useRef, useState, type ChangeEvent } from "react";
import type { Axis, AxisId } from "@shift/types";
import { DraftIssues, type DraftIssue, type LocationDraftValues } from "./locationDraft";

const EMPTY_VALUES: LocationDraftValues = { name: "", location: {} };

/**
 * Form state shared by the create-source and create-instance menus: the typed
 * draft, whether validation is showing, and focus for the field an issue
 * points at.
 *
 * @param axes - The axes the form has a field for, in field order.
 */
export function useLocationDraftForm(axes: readonly Axis[]) {
  const [values, setValues] = useState<LocationDraftValues>(EMPTY_VALUES);
  const [validationVisible, setValidationVisible] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const axisInputRefs = useRef(new Map<AxisId, HTMLInputElement>());

  /** Starts a fresh draft, or clears validation when the form closes. */
  const reset = (next: LocationDraftValues | null) => {
    if (next) setValues(next);
    setValidationVisible(false);
  };

  const updateName = (event: ChangeEvent<HTMLInputElement>) => {
    const { value } = event.currentTarget;
    setValues((current) => ({ ...current, name: value }));
  };

  const updateAxisValue = (axisId: AxisId) => (event: ChangeEvent<HTMLInputElement>) => {
    const { value } = event.currentTarget;
    setValues((current) => ({
      ...current,
      location: { ...current.location, [axisId]: value },
    }));
  };

  /** Keeps a ref to each axis field, so an issue can focus it. */
  const axisInputRef = (axisId: AxisId) => (input: HTMLInputElement | null) => {
    if (input) {
      axisInputRefs.current.set(axisId, input);
      return;
    }

    axisInputRefs.current.delete(axisId);
  };

  /** Shows `issue` and focuses the field it points at; a location issue focuses the first axis. */
  const report = (issue: DraftIssue) => {
    setValidationVisible(true);

    switch (issue.kind) {
      case "name":
        nameInputRef.current?.focus();
        return;
      case "axis":
        axisInputRefs.current.get(issue.axisId)?.focus();
        return;
      case "location": {
        const firstAxis = axes[0];
        if (firstAxis) axisInputRefs.current.get(firstAxis.id)?.focus();
        return;
      }
    }
  };

  /** The issues to show for `issue`: none until a submit has revealed them. */
  const shown = <Issue extends DraftIssue>(issue: Issue | null) =>
    new DraftIssues(validationVisible ? issue : null);

  return {
    values,
    nameInputRef,
    reset,
    updateName,
    updateAxisValue,
    axisInputRef,
    report,
    shown,
  };
}
