/** SvelteKit's `$app/navigation`, recorded rather than performed. */
export const visited: string[] = [];
export const goto = async (url: string): Promise<void> => { visited.push(url); };
export const invalidateAll = async (): Promise<void> => {};
