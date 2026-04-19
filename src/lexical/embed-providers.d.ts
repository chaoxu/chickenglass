export interface EmbedProvider {
  readonly id: string;
  readonly routePatterns: readonly RegExp[];
  readonly computeSrc: (url: string) => string | null;
  readonly sandbox: string;
}

export const EMBED_PROVIDERS: readonly EmbedProvider[];

export function findEmbedProvider(embedType: string): EmbedProvider | null;

export function computeEmbedSrc(embedType: string, rawUrl: string): string | null;

export function embedSandboxPermissions(embedType: string): string;

export function externalEmbedStubRoutes(): Array<{
  readonly providerId: string;
  readonly routePattern: RegExp;
}>;

