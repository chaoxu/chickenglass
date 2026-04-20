/// <reference types="vite/client" />

declare const GIT_COMMIT_HASH: string;
declare const GIT_COMMIT_TIME: string;

interface ImportMetaEnv {
  readonly VITE_COFLAT_PRODUCT?: string;
}
