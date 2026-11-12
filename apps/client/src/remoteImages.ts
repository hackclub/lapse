/**
 * Hosts of remote images that are worth passing through the `next/image` optimizer. These are also the only remote
 * hosts allowed in `images.remotePatterns` (see `next.config.ts`).
 */
export const OPTIMIZED_IMAGE_HOSTS = [
  // The public R2 bucket (`S3_PUBLIC_URL_PUBLIC`), which holds full-size thumbnails of browser-recorded timelapses.
  "lapse-legacy.hackclub-assets.com",

  // Profile pictures, which are stored as 512px images.
  "avatars.slack-edge.com",
  "secure.gravatar.com",
];

/**
 * Whether remote images are resized by the image optimizer. This is only the case on Vercel, which runs the optimizer
 * on its own infrastructure. Elsewhere (e.g. the standalone Node server), optimizing them in-process with `sharp`
 * could exceed the server's memory limit, so they're loaded directly, as they were before.
 */
const isRemoteImageOptimizationEnabled = process.env.LAPSE_OPTIMIZE_REMOTE_IMAGES === "true";

/**
 * Returns whether `src` should be loaded through the image optimizer. Anything we can't (or shouldn't) optimize, like
 * `blob:`/`data:` URLs of decrypted drafts, or hosts not in `OPTIMIZED_IMAGE_HOSTS`, should be passed to `next/image`
 * with `unoptimized` instead.
 */
export function isOptimizableImage(src: string) {
  if (!isRemoteImageOptimizationEnabled)
    return false;

  try {
    const url = new URL(src);
    return url.protocol === "https:" && OPTIMIZED_IMAGE_HOSTS.includes(url.hostname);
  }
  catch {
    return false;
  }
}
