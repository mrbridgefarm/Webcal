import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import type { CalDavCredentials } from './davClient.js';

export interface ShareRecord {
  token: string;
  label: string;
  calendarUrls: string[];
  calendarNames: string[];
  serverUrl: string;
  username: string;
  encryptedPassword: string;
  hideDetails: boolean;
  createdAt: string;
}

export interface SharePublicInfo {
  token: string;
  label: string;
  calendarUrls: string[];
  calendarNames: string[];
  hideDetails: boolean;
  createdAt: string;
}

const PREFERRED_DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
const FALLBACK_DATA_DIR = path.join(os.tmpdir(), 'dav-sync-data');

let resolvedDataDir: string | null = null;
let cachedSecretKey: Buffer | null = null;
let memoryShares: ShareRecord[] | null = null;

function getWritableDataDir(): string {
  if (resolvedDataDir) return resolvedDataDir;
  for (const dir of [PREFERRED_DATA_DIR, FALLBACK_DATA_DIR]) {
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const probe = path.join(dir, '.write_probe');
      fs.writeFileSync(probe, 'ok', { mode: 0o600 });
      fs.unlinkSync(probe);
      resolvedDataDir = dir;
      return dir;
    } catch {
      // Prøv fallback-mappe hvis /app/data ejes af root i en eksisterende Docker-volume
    }
  }
  resolvedDataDir = FALLBACK_DATA_DIR;
  return resolvedDataDir;
}

function getSecretKey(): Buffer {
  if (cachedSecretKey) return cachedSecretKey;

  if (process.env.SHARE_SECRET) {
    cachedSecretKey = crypto.createHash('sha256').update(process.env.SHARE_SECRET).digest();
    return cachedSecretKey;
  }

  for (const dir of [getWritableDataDir(), PREFERRED_DATA_DIR, FALLBACK_DATA_DIR]) {
    const keyFile = path.join(dir, '.share_secret');
    try {
      if (fs.existsSync(keyFile)) {
        const hex = fs.readFileSync(keyFile, 'utf8').trim();
        if (hex.length === 64) {
          cachedSecretKey = Buffer.from(hex, 'hex');
          return cachedSecretKey;
        }
      }
    } catch {
      // Ignorér EACCES hvis en gammel .share_secret ejes af root med 0600
    }
  }

  const newKey = crypto.randomBytes(32);
  cachedSecretKey = newKey;
  try {
    const writableKeyFile = path.join(getWritableDataDir(), '.share_secret');
    fs.writeFileSync(writableKeyFile, newKey.toString('hex'), { mode: 0o600 });
  } catch {
    // Bevar nøglen i hukommelsen hvis disk-skrivning fejler
  }
  return newKey;
}

function encryptText(plain: string): string {
  const key = getSecretKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

function decryptText(payload: string): string {
  const [ivHex, tagHex, encHex] = payload.split(':');
  if (!ivHex || !tagHex || !encHex) {
    throw new Error('Ugyldigt krypteret format');
  }
  const key = getSecretKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const dec = Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]);
  return dec.toString('utf8');
}

export function encryptJson(obj: unknown): string {
  return encryptText(JSON.stringify(obj));
}

export function decryptJson<T>(token: string): T | null {
  try {
    const json = decryptText(token);
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

function readAllShares(): ShareRecord[] {
  if (memoryShares !== null) {
    return [...memoryShares];
  }
  for (const dir of [getWritableDataDir(), PREFERRED_DATA_DIR, FALLBACK_DATA_DIR]) {
    const sharesFile = path.join(dir, 'shares.json');
    try {
      if (fs.existsSync(sharesFile)) {
        const raw = fs.readFileSync(sharesFile, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          memoryShares = parsed;
          return [...memoryShares];
        }
      }
    } catch {
      // Ignorér læsefejl
    }
  }
  memoryShares = [];
  return [];
}

function writeAllShares(records: ShareRecord[]) {
  memoryShares = [...records];
  try {
    const sharesFile = path.join(getWritableDataDir(), 'shares.json');
    fs.writeFileSync(sharesFile, JSON.stringify(records, null, 2), 'utf8');
  } catch (err) {
    console.warn('Kunne ikke skrive shares.json til disk (bevares i hukommelse):', err);
  }
}

export function listSharesForUser(username: string): SharePublicInfo[] {
  const norm = username.toLowerCase().trim();
  return readAllShares()
    .filter((s) => s.username.toLowerCase().trim() === norm)
    .map((s) => ({
      token: s.token,
      label: s.label,
      calendarUrls: s.calendarUrls,
      calendarNames: s.calendarNames,
      hideDetails: Boolean(s.hideDetails),
      createdAt: s.createdAt
    }));
}

export function createShareLink(params: {
  creds: CalDavCredentials;
  label: string;
  calendarUrls: string[];
  calendarNames: string[];
  hideDetails?: boolean;
}): SharePublicInfo {
  const all = readAllShares();
  const token = crypto.randomBytes(18).toString('base64url');
  const record: ShareRecord = {
    token,
    label: params.label.trim() || 'Delt kalender',
    calendarUrls: params.calendarUrls,
    calendarNames: params.calendarNames,
    serverUrl: params.creds.serverUrl,
    username: params.creds.username,
    encryptedPassword: encryptText(params.creds.password),
    hideDetails: Boolean(params.hideDetails),
    createdAt: new Date().toISOString()
  };
  all.push(record);
  writeAllShares(all);

  return {
    token: record.token,
    label: record.label,
    calendarUrls: record.calendarUrls,
    calendarNames: record.calendarNames,
    hideDetails: record.hideDetails,
    createdAt: record.createdAt
  };
}

export function deleteShareLink(username: string, token: string): boolean {
  const norm = username.toLowerCase().trim();
  const all = readAllShares();
  const filtered = all.filter(
    (s) => !(s.token === token && s.username.toLowerCase().trim() === norm)
  );
  if (filtered.length === all.length) return false;
  writeAllShares(filtered);
  return true;
}

export function resolveShareToken(token: string): {
  record: ShareRecord;
  creds: CalDavCredentials;
} | null {
  const found = readAllShares().find((s) => s.token === token);
  if (!found) return null;
  try {
    const password = decryptText(found.encryptedPassword);
    return {
      record: found,
      creds: {
        serverUrl: found.serverUrl,
        username: found.username,
        password
      }
    };
  } catch {
    return null;
  }
}
