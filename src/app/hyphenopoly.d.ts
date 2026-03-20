/**
 * Minimal type declarations for the hyphenopoly ESM module.
 * The package has no @types counterpart.
 */

declare module "hyphenopoly" {
  /** Function that hyphenates a plain-text string, returning it with soft hyphens inserted. */
  type HyphenateTextFn = (text: string) => string;

  /** Options passed to hyphenopoly.config(). */
  interface HyphenopolyConfig {
    /** Language tags to load (e.g. ["en-us"]). */
    require: string[];
    /**
     * Async loader for .wasm pattern files.
     * Receives the filename (e.g. "en-us.wasm") and a URL for the patterns dir.
     * Must return a Promise resolving to an ArrayBuffer or Buffer.
     */
    loader: (file: string, patDir: URL) => Promise<ArrayBuffer | Uint8Array>;
    /** Hyphen character/string to insert (default: soft hyphen \u00AD). */
    hyphen?: string;
    /** Minimum word length to hyphenate (default: 6). */
    minWordLength?: number;
    /** Per-language exception lists. */
    exceptions?: Record<string, string>;
    /** Minimum characters to keep at the start of a line. */
    leftmin?: number;
    /** Minimum characters to keep at the end of a line. */
    rightmin?: number;
  }

  interface Hyphenopoly {
    /** Supported language tags. */
    supportedLanguages: string[];
    /**
     * Configure Hyphenopoly and start loading WASM engines.
     * Returns a Map from language tag → Promise<HyphenateTextFn>.
     */
    config(userConfig: HyphenopolyConfig): Map<string, Promise<HyphenateTextFn>>;
  }

  const hyphenopoly: Hyphenopoly;
  export default hyphenopoly;
}
