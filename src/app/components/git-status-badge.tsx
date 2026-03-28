import type { GitFileStatus } from "../tauri-client/git";

const STATUS_COLORS: Record<GitFileStatus, string> = {
  modified: "var(--cf-git-modified)",
  added: "var(--cf-git-added)",
  untracked: "var(--cf-git-untracked)",
};

const STATUS_LABELS: Record<GitFileStatus, string> = {
  modified: "M",
  added: "A",
  untracked: "U",
};

interface GitStatusBadgeProps {
  status: GitFileStatus;
}

export function GitStatusBadge({ status }: GitStatusBadgeProps) {
  return (
    <span
      className="ml-auto shrink-0 text-[10px] font-semibold leading-none"
      style={{ color: STATUS_COLORS[status] }}
      title={status}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
