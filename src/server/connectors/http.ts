import { ConnectorError } from "./types";

export type FetchLike = typeof fetch;

type Options = {
  minIntervalMs: number;
  maxRetries?: number;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Client HTTP de connecteur : espacement minimal entre requêtes (respect des
 * quotas), timeout, retry exponentiel sur 429/5xx/erreurs réseau, `Retry-After`.
 */
export class ThrottledHttp {
  private last = 0;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: Options) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  async json<T>(url: string, init: RequestInit = {}): Promise<T> {
    const maxRetries = this.opts.maxRetries ?? 4;
    let attempt = 0;
    for (;;) {
      const wait = this.last + this.opts.minIntervalMs - Date.now();
      if (wait > 0) await this.sleep(wait);
      this.last = Date.now();

      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          ...init,
          headers: { Accept: "application/json", "User-Agent": "TenderPilotAI/0.1 (veille marchés publics)", ...init.headers },
          signal: AbortSignal.timeout(this.opts.timeoutMs ?? 30_000),
        });
      } catch (err) {
        if (attempt >= maxRetries) {
          throw new ConnectorError(`Erreur réseau : ${(err as Error).message}`, undefined, true);
        }
        await this.sleep(backoff(attempt++));
        continue;
      }

      if (res.ok) return (await res.json()) as T;

      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < maxRetries) {
        const retryAfter = Number(res.headers.get("retry-after"));
        await this.sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoff(attempt));
        attempt++;
        continue;
      }
      const body = await res.text().catch(() => "");
      throw new ConnectorError(`HTTP ${res.status} : ${body.slice(0, 300)}`, res.status, retryable);
    }
  }
}

function backoff(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 250);
}
