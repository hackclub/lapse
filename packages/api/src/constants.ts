// This file defines limits and specific numerical constants used by the server. It should be assumed that these
// are arbitrary and may be changed at any time.

// Aiming for ~6hrs of real-time footage to result in a timelapse that's ~10min long.

/**
 * The speed at which frames (N of which correspond to `TIMELAPSE_FACTOR` seconds of real-time) are played back.
 */
export const TIMELAPSE_FPS = 24;

/**
 * The amount of real-time seconds that correspond to 1 second of a timelapse. For example, a value of `4` means that 4 seconds of
 * real-time footage will result in a one second timelapse.
 */
export const TIMELAPSE_FACTOR = 60; // 1 minute = 1 second

/**
 * The maximum amount of frames accepted by the server. Files submitted that exceed this threshold might either fail to process or
 * be truncated.
 */
export const MAX_VIDEO_FRAME_COUNT = 86400;

/**
 * The number of pixels that a single extent of generated thumbnails should span. For example, if a 16:9 thumbnail would be generated,
 * it would have a resolution of `w=THUMBNAIL_SIZE, h=THUMBNAIL_SIZE / (16 / 9)`.
 */
export const THUMBNAIL_SIZE = 640;

/**
 * The combined maximum size of video chunks that the client can upload, in bytes.
 */
export const MAX_VIDEO_UPLOAD_SIZE = 384 * 1024 * 1024; // 384 MiB

/**
 * The maximum size for an encrypted thumbnail. As thumbnails for published videos are always generated on the server, this constant
 * does not affect thumbnails for such timelapses.
 */
export const MAX_THUMBNAIL_UPLOAD_SIZE = 6 * 1024 * 1024; // 6 MiB

/**
 * The lifetime of a single upload token - i.e., by which time it expires.
 */
export const UPLOAD_TOKEN_LIFETIME_MS = 20 * 60 * 1000;
