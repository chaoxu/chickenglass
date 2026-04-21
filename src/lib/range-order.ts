export interface OrderedRange {
  readonly from: number;
  readonly to: number;
}

export function compareRangesByFromThenTo(
  left: OrderedRange,
  right: OrderedRange,
): number {
  return left.from - right.from || left.to - right.to;
}

export function compareRangesByToThenFrom(
  left: OrderedRange,
  right: OrderedRange,
): number {
  return left.to - right.to || left.from - right.from;
}
