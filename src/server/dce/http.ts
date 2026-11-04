import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Session HTTP vers une plateforme acheteur : HTTPS uniquement, hôte public
 * (pas d'IP privée : protection SSRF), redirections limitées au même hôte,
 * cookies conservés, taille de réponse bornée.
 */

export class PlatformError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlatformError";
  }
}

const USER_AGENT = "Mozilla/5.0 (compatible; TenderPilotAI/0.1; retrait de DCE)";

function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v.startsWith("::ffff:")) return isPrivateAddress(v.slice(7));
    return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

export async function assertPublicHost(host: string): Promise<void> {
  if (isIP(host) || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new PlatformError(`Hôte refusé : ${host}`);
  const addrs = await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new PlatformError(`Hôte introuvable : ${host}`);
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new PlatformError(`Hôte refusé (adresse privée) : ${host}`);
}

export type FetchedFile = { filename: string; data: Buffer; contentType: string };
export type PlatformResponse = { url: string; status: number; contentType: string; disposition: string | null; body: Buffer };

export class PlatformSession {
  private cookies = new Map<string, string>();
  private checked = false;

  constructor(
    readonly host: string,
    private readonly opts: { maxBytes: number; fetchImpl?: typeof fetch; timeoutMs?: number },
  ) {}

  async request(url: string, init: { method?: "GET" | "POST"; form?: URLSearchParams; referer?: string } = {}, hops = 0): Promise<PlatformResponse> {
    const u = new URL(url);
    if (u.protocol === "http:") u.protocol = "https:";
    if (u.protocol !== "https:" || u.hostname !== this.host) throw new PlatformError(`Navigation hors de la plateforme refusée : ${u.hostname}`);
    if (!this.checked && !this.opts.fetchImpl) await assertPublicHost(this.host);
    this.checked = true;

    const headers: Record<string, string> = { "User-Agent": USER_AGENT, "Accept-Language": "fr-FR,fr;q=0.9" };
    if (this.cookies.size) headers.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    if (init.referer) headers.Referer = init.referer;
    if (init.form) headers["Content-Type"] = "application/x-www-form-urlencoded";

    const res = await (this.opts.fetchImpl ?? fetch)(u, {
      method: init.method ?? (init.form ? "POST" : "GET"),
      headers,
      body: init.form?.toString(),
      redirect: "manual",
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 120_000),
    });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const kv = c.split(";")[0];
      const i = kv.indexOf("=");
      if (i > 0) this.cookies.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      if (hops >= 5) throw new PlatformError("Trop de redirections");
      // Après un POST, la redirection se suit en GET (comportement des navigateurs).
      return this.request(new URL(res.headers.get("location")!, u).href, { referer: u.href }, hops + 1);
    }
    return {
      url: u.href,
      status: res.status,
      contentType: res.headers.get("content-type") ?? "",
      disposition: res.headers.get("content-disposition"),
      body: await readLimited(res, this.opts.maxBytes),
    };
  }
}

async function readLimited(res: Response, maxBytes: number): Promise<Buffer> {
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > maxBytes) throw new PlatformError(`Fichier trop volumineux (${Math.round(len / 1048576)} Mo)`);
  if (!res.body) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.length;
    if (total > maxBytes) throw new PlatformError(`Fichier trop volumineux (> ${Math.round(maxBytes / 1048576)} Mo)`);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** Réponse de type fichier (et non page HTML) ? */
export function isFileResponse(r: PlatformResponse): boolean {
  if (r.disposition && /attachment|filename/i.test(r.disposition)) return true;
  return !/text\/html|application\/xhtml|text\/plain/i.test(r.contentType) && r.body.length > 0;
}

/** Nom de fichier depuis Content-Disposition (RFC 6266 / 5987), sinon valeur par défaut. */
export function filenameFrom(disposition: string | null, fallback: string): string {
  if (disposition) {
    const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(disposition)?.[1];
    if (star) {
      try {
        return decodeURIComponent(star.trim().replace(/^"|"$/g, ""));
      } catch {
        /* nom mal encodé : valeur brute ci-dessous */
      }
    }
    const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(disposition)?.[1];
    if (plain) {
      const raw = plain.trim();
      // Beaucoup de plateformes envoient de l'UTF-8 brut lu comme du latin1.
      const fixed = Buffer.from(raw, "latin1").toString("utf8");
      return fixed.includes("�") ? raw : fixed;
    }
  }
  return fallback;
}
