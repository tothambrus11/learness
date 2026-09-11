/** Where the voice's weights are kept, named in one place.
 *
 *  Three parties care: the worker that fills it, tts.ts when you ask for the
 *  380 MB back, and the service worker, which must not clear it on an update
 *  (it keeps its own copy of the name, since a service worker cannot import
 *  from here). */

/** The Cache API bucket the weights live in. The number is part of the name:
 *  a voice that changes gets a new bucket rather than a half-updated one. */
export const VOICE_CACHE = 'supertonic-3';
