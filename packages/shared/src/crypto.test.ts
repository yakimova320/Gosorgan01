import { describe, expect, it } from 'vitest';
import {
  bytesKeyId,
  collectKeyIds,
  createDocumentKey,
  CryptoIntegrityError,
  decryptBytes,
  decryptDeep,
  decryptEnvelope,
  encryptBytes,
  encryptJson,
  encryptText,
  formatKeysHeader,
  formatNewKeyHeader,
  generateRecoverySecret,
  isEnvelope,
  isWrappedKey,
  isWrappedMaster,
  newRawKey,
  parseKeysHeader,
  parseNewKeyHeader,
  parseRecoverySecret,
  unwrapDocumentKey,
  unwrapMasterKey,
  wrapMasterKey,
} from './crypto.js';

const CAB = 'cab1';

describe('recovery secret', () => {
  it('round-trips and tolerates spaces, case and lookalikes', async () => {
    const s = await generateRecoverySecret();
    expect(s).toMatch(/^([0-9A-Z]{4}-){13}[0-9A-Z]{3}$/);
    const a = await parseRecoverySecret(s);
    const b = await parseRecoverySecret(` ${s.toLowerCase().replace(/-/g, ' ')} `);
    expect(a).not.toBeNull();
    expect(b).toEqual(a);
  });

  it('rejects a typo through the checksum', async () => {
    const s = await generateRecoverySecret();
    const typo = (s[0] === 'A' ? 'B' : 'A') + s.slice(1);
    expect(await parseRecoverySecret(typo)).toBeNull();
    expect(await parseRecoverySecret('ABCD')).toBeNull();
  });
});

describe('master and document keys', () => {
  it('unwraps the master key only with the right secret and cabinet', async () => {
    const secret = (await parseRecoverySecret(await generateRecoverySecret()))!;
    const other = (await parseRecoverySecret(await generateRecoverySecret()))!;
    const mk = newRawKey();
    const wrapped = await wrapMasterKey(mk, secret, CAB);
    expect(isWrappedMaster(wrapped)).toBe(true);
    expect(await unwrapMasterKey(wrapped, secret, CAB)).toEqual(mk);
    await expect(unwrapMasterKey(wrapped, other, CAB)).rejects.toBeInstanceOf(CryptoIntegrityError);
    await expect(unwrapMasterKey(wrapped, secret, 'cab2')).rejects.toBeInstanceOf(CryptoIntegrityError);
  });

  it('binds a document key to cabinet and keyId', async () => {
    const mk = newRawKey();
    const k = await createDocumentKey(mk, CAB);
    expect(isWrappedKey(k.wrapped)).toBe(true);
    expect(await unwrapDocumentKey(mk, k.wrapped, CAB, k.keyId)).toEqual(k.raw);
    const other = await createDocumentKey(mk, CAB);
    await expect(unwrapDocumentKey(mk, k.wrapped, CAB, other.keyId)).rejects.toBeInstanceOf(
      CryptoIntegrityError,
    );
  });
});

