/** SvelteKit's `$app/navigation`, for tests. Records the navigations asked for
 *  instead of performing them — no tested module performs one, and recording
 *  rather than throwing is what lets a module that imports this at the top
 *  level still be loaded. */

/** Every path `goto` was asked for, oldest first. Assert on it, or ignore it. */
export const navigations: string[] = [];

/** Record a navigation instead of performing one. Always succeeds. */
export function goto(url: string): Promise<void> {
  navigations.push(url);
  return Promise.resolve();
}

/** Forget the recorded navigations, so one test cannot see another's. */
export function resetNavigations(): void {
  navigations.length = 0;
}
