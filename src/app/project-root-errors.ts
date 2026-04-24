function getErrorMessage(error: unknown): string | null {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" ? message : null;
  }

  return null;
}

export function isProjectRootEscapeError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return message?.includes("escapes project root") ?? false;
}

export function saveAsErrorMessage(error: unknown): string {
  if (isProjectRootEscapeError(error)) {
    return "Save As can only save inside the current project folder. Choose a location inside the open project.";
  }

  const message = getErrorMessage(error);
  return message ? `Save As failed: ${message}` : "Save As failed";
}
