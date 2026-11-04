import { filenameFrom, isFileResponse, PlatformError, type FetchedFile, type PlatformResponse, type PlatformSession } from "./http";

/**
 * Plateformes Atexo « MPE » (PLACE, Maximilien, Solaere, Mégalis, AURA…) :
 * le règlement de consultation se télécharge directement ; le DCE complet
 * passe par le formulaire de retrait (identifié ou anonyme, CGU acceptées).
 */

export type AtexoRef = { origin: string; host: string; id: string; orgAcronyme: string };

/** Reconnaît une URL de consultation Atexo (plusieurs formes coexistent). */
export function parseAtexoUrl(raw: string): AtexoRef | null {
  let u: URL;
  try {
    u = new URL(raw.replace(/&amp;/g, "&"));
  } catch {
    return null;
  }
  const org = u.searchParams.get("orgAcronyme") ?? u.searchParams.get("orgAcronym");
  if (!org) return null;
  const path = /\/entreprise\/consultation\/(\d+)/.exec(u.pathname)?.[1];
  const page = u.searchParams.get("page") ?? "";
  const id = path ?? (/^Entreprise\./.test(page) ? (u.searchParams.get("id") ?? u.searchParams.get("refConsultation")) : null);
  if (!id || !/^\d+$/.test(id)) return null;
  return { origin: `https://${u.hostname}`, host: u.hostname, id, orgAcronyme: org };
}

export function consultationUrl(ref: AtexoRef): string {
  return `${ref.origin}/entreprise/consultation/${ref.id}?orgAcronyme=${encodeURIComponent(ref.orgAcronyme)}`;
}

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&#0?39;/g, "'").replace(/&quot;/g, '"');
const attr = (tag: string, name: string) => {
  const v = new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, "i").exec(tag)?.[1];
  return v === undefined ? undefined : decode(v);
};

/** Liens de téléchargement de la page de consultation. */
export function consultationLinks(html: string, base: string) {
  const href = (id: string) => {
    const tag = new RegExp(`<a\\b[^>]*\\bid="${id}"[^>]*>`, "i").exec(html)?.[0];
    const h = tag && attr(tag, "href");
    return h && !h.startsWith("javascript") ? new URL(h, base).href : null;
  };
  return {
    rc: href("linkDownloadReglement"),
    dce: href("linkDownloadDce"),
    complement: href("linkDownloadComplement"),
  };
}

/** Champs d'un formulaire Prado : tous les champs cachés et l'état de page. */
export function hiddenFields(html: string): URLSearchParams {
  const out = new URLSearchParams();
  for (const m of html.matchAll(/<input\b[^>]*>/gi)) {
    const tag = m[0];
    const name = attr(tag, "name");
    if (!name) continue;
    const type = (attr(tag, "type") ?? "text").toLowerCase();
    if (type === "hidden" || name === "PRADO_PAGESTATE") out.set(name, attr(tag, "value") ?? "");
  }
  return out;
}

/** Préfixe des champs du formulaire de retrait (ex. ctl0$CONTENU_PAGE$EntrepriseFormulaireDemande$). */
function formPrefix(html: string): string {
  const name = /name="([^"]*\$)accepterConditions"/.exec(html)?.[1];
  if (!name) throw new PlatformError("Formulaire de retrait du DCE non reconnu sur cette plateforme");
  return name;
}

export type Identity = {
  mode: "ANONYMOUS" | "IDENTIFIED";
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  legalName: string;
  siret: string;
  address: string;
  address2: string;
  postalCode: string;
  city: string;
};

/** Formulaire de retrait rempli (radio identifié/anonyme, coordonnées, CGU, bouton Valider). */
export function buildDceRequest(html: string, who: Identity): URLSearchParams {
  const p = formPrefix(html);
  const f = hiddenFields(html);
  const submit = /<input\b[^>]*type="submit"[^>]*name="([^"]*validateButton)"[^>]*>/i.exec(html)?.[1];
  if (!submit) throw new PlatformError("Bouton de validation du formulaire de retrait introuvable");

  f.set(`${p}RadioGroup`, `${p}${who.mode === "ANONYMOUS" ? "choixAnonyme" : "choixTelechargement"}`);
  f.set(`${p}accepterConditions`, "on");
  if (who.mode === "IDENTIFIED") {
    const siret = who.siret.replace(/\D/g, "");
    const values: Record<string, string> = {
      nom: who.lastName, prenom: who.firstName, email: who.email, raisonSocial: who.legalName,
      siren: siret.slice(0, 9), siret: siret.slice(9, 14), address: who.address, address2: who.address2,
      tel: who.phone.replace(/[\s.]/g, ""), cp: who.postalCode, ville: who.city, fax: "",
    };
    for (const [k, v] of Object.entries(values)) f.set(`${p}${k}`, v);
    f.set(`${p}etablissementEntreprise`, `${p}france`);
  }
  f.set("PRADO_POSTBACK_TARGET", submit);
  f.set("PRADO_POSTBACK_PARAMETER", "");
  f.set(submit, "Valider");
  return f;
}

