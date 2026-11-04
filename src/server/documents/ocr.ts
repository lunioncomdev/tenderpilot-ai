import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { env } from "../env";
import { logger } from "../logger";

/**
 * OCR des PDF scannés : rendu des pages en images (pdftoppm, Poppler) puis
 * reconnaissance (Tesseract, français + anglais). Tout reste local : aucun
 * document n'est envoyé à un service tiers.
 */

const run = promisify(execFile);

export class OcrUnavailableError extends Error {
  constructor() {
    super("OCR indisponible : installer tesseract-ocr, tesseract-ocr-fra et poppler-utils");
  }
}

let available: Promise<boolean> | undefined;

/** Vérifie une seule fois la présence des binaires. */
export function ocrAvailable(): Promise<boolean> {
  available ??= Promise.all([run("tesseract", ["--version"]), run("pdftoppm", ["-v"])]).then(
    () => true,
    () => false,
  );
  return available;
}

/** Texte reconnu par page (numéro de page 1-based → texte). */
export async function ocrPdfPages(buf: Buffer, pages: number[]): Promise<Map<number, string>> {
  if (!(await ocrAvailable())) throw new OcrUnavailableError();
  const { OCR_MAX_PAGES, OCR_LANGS, OCR_DPI } = env();
  const selected = pages.slice(0, OCR_MAX_PAGES);
  if (selected.length < pages.length) logger.warn({ total: pages.length, max: OCR_MAX_PAGES }, "OCR limité aux premières pages");

  const dir = await mkdtemp(join(tmpdir(), "tp-ocr-"));
  const out = new Map<number, string>();
  try {
    const pdf = join(dir, "in.pdf");
    await writeFile(pdf, buf);
    for (const page of selected) {
      // Une page à la fois : mémoire bornée, et un échec n'interrompt pas le reste.
      try {
        const prefix = join(dir, `p${page}`);
        await run("pdftoppm", ["-r", String(OCR_DPI), "-gray", "-png", "-f", String(page), "-l", String(page), pdf, prefix], { timeout: 60_000 });
        const img = (await readdir(dir)).find((f) => f.startsWith(`p${page}-`) && f.endsWith(".png"));
        if (!img) continue;
        const { stdout } = await run("tesseract", [join(dir, img), "stdout", "-l", OCR_LANGS, "--psm", "1"], {
          timeout: 120_000,
          maxBuffer: 16 * 1024 * 1024,
          env: { ...process.env, OMP_THREAD_LIMIT: "1" },
        });
        out.set(page, stdout);
        await rm(join(dir, img), { force: true });
      } catch (err) {
        logger.warn({ err, page }, "échec OCR d'une page");
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return out;
}
