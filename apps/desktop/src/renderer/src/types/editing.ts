declare const EditingIdBrand: unique symbol;

export type EditingId = string & { readonly [EditingIdBrand]: typeof EditingIdBrand };

export const currentEditingId = "editing:current" as EditingId;