describe('envelopes', () => {
  it('encrypts text and JSON with a fresh IV each time', async () => {
    const k = await createDocumentKey(newRawKey(), CAB);
    const scope = { cabinetId: CAB, keyId: k.keyId };
    const a = await encryptText(k.raw, scope, 'Jobcenter Berlin');
    const b = await encryptText(k.raw, scope, 'Jobcenter Berlin');
    expect(a).not.toBe(b);
    expect(isEnvelope(a)).toBe(true);
    expect(a).not.toContain('Jobcenter');
    expect(await decryptEnvelope(k.raw, CAB, a)).toBe('Jobcenter Berlin');
    const j = await encryptJson(k.raw, scope, { x: [1, 'ü'] });
    expect(await decryptEnvelope(k.raw, CAB, j)).toEqual({ x: [1, 'ü'] });
  });

  it('detects tampering, a foreign cabinet and a wrong key', async () => {
    const k = await createDocumentKey(newRawKey(), CAB);
    const env = await encryptText(k.raw, { cabinetId: CAB, keyId: k.keyId }, 'Frist 01.12.2026');
    const parts = env.split('.');
    const ct = parts[4]!;
    parts[4] = (ct[0] === 'A' ? 'B' : 'A') + ct.slice(1);
    await expect(decryptEnvelope(k.raw, CAB, parts.join('.'))).rejects.toBeInstanceOf(
      CryptoIntegrityError,
    );
    await expect(decryptEnvelope(k.raw, 'other', env)).rejects.toBeInstanceOf(CryptoIntegrityError);
    const wrong = await createDocumentKey(newRawKey(), CAB);
    await expect(decryptEnvelope(wrong.raw, CAB, env)).rejects.toBeInstanceOf(CryptoIntegrityError);
  });

  it('decrypts nested objects and collects key ids', async () => {
    const k = await createDocumentKey(newRawKey(), CAB);
    const scope = { cabinetId: CAB, keyId: k.keyId };
    const obj = {
      letter: { id: 'l1', text: await encryptText(k.raw, scope, 'Hallo'), n: 3 },
      claims: [{ value: await encryptText(k.raw, scope, '12,50 €'), kind: 'AMOUNT' }],
      explanation: await encryptJson(k.raw, scope, { summary: 'S' }),
      plain: 'jx1 nicht verschlüsselt',
    };
    expect([...collectKeyIds(obj)]).toEqual([k.keyId]);
    const out = await decryptDeep(obj, CAB, (id) => (id === k.keyId ? k.raw : null));
    expect(out).toEqual({
      letter: { id: 'l1', text: 'Hallo', n: 3 },
      claims: [{ value: '12,50 €', kind: 'AMOUNT' }],
      explanation: { summary: 'S' },
      plain: 'jx1 nicht verschlüsselt',
    });
    expect(await decryptDeep(obj, CAB, () => null)).toEqual(obj);
  });

  it('rejects a ciphertext moved in from another document', async () => {
    const mk = newRawKey();
    const a = await createDocumentKey(mk, CAB);
    const b = await createDocumentKey(mk, CAB);
    const fromB = await encryptText(b.raw, { cabinetId: CAB, keyId: b.keyId }, 'Brief B');
    const keys = (id: string) => (id === a.keyId ? a.raw : id === b.keyId ? b.raw : null);
    await expect(decryptDeep({ keyId: a.keyId, text: fromB }, CAB, keys)).rejects.toBeInstanceOf(
      CryptoIntegrityError,
    );
    expect(await decryptDeep({ keyId: b.keyId, text: fromB }, CAB, keys)).toEqual({
      keyId: b.keyId,
      text: 'Brief B',
    });
  });
});

describe('files', () => {
  it('encrypts bytes and detects tampering', async () => {
    const k = await createDocumentKey(newRawKey(), CAB);
    const data = new TextEncoder().encode('%PDF-1.4 Brief');
    const sealed = await encryptBytes(k.raw, { cabinetId: CAB, keyId: k.keyId }, data);
    expect(bytesKeyId(sealed)).toBe(k.keyId);
    expect(await decryptBytes(k.raw, CAB, sealed)).toEqual(data);
    sealed[sealed.length - 1]! ^= 1;
    await expect(decryptBytes(k.raw, CAB, sealed)).rejects.toBeInstanceOf(CryptoIntegrityError);
  });
});

describe('headers', () => {
  it('round-trips keys and new key headers', async () => {
    const mk = newRawKey();
    const a = await createDocumentKey(mk, CAB);
    const b = await createDocumentKey(mk, CAB);
    const parsed = parseKeysHeader(formatKeysHeader([a, b]))!;
    expect(parsed.get(a.keyId)).toEqual(a.raw);
    expect(parsed.get(b.keyId)).toEqual(b.raw);
    expect(parseKeysHeader('nope')).toBeNull();
    expect(parseNewKeyHeader(formatNewKeyHeader(a))).toEqual(a);
    expect(parseNewKeyHeader(`${a.keyId}:x:y`)).toBeNull();
  });
});
