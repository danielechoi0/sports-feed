// Tiny in-memory cache with in-flight de-duplication plus a JSON disk store.
//
// cached(key, maxAgeMs, fn): returns the stored value if it is younger than
// maxAgeMs, otherwise runs fn (once, even under concurrent callers) and stores
// the result. Each caller chooses its own acceptable staleness, so the day view
// can tolerate a 15 minute old summary while the detail view asks for a fresh one.
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const mem = new Map();
const MAX_RETAIN_MS = 24 * 3600_000;

export async function cached(key, maxAgeMs, fn) {
  const now = Date.now();
  const hit = mem.get(key);
  if (hit) {
    if (hit.promise) return hit.promise;
    if (now - hit.storedAt < maxAgeMs) return hit.value;
  }
  const promise = fn().then(
    (value) => {
      mem.set(key, { value, storedAt: Date.now() });
      return value;
    },
    (err) => {
      // Keep a stale value around if we had one; otherwise drop the entry.
      if (hit && !hit.promise) mem.set(key, hit);
      else mem.delete(key);
      throw err;
    },
  );
  mem.set(key, { promise, storedAt: now, value: hit?.value });
  return promise;
}

export function cacheStats() {
  return { entries: mem.size };
}

setInterval(() => {
  const cutoff = Date.now() - MAX_RETAIN_MS;
  for (const [k, v] of mem) if (!v.promise && v.storedAt < cutoff) mem.delete(k);
}, 3600_000).unref();

// Disk cache location: CACHE_DIR env var, else ./.cache, else the OS temp dir.
// Serverless platforms (Vercel) mount the project read-only and only allow
// writes under /tmp, so there the temp dir is tried first. If nothing is
// writable the disk cache is simply disabled and everything stays in memory.
function resolveCacheDir() {
  const tmp = path.join(os.tmpdir(), 'sports-dashboard-cache');
  const local = path.resolve(process.cwd(), '.cache');
  const candidates = process.env.CACHE_DIR
    ? [process.env.CACHE_DIR]
    : process.env.VERCEL
      ? [tmp, local]
      : [local, tmp];
  for (const dir of candidates) {
    try {
      fsSync.mkdirSync(dir, { recursive: true });
      fsSync.accessSync(dir, fsSync.constants.W_OK);
      return dir;
    } catch {
      /* try the next candidate */
    }
  }
  console.warn('disk cache disabled: no writable cache directory');
  return null;
}

export const CACHE_DIR = resolveCacheDir();

export async function readDisk(name, fallback) {
  if (!CACHE_DIR) return fallback;
  try {
    const txt = await fs.readFile(path.join(CACHE_DIR, name), 'utf8');
    return JSON.parse(txt);
  } catch {
    return fallback;
  }
}

export async function writeDisk(name, data) {
  if (!CACHE_DIR) return;
  try {
    const file = path.join(CACHE_DIR, name);
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data));
    await fs.rename(tmp, file);
  } catch (e) {
    console.warn(`disk cache write failed for ${name}: ${e.message}`);
  }
}

// Simple concurrency limiter: const run = pLimit(5); await run(() => fetch(...))
export function pLimit(n) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= n || queue.length === 0) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => {
        active--;
        next();
      });
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
}
