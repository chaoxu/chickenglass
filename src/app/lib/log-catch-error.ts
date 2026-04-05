/**
 * Create a Promise.catch-compatible logger that appends the rejected error
 * after any contextual details.
 */
export function logCatchError(
  context: string,
  ...details: readonly unknown[]
): (error: unknown) => void {
  return (error: unknown) => {
    console.error(context, ...details, error);
  };
}
