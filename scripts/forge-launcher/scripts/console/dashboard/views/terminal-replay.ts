/**
 * Pure replay-buffer helpers for the Console terminal.
 *
 * The terminal view keeps its WebSocket alive across route changes so a session
 * keeps running in the background. While the view is unmounted the socket
 * cannot render into an xterm, so output is buffered here and replayed on
 * remount. The buffer is capped so a long-running session cannot grow it
 * without bound; trimming keeps the newest bytes and adds a single notice.
 *
 * Kept free of DOM and xterm imports so it can be unit-tested under Node.
 */

export const MAX_REPLAY_BYTES = 256 * 1024;
export const TRUNCATION_NOTICE =
  "\r\n[Console] Earlier terminal output was truncated while you were away.\r\n";

/**
 * Appends a chunk to the replay buffer, keeping at most `max` bytes of recent
 * output. A single truncation notice is kept at the front after any trim.
 */
export function appendReplay(buffer: string, chunk: string, max = MAX_REPLAY_BYTES): string {
  const hadNotice = buffer.startsWith(TRUNCATION_NOTICE);
  const base = hadNotice ? buffer.slice(TRUNCATION_NOTICE.length) : buffer;
  const next = base + chunk;
  if (next.length <= max) return hadNotice ? TRUNCATION_NOTICE + next : next;
  return TRUNCATION_NOTICE + next.slice(next.length - max);
}
