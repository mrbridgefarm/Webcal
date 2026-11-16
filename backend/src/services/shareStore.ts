import fs from 'node:fs';
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

const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
const SHARES_FILE = path.join(DATA_DIR, 'shares.json');
const KEY_FILE = path.join(DATA_DIR, '.share_secret');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function getSecretKey(): Buffer {
  ensureDataDir();
  if (process.env.SHARE_SECRET) {
    return crypto.createHash('sha256').update(process.env.SHARE_SECRET).digest();
  }
  if (fs.existsSync(KEY_FILE)) {
    const hex = fs.readFileSync(KEY_FILE, 'utf8').trim();
    if (hex.length === 64) {
      return Buffer.from(hex, 'hex');
    }
  }
  const newKey = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, newKey.toString('hex'), { mode: 0o600 });
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

function readAllShares(): ShareRecord[] {
  ensureDataDir();
  if (!fs.existsSync(SHARES_FILE)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(SHARES_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAllShares(records: ShareRecord[]) {
  ensureDataDir();
  fs.writeFileSync(SHARES_FILE, JSON.stringify(records, null, 2), 'utf8');
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
