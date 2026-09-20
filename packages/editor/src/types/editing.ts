declare const EditingIdBrand: unique symbol;
declare const PendingEditIdBrand: unique symbol;

export type EditingId = string & { readonly [EditingIdBrand]: typeof EditingIdBrand };

/** Renderer-local correlation identity for the pending → confirmed lifecycle. */
export type PendingEditId = number & {
  readonly [PendingEditIdBrand]: typeof PendingEditIdBrand;
};

export const currentEditingId = "editing:current" as EditingId;
