/**
 * Probe helper for start.bat.
 *
 * The launcher needs to know whether a bridge is already running, and doing
 * that from batch is fragile: netstat misses local listeners on this machine,
 * and nesting a quoted node path inside `for /f '...'` breaks the quotes.
 * A tiny script sidesteps both problems.
 *
 * Exit code 0 = bridge is up, 1 = not up.
 * Prints "UP" or "DOWN" plus a short reason on stdout.
 */
const port = Number(process.argv[2] || 8788);
const url = `http://127.0.0.1:${port}/health`;

try {
  const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
  if (!res.ok) {
    console.log('DOWN');
    console.log(`health returned ${res.status}`);
    process.exit(1);
  }
  const body = await res.json();
  console.log('UP');
  // Useful for the launcher to echo back to the user.
  console.log(`site=${body.site || '?'} model=${body.model || '?'} auth=${body.authRequired ? 'on' : 'off'}`);
  process.exit(0);
} catch (err) {
  console.log('DOWN');
  process.exit(1);
}
