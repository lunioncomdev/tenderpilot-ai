import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client, CreateBucketCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../env";

export interface ObjectStorage {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /** URL de téléchargement temporaire (après contrôle d'accès par l'appelant). */
  signedDownloadUrl(key: string, filename: string, ttlSec?: number): Promise<string>;
}

function assertSafeKey(key: string) {
  if (!/^[a-zA-Z0-9/_.-]+$/.test(key) || key.includes("..") || key.startsWith("/")) {
    throw new Error("Clé de stockage invalide");
  }
}

export function storageKeyFor(orgId: string, tenderId: string, id: string, ext: string) {
  const safeExt = ext.replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase();
  return `org/${orgId}/tenders/${tenderId}/${id}${safeExt ? `.${safeExt}` : ""}`;
}

// ── Driver local : fichiers sur disque + liens signés HMAC servis par /api/v1/files ──

export function signLocalToken(key: string, filename: string, expiresAt: number): string {
  return createHmac("sha256", env().SESSION_SECRET).update(`${key}\n${filename}\n${expiresAt}`).digest("base64url");
}

export function verifyLocalToken(key: string, filename: string, expiresAt: number, sig: string): boolean {
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;
  const expected = Buffer.from(signLocalToken(key, filename, expiresAt));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

class LocalStorage implements ObjectStorage {
  constructor(private readonly root: string) {}
  private file(key: string) {
    assertSafeKey(key);
    return path.join(this.root, ...key.split("/"));
  }
  async put(key: string, data: Buffer) {
    const f = this.file(key);
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f, data);
  }
  get(key: string) {
    return readFile(this.file(key));
  }
  async delete(key: string) {
    await rm(this.file(key), { force: true });
  }
  async signedDownloadUrl(key: string, filename: string, ttlSec = 300) {
    const exp = Date.now() + ttlSec * 1000;
    const params = new URLSearchParams({ key, name: filename, exp: String(exp), sig: signLocalToken(key, filename, exp) });
    return `/api/v1/files?${params}`;
  }
}

class S3Storage implements ObjectStorage {
  private readonly client: S3Client;
  private bucketReady?: Promise<void>;
  constructor(private readonly bucket: string) {
    const e = env();
    this.client = new S3Client({
      region: e.S3_REGION,
      endpoint: e.S3_ENDPOINT,
      forcePathStyle: e.S3_FORCE_PATH_STYLE,
      credentials:
        e.S3_ACCESS_KEY_ID && e.S3_SECRET_ACCESS_KEY
          ? { accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY }
          : undefined,
    });
  }
  private ensureBucket() {
    this.bucketReady ??= this.client
      .send(new HeadBucketCommand({ Bucket: this.bucket }))
      .then(() => undefined)
      .catch(async () => {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      });
    return this.bucketReady;
  }
  async put(key: string, data: Buffer, contentType: string) {
    assertSafeKey(key);
    await this.ensureBucket();
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: contentType, ServerSideEncryption: undefined }),
    );
  }
  async get(key: string) {
    assertSafeKey(key);
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }
  async delete(key: string) {
    assertSafeKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
  signedDownloadUrl(key: string, filename: string, ttlSec = 300) {
    assertSafeKey(key);
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      }),
      { expiresIn: ttlSec },
    );
  }
}

let instance: ObjectStorage | undefined;

export function storage(): ObjectStorage {
  if (!instance) {
    const e = env();
    instance = e.STORAGE_DRIVER === "s3" ? new S3Storage(e.S3_BUCKET) : new LocalStorage(path.resolve(e.STORAGE_LOCAL_DIR));
  }
  return instance;
}

/** Réservé aux tests. */
export function setStorageForTests(s: ObjectStorage | undefined) {
  instance = s;
}