/** Étape suivante après validation : lien direct ou action Prado menant au téléchargement complet. */
export function nextDownloadStep(html: string, base: string): { url: string } | { target: string } | null {
  // 1. Lien direct vers un téléchargement (DCE complet de préférence).
  const links = [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => ({ href: decode(m[1]), text: m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() }))
    .filter((l) => /page=Entreprise\.Entreprise(Download|Telechargement)(?!Reglement|Complement)/i.test(l.href) && !/Demande/i.test(l.href));
  const direct = links.find((l) => /complet|dce|dossier/i.test(l.text + l.href)) ?? links[0];
  if (direct) return { url: new URL(direct.href, base).href };

  // 2. Bouton / lien Prado (postback) : « Télécharger le DCE complet », « Télécharger la sélection »…
  const targets = [
    ...[...html.matchAll(/'EventTarget':"([^"]+)"/g)].map((m) => m[1]),
    ...[...html.matchAll(/<input\b[^>]*type="submit"[^>]*name="([^"]+)"[^>]*>/gi)].map((m) => m[1]),
  ];
  const rank = (t: string) => (/complet/i.test(t) ? 0 : /tout|all/i.test(t) ? 1 : 2);
  const candidates = targets.filter((t) => /t[eé]l[eé]charg|download|dce/i.test(t) && !/annuler|cancel|reglement|complement|inscription|identif/i.test(t));
  candidates.sort((a, b) => rank(a) - rank(b));
  return candidates[0] ? { target: candidates[0] } : null;
}

/** Message d'erreur visible renvoyé par la plateforme (validation du formulaire…). */
export function pageError(html: string): string | null {
  const m = /<(?:div|span|p)\b[^>]*class="[^"]*(?:msg-erreur|alert-danger|message-erreur|bloc-message-erreur)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|span|p)>/i.exec(html);
  const text = m?.[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 300) : null;
}

function asHtml(r: PlatformResponse): string {
  return r.body.toString("utf8");
}

function asFile(r: PlatformResponse, fallback: string): FetchedFile {
  return { filename: filenameFrom(r.disposition, fallback), data: r.body, contentType: r.contentType };
}

export type AtexoResult = { files: Array<FetchedFile & { kind: "RC" | "DCE" | "COMPLEMENT" }>; warnings: string[] };

/** Retrait des pièces d'une consultation Atexo. */
export async function retrieveAtexo(session: PlatformSession, ref: AtexoRef, who: Identity): Promise<AtexoResult> {
  const page = consultationUrl(ref);
  const res = await session.request(page);
  if (res.status !== 200) throw new PlatformError(`Consultation inaccessible (HTTP ${res.status})`);
  const html = asHtml(res);
  const links = consultationLinks(html, page);
  if (!links.rc && !links.dce) throw new PlatformError("Aucun document téléchargeable sur la page de la consultation (consultation clôturée ou restreinte ?)");

  const out: AtexoResult = { files: [], warnings: [] };
  const getFile = async (url: string, kind: "RC" | "COMPLEMENT", fallback: string) => {
    try {
      const r = await session.request(url, { referer: page });
      if (r.status === 200 && isFileResponse(r)) out.files.push({ ...asFile(r, fallback), kind });
      else out.warnings.push(`${fallback} : réponse inattendue (HTTP ${r.status})`);
    } catch (err) {
      out.warnings.push(`${fallback} : ${(err as Error).message}`);
    }
  };
  if (links.rc) await getFile(links.rc, "RC", `RC-${ref.id}.pdf`);
  if (links.complement) await getFile(links.complement, "COMPLEMENT", `Complement-${ref.id}.pdf`);

  if (!links.dce) {
    out.warnings.push("DCE complet non proposé en téléchargement sur cette consultation");
    return out;
  }
  try {
    const formRes = await session.request(links.dce, { referer: page });
    if (isFileResponse(formRes)) {
      out.files.push({ ...asFile(formRes, `DCE-${ref.id}.zip`), kind: "DCE" });
      return out;
    }
    let current = asHtml(formRes);
    if (/code d'acc[eè]s|codeAcces/i.test(current) && !/accepterConditions/.test(current)) {
      throw new PlatformError("Consultation restreinte : un code d'accès fourni par l'acheteur est requis");
    }
    let r = await session.request(formRes.url, { form: buildDceRequest(current, who), referer: formRes.url });
    // Jusqu'à 3 étapes après validation (page de confirmation, sélection des pièces…).
    for (let step = 0; step < 3; step++) {
      if (r.status === 200 && isFileResponse(r)) {
        out.files.push({ ...asFile(r, `DCE-${ref.id}.zip`), kind: "DCE" });
        return out;
      }
      current = asHtml(r);
      const err = pageError(current);
      const next = nextDownloadStep(current, r.url);
      if (!next) throw new PlatformError(err ? `Retrait refusé par la plateforme : ${err}` : "Lien de téléchargement du DCE introuvable après validation du formulaire");
      if ("url" in next) {
        r = await session.request(next.url, { referer: r.url });
      } else {
        const f = hiddenFields(current);
        f.set("PRADO_POSTBACK_TARGET", next.target);
        f.set("PRADO_POSTBACK_PARAMETER", "");
        r = await session.request(r.url, { form: f, referer: r.url });
      }
    }
    throw new PlatformError("Téléchargement du DCE non obtenu après plusieurs étapes");
  } catch (err) {
    out.warnings.push(`DCE complet : ${(err as Error).message}`);
    return out;
  }
}
