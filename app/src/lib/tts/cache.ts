/** Where the voice's weights are kept, named in one place. */

/* The service worker keeps its own copy of this name, since it cannot import
   from here, and must not clear the bucket on an update. */

/** The Cache API bucket the weights live in. The number is part of the name:
 *  a voice that changes gets a new bucket rather than a half-updated one. */
export const VOICE_CACHE = 'supertonic-3';
