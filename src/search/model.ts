export interface SearchOptions {
  readonly caseSensitive: boolean;
  readonly wholeWord: boolean;
  readonly regex: boolean;
}

export interface SearchMatch {
  readonly from: number;
  readonly to: number;
  readonly lineNumber: number;
}

export interface SearchState {
  readonly query: string;
  readonly options: SearchOptions;
  readonly matches: ReadonlyArray<SearchMatch>;
  readonly activeIndex: number | null;
}
