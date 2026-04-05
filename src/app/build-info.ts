export interface BuildInfo {
  readonly hash: string;
  readonly commitTime: string;
  readonly label: string;
  readonly title: string;
}

interface BuildInfoFormatOptions {
  readonly timeZone?: string;
}

const defaultCommitHash = typeof GIT_COMMIT_HASH === "string" ? GIT_COMMIT_HASH : "";
const defaultCommitTime = typeof GIT_COMMIT_TIME === "string" ? GIT_COMMIT_TIME : "";

export function formatBuildCommitTime(
  commitTime: string,
  options: BuildInfoFormatOptions = {},
): string | null {
  const date = new Date(commitTime);
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: options.timeZone,
  }).formatToParts(date);

  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  const hour = parts.find((part) => part.type === "hour")?.value ?? "";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "";
  if (!month || !day || !hour || !minute) return null;

  return `${month} ${day} ${hour}:${minute}`;
}

export function resolveBuildInfo(
  rawHash: string | null | undefined,
  rawCommitTime: string | null | undefined,
  options: BuildInfoFormatOptions = {},
): BuildInfo | null {
  const hash = rawHash?.trim() ?? "";
  const commitTime = rawCommitTime?.trim() ?? "";
  if (!hash || !commitTime) return null;

  const formattedCommitTime = formatBuildCommitTime(commitTime, options);
  if (!formattedCommitTime) return null;

  return {
    hash,
    commitTime,
    label: `${hash} · ${formattedCommitTime}`,
    title: `${hash} - ${commitTime}`,
  };
}

export const buildInfo = resolveBuildInfo(defaultCommitHash, defaultCommitTime);
