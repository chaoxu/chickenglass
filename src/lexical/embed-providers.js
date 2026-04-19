function isValidEmbedUrl(url) {
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function extractYoutubeId(url) {
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);

    if (
      (parsed.hostname === "www.youtube.com" || parsed.hostname === "youtube.com")
      && parsed.pathname === "/watch"
    ) {
      return parsed.searchParams.get("v") ?? undefined;
    }

    if (parsed.hostname === "youtu.be") {
      const id = parsed.pathname.slice(1);
      return id.length > 0 ? id : undefined;
    }

    if (
      (parsed.hostname === "www.youtube.com" || parsed.hostname === "youtube.com")
      && parsed.pathname.startsWith("/embed/")
    ) {
      const id = parsed.pathname.slice("/embed/".length);
      return id.length > 0 ? id : undefined;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function youtubeEmbedUrl(videoId) {
  return `https://www.youtube.com/embed/${videoId}`;
}

function gistEmbedUrl(url) {
  const trimmed = url.trim();
  if (trimmed.endsWith(".pibb")) {
    return trimmed;
  }
  return trimmed.endsWith("/") ? `${trimmed.slice(0, -1)}.pibb` : `${trimmed}.pibb`;
}

export const EMBED_PROVIDERS = [
  {
    id: "youtube",
    routePatterns: [/^https:\/\/www\.youtube\.com\/embed\//],
    computeSrc: (url) => {
      const videoId = extractYoutubeId(url);
      return videoId ? youtubeEmbedUrl(videoId) : null;
    },
    sandbox: "allow-scripts allow-presentation",
  },
  {
    id: "gist",
    routePatterns: [/^https:\/\/gist\.github\.com\/.*\.pibb(?:\?.*)?$/],
    computeSrc: gistEmbedUrl,
    sandbox: "allow-scripts",
  },
];

export function findEmbedProvider(embedType) {
  return EMBED_PROVIDERS.find((provider) => provider.id === embedType) ?? null;
}

export function computeEmbedSrc(embedType, rawUrl) {
  const url = rawUrl.trim();
  if (!isValidEmbedUrl(url)) {
    return null;
  }
  const provider = findEmbedProvider(embedType);
  return provider ? provider.computeSrc(url) : url;
}

export function embedSandboxPermissions(embedType) {
  return findEmbedProvider(embedType)?.sandbox ?? "allow-scripts";
}

export function externalEmbedStubRoutes() {
  return EMBED_PROVIDERS.flatMap((provider) =>
    provider.routePatterns.map((routePattern) => ({
      providerId: provider.id,
      routePattern,
    }))
  );
}
