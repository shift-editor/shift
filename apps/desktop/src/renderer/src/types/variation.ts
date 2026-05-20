declare const AxisTagBrand: unique symbol;

export type AxisTag = string & { readonly [AxisTagBrand]: true };
export type AxisLocation = ReadonlyMap<AxisTag, number>;
