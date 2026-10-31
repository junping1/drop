/**
 * Fetch handler for Bun.serve().
 *
 * Bun closes a connection after `idleTimeout` seconds without writes (default
 * 10 s). Video and audio players stop reading once they have buffered enough,
 * so a paused media download went idle and was cut off mid-file, which broke
 * playback of shared videos. Routes that send file bytes therefore get a
 * longer, still finite, idle timeout per request; every other route (pages,
 * APIs, dashboard) keeps the server default.
 */

import type { Server } from 'bun';

type FetchApp = { fetch: (req: Request, server?: Server<unknown>) => Response | Promise<Response> };

/**
 * Paths that may answer with raw file bytes:
 *   /f/:token, /f/:token/raw, /f/:token/:filename  (file shares; the page
 *     route serves raw bytes for media/binary/oversized files)
 *   /d/:token/raw                                 (directory share bytes, ?path=)
 * Directory pages, deep links, tree/preview/git APIs and everything else are
 * excluded so a client that stops reading cannot pin those connections open.
 */
const RAW_BYTES_PATH = /^\/(f\/[^/]+(\/raw)?|f\/[^/]+\/[^/]+|d\/[^/]+\/raw)$/;

/**
 * Idle timeout, in seconds, for raw byte routes. `Bun.serve({ idleTimeout })`
 * rejects values above 255. The per-request `server.timeout(req, s)` accepts
 * larger numbers without error but silently caps them: in a real-socket probe
 * on Bun 1.3.14 (2026-10-31) requests set to 255, 270 and 600 were all closed
 * at about 256 s, while one set to 0 was still open at 280 s. 255 s is therefore
 * the longest finite value Bun honours. It lets a paused player resume after
 * about four minutes (resuming later just issues a new Range request) while
 * still reclaiming abandoned connections; 0 (no timeout) is deliberately not used.
 */
export const STREAM_IDLE_TIMEOUT_SECONDS = 255;

export function createFetchHandler(app: FetchApp) {
  return (req: Request, server: Server<unknown>) => {
    if (RAW_BYTES_PATH.test(new URL(req.url).pathname)) {
      server.timeout(req, STREAM_IDLE_TIMEOUT_SECONDS);
    }
    return app.fetch(req, server);
  };
}
