import path from "path";
import fs from "fs/promises";
import { createReadStream, existsSync, mkdirSync } from "fs";
import type { Readable } from "stream";
import { env } from "../config/env";

/**
 * Camada de armazenamento de arquivos com dois adaptadores:
 *  - "disk"     : grava em ./uploads (ou /tmp/uploads na Vercel). Só desenvolvimento.
 *  - "supabase" : Supabase Storage via REST (sem SDK). Recomendado para produção.
 *
 * O restante da aplicação só conhece a `storageKey` (string opaca) e usa as
 * funções abaixo. Trocar de provedor é só mudar STORAGE_DRIVER no .env.
 */

const diskRoot = process.env.VERCEL ? path.join("/tmp", "uploads") : path.resolve(process.cwd(), "uploads");

export type StoredFile = {
  storageKey: string;
  sizeBytes: number;
};

export interface StorageAdapter {
  put(key: string, data: Buffer, contentType: string): Promise<StoredFile>;
  getStream(key: string): Promise<Readable>;
  getBytes(key: string): Promise<Buffer>;
  getSignedUrl(key: string, fileName: string): Promise<string | null>;
  remove(key: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Disk adapter
// ---------------------------------------------------------------------------

const diskAdapter: StorageAdapter = {
  async put(key, data) {
    const target = path.join(diskRoot, key);
    mkdirSync(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data);
    return { storageKey: key, sizeBytes: data.byteLength };
  },
  async getStream(key) {
    const target = path.join(diskRoot, key);
    if (!existsSync(target)) throw new Error(`Arquivo não encontrado: ${key}`);
    return createReadStream(target);
  },
  async getBytes(key) {
    const target = path.join(diskRoot, key);
    if (!existsSync(target)) throw new Error(`Arquivo não encontrado: ${key}`);
    return fs.readFile(target);
  },
  async getSignedUrl() {
    // Sem URL assinada em disco — o download passa sempre pela API autenticada.
    return null;
  },
  async remove(key) {
    const target = path.join(diskRoot, key);
    await fs.rm(target, { force: true });
  },
};

// ---------------------------------------------------------------------------
// Supabase Storage adapter (REST)
// ---------------------------------------------------------------------------

function supabaseHeaders(extra: Record<string, string> = {}) {
  return {
    Authorization: `Bearer ${env.storage.supabaseServiceKey}`,
    apikey: env.storage.supabaseServiceKey,
    ...extra,
  };
}

function supabaseObjectUrl(key: string) {
  return `${env.storage.supabaseUrl}/storage/v1/object/${env.storage.bucket}/${encodeURI(key)}`;
}

const supabaseAdapter: StorageAdapter = {
  async put(key, data, contentType) {
    const res = await fetch(supabaseObjectUrl(key), {
      method: "POST",
      headers: supabaseHeaders({ "Content-Type": contentType, "x-upsert": "true" }),
      body: new Blob([data]),
    });
    if (!res.ok) {
      throw new Error(`Falha ao enviar ao Supabase Storage (${res.status}): ${await res.text()}`);
    }
    return { storageKey: key, sizeBytes: data.byteLength };
  },
  async getStream(key) {
    const res = await fetch(supabaseObjectUrl(key), { headers: supabaseHeaders() });
    if (!res.ok || !res.body) {
      throw new Error(`Falha ao baixar do Supabase Storage (${res.status})`);
    }
    // Web ReadableStream -> Node Readable
    const { Readable } = await import("stream");
    return Readable.fromWeb(res.body as never);
  },
  async getBytes(key) {
    const res = await fetch(supabaseObjectUrl(key), { headers: supabaseHeaders() });
    if (!res.ok) throw new Error(`Falha ao baixar do Supabase Storage (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  },
  async getSignedUrl(key, fileName) {
    const res = await fetch(
      `${env.storage.supabaseUrl}/storage/v1/object/sign/${env.storage.bucket}/${encodeURI(key)}`,
      {
        method: "POST",
        headers: supabaseHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ expiresIn: env.storage.signedUrlTtl }),
      }
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { signedURL?: string };
    if (!json.signedURL) return null;
    const download = encodeURIComponent(fileName);
    return `${env.storage.supabaseUrl}/storage/v1${json.signedURL}&download=${download}`;
  },
  async remove(key) {
    await fetch(supabaseObjectUrl(key), { method: "DELETE", headers: supabaseHeaders() }).catch(() => undefined);
  },
};

// ---------------------------------------------------------------------------

export const storage: StorageAdapter = env.storage.driver === "supabase" ? supabaseAdapter : diskAdapter;

export function buildStorageKey(projectId: string, fileName: string) {
  const safe = fileName.replace(/[^\w.\-]+/g, "_").slice(-120);
  return `projects/${projectId}/${Date.now()}-${Math.round(Math.random() * 1e9)}-${safe}`;
}
