/** SvelteKit's `$app/navigation`, for tests.
 *
 *  Navigation is a screen's business, and no tested module performs one. The
 *  stub records calls instead of throwing, so a module that imports it at the
 *  top level can still be loaded.
 */

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
