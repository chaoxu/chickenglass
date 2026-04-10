export function isValidEmbedUrl(url: string): boolean {
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function extractYoutubeId(url: string): string | undefined {
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

export function youtubeEmbedUrl(videoId: string): string {
  return `https://www.youtube.com/embed/${videoId}`;
}

export function gistEmbedUrl(url: string): string {
  const trimmed = url.trim();
  if (trimmed.endsWith(".pibb")) {
    return trimmed;
  }
  return trimmed.endsWith("/") ? `${trimmed.slice(0, -1)}.pibb` : `${trimmed}.pibb`;
}

export function computeEmbedSrc(embedType: string, rawUrl: string): string | null {
  const url = rawUrl.trim();
  if (!isValidEmbedUrl(url)) {
    return null;
  }

  switch (embedType) {
    case "youtube": {
      const videoId = extractYoutubeId(url);
      return videoId ? youtubeEmbedUrl(videoId) : null;
    }
    case "gist":
      return gistEmbedUrl(url);
    default:
      return url;
  }
}

export function embedSandboxPermissions(embedType: string): string {
  if (embedType === "youtube") {
    return "allow-scripts allow-presentation";
  }
  return "allow-scripts";
}
