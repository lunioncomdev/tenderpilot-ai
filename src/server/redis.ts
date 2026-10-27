import IORedis from "ioredis";
import { env } from "./env";

const globalForRedis = globalThis as unknown as { redis?: IORedis };

/** Connexion partagée (maxRetriesPerRequest=null requis par BullMQ). */
export function redis(): IORedis {
  if (!globalForRedis.redis) {
    globalForRedis.redis = new IORedis(env().REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false });
  }
  return globalForRedis.redis;
}
