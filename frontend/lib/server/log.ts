/**
 * Tiny leveled logger used by every server module.
 *
 * Why not pino / winston: this is a Next.js Route Handler runtime — we
 * just need readable, scoped lines in the dev terminal and Vercel logs.
 * A 60-line module that prefixes timestamps and supports scopes is
 * enough; adding a real logger dependency buys nothing.
 *
 * Usage
 * -----
 *   import { createLogger } from "@/lib/server/log";
 *   const log = createLogger("pipeline");
 *   log.info("starting", { cbe });
 *   await log.time("kbo.lookup", () => kbo.lookup(q));
 *
 * Output
 * ------
 *   14:32:18.041 INFO  [pipeline] starting {"cbe":"0760699239"}
 *   14:32:19.287 INFO  [pipeline] kbo.lookup ok {"ms":1246}
 *
 * Env knobs
 * ---------
 *   LOG_LEVEL=debug|info|warn|error    (default: info)
 *   LOG_PRETTY=false                    disable timestamp/level prefix
 */

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<Level, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const MIN_LEVEL: Level = ((): Level => {
  const raw = (process.env.LOG_LEVEL ?? "").toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
    return raw;
  }
  return "info";
})();

const PRETTY = process.env.LOG_PRETTY !== "false";

function shouldLog(level: Level): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[MIN_LEVEL];
}

/** HH:MM:SS.mmm — enough resolution for dev, no date noise. */
function timestamp(): string {
  return new Date().toISOString().slice(11, 23);
}

function format(
  scope: string,
  level: Level,
  msg: string,
  meta?: Record<string, unknown>,
): string {
  const metaStr = meta && Object.keys(meta).length > 0 ? " " + safeStringify(meta) : "";
  if (!PRETTY) {
    return JSON.stringify({ ts: new Date().toISOString(), level, scope, msg, ...meta });
  }
  const lvl = level.toUpperCase().padEnd(5);
  return `${timestamp()} ${lvl} [${scope}] ${msg}${metaStr}`;
}

/**
 * JSON.stringify with circular-ref + BigInt fallback. We log mostly
 * primitives so this is defensive, not hot-path-critical.
 */
function safeStringify(meta: Record<string, unknown>): string {
  try {
    return JSON.stringify(meta, (_k, v) => {
      if (typeof v === "bigint") return v.toString();
      if (v instanceof Error) {
        return { name: v.name, message: v.message, stack: v.stack };
      }
      return v;
    });
  } catch {
    return "[unserialisable meta]";
  }
}

export type Logger = {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  /** Build a child logger with an appended scope segment. */
  child(subscope: string): Logger;
  /**
   * Run *fn* and log its duration. On success: info `<label> ok` with
   * `ms`. On throw: warn `<label> failed` with `ms` + `error`, then
   * rethrows so the caller's control flow is unchanged.
   */
  time<T>(label: string, fn: () => Promise<T>): Promise<T>;
};

export function createLogger(scope: string): Logger {
  return {
    debug(msg, meta) {
      if (shouldLog("debug")) console.debug(format(scope, "debug", msg, meta));
    },
    info(msg, meta) {
      if (shouldLog("info")) console.log(format(scope, "info", msg, meta));
    },
    warn(msg, meta) {
      if (shouldLog("warn")) console.warn(format(scope, "warn", msg, meta));
    },
    error(msg, meta) {
      if (shouldLog("error")) console.error(format(scope, "error", msg, meta));
    },
    child(subscope: string) {
      return createLogger(`${scope}:${subscope}`);
    },
    async time<T>(label: string, fn: () => Promise<T>): Promise<T> {
      const start = performance.now();
      try {
        const result = await fn();
        const ms = Math.round(performance.now() - start);
        if (shouldLog("info")) {
          console.log(format(scope, "info", `${label} ok`, { ms }));
        }
        return result;
      } catch (err) {
        const ms = Math.round(performance.now() - start);
        const message = err instanceof Error ? err.message : String(err);
        if (shouldLog("warn")) {
          console.warn(format(scope, "warn", `${label} failed`, { ms, error: message }));
        }
        throw err;
      }
    },
  };
}

/** Default app-wide logger. Prefer a scoped logger in each module. */
export const log = createLogger("app");
