import { logger } from "../logger";
import { redis } from "../redis";

/**
 * Fenêtre fixe Redis. En cas d'indisponibilité de Redis on laisse passer
 * (fail-open) mais on journalise : la connexion reste protégée par bcrypt.
 */
export async function rateLimit(key: string, limit: number, windowSec: number): Promise<boolean> {
  try {
    const r = redis();
    const k = `rl:${key}`;
    const count = await r.incr(k);
    if (count === 1) await r.expire(k, windowSec);
    return count <= limit;
  } catch (err) {
    logger.warn({ err, key }, "rate limit indisponible");
    return true;
  }
}
