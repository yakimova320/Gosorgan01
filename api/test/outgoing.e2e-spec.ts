import type { INestApplication } from '@nestjs/common';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import request from 'supertest';
import { createApp } from '../src/app.factory.js';
import { berlinToday, toIsoDate } from '../src/common/berlin-date.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { PERSON } from './person.js';
import { createTestDatabase } from './test-db.js';

/* B16: свои письма по шаблонам — GET /templates, POST /outgoing, дальше путь черновика. */

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const de = (iso: string) => iso.split('-').reverse().join('.');

describe('Свои письма по шаблонам (e2e, B16)', () => {
  let app: INestApplication;
  let db: PrismaService;
  let cleanup: () => Promise<void>;
  let storageDir: string;
  let token: string;
  let other: string;
  let cabinetId: string;
  const today = toIsoDate(berlinToday());
  const http = () => request(app.getHttpServer());
  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });
  const recipient = {
    name: 'Jobcenter Berlin Mitte',
    address: 'Postfach 1234\n10115 Berlin',
  };
  const outgoing = (body: object, t = token) =>
    http().post('/outgoing').set(auth(t)).send(body);

  async function register(email: string) {
    const res = await http()
      .post('/auth/register')
      .send({ email, password: 'mein-langes-Passwort', consent: true, aiConsent: true, ...PERSON })
      .expect(201);
    return res.body.sessionToken as string;
  }

  beforeAll(async () => {
    const test = createTestDatabase();
    cleanup = test.cleanup;
    storageDir = mkdtempSync(join(tmpdir(), 'jasno-outgoing-'));
    app = await createApp({
      env: {
        LLM_MODE: 'demo',
        NODE_ENV: 'test',
        DATABASE_URL: test.url,
        STORAGE_DIR: storageDir,
      },
      logger: false,
    });
    await app.init();
    db = app.get(PrismaService);
    token = await register('outgoing@example.org');
    other = await register('fremd-outgoing@example.org');
    cabinetId = (
      await db.cabinet.findFirstOrThrow({ where: { email: 'outgoing@example.org' } })
    ).id;
  }, 60000);

  afterAll(async () => {
    await app.close();
    await cleanup();
    rmSync(storageDir, { recursive: true, force: true });
  });

  it('GET /templates: шесть шаблонов с полями, только после входа', async () => {
    await http().get('/templates').expect(401);
    const res = await http().get('/templates').set(auth()).expect(200);
    expect(res.body.map((t: { id: string }) => t.id)).toEqual([
      'KUENDIGUNG',
      'AENDERUNG',
      'NEUES_KONTO',
      'BESCHWERDE',
      'SACHSTANDSANFRAGE',
      'FRISTVERLAENGERUNG',
    ]);
    const konto = res.body.find((t: { id: string }) => t.id === 'NEUES_KONTO');
    expect(konto.fields.map((f: { key: string }) => f.key)).toEqual([
      'reference',
      'iban',
      'holder',
      'validFrom',
    ]);
  });

  it('новый счёт: дело OUTGOING, факты USER подтверждены, черновик TEMPLATE проверен; чужому 404', async () => {
    const res = await outgoing({
      templateId: 'NEUES_KONTO',
      recipient,
      fields: { reference: '123A456789', iban: 'de89370400440532013000', holder: '', validFrom: '' },
    }).expect(201);
    const { caseId, draft } = res.body;
    expect(draft.kind).toBe('TEMPLATE');
    expect(draft.outgoingTemplateId).toBe('NEUES_KONTO');
    expect(draft.letterId).toBeNull();
    expect(draft.verification.passed).toBe(true);
    expect(draft.germanText).toContain('Anna Muster\nMusterstr. 1, 10115 Berlin\n\nJobcenter Berlin Mitte\nPostfach 1234\n10115 Berlin');
    expect(draft.germanText).toContain('Ihr Zeichen: 123A456789');
    expect(draft.germanText).toContain('Kontoinhaber: Anna Muster\nIBAN: DE89 3704 0044 0532 0130 00');
    expect(draft.verification.checklist.map((c: { text: string }) => c.text)).toEqual([
      'Адресат: Jobcenter Berlin Mitte',
      'Адрес адресата: Postfach 1234, 10115 Berlin',
      'Номер дела или клиента: 123A456789',
      'Новый IBAN: DE89 3704 0044 0532 0130 00',
    ]);

    const claims = await db.claim.findMany({ where: { caseId } });
    expect(claims).toHaveLength(4);
    for (const c of claims) {
      expect(c.basis).toBe('USER');
      expect(c.status).toBe('CONFIRMED');
      expect(c.letterId).toBeNull();
    }
    const kase = await http().get(`/cases/${caseId}`).set(auth()).expect(200);
    expect(kase.body.origin).toBe('OUTGOING');
    expect(kase.body.title).toBe('Новый банковский счёт: Jobcenter Berlin Mitte');
    expect(kase.body.authority).toBe('Jobcenter Berlin Mitte');
    expect(kase.body.caseNumber).toBe('123A456789');
    expect(kase.body.drafts).toHaveLength(1);
    const list = await http().get('/cases?status=all').set(auth()).expect(200);
    expect(list.body.find((c: { id: string }) => c.id === caseId).origin).toBe('OUTGOING');

    await http().get(`/drafts/${draft.id}`).set(auth(other)).expect(404);
    await http().get(`/cases/${caseId}`).set(auth(other)).expect(404);
    await http().post(`/cases/${caseId}/draft`).set(auth(other)).send({ kind: 'TEMPLATE' }).expect(404);
  });

  it('ошибки полей: 400 с путями полей; даты относительно сегодня проверяет сервер; ничего не создано', async () => {
    const before = await db.case.count({ where: { cabinetId } });
    const bad = await outgoing({
      templateId: 'SACHSTANDSANFRAGE',
      recipient: { name: 'Джобцентр', address: recipient.address },
      fields: { subject: 'заявление', extra: 'x' },
    }).expect(400);
    expect(bad.body.code).toBe('VALIDATION_FAILED');
    expect(Object.keys(bad.body.details.fields).sort()).toEqual([
      'fields.extra',
      'fields.subject',
      'fields.submitted',
      'recipient.name',
    ]);

    const past = await outgoing({
      templateId: 'FRISTVERLAENGERUNG',
      recipient,
      fields: { deadline: addDays(today, -1), reason: 'NONE' },
    }).expect(400);
    expect(past.body.details.fields).toEqual({
      'fields.deadline': 'Срок уже прошёл: продлить можно только будущий срок',
    });
    const future = await outgoing({
      templateId: 'SACHSTANDSANFRAGE',
      recipient,
      fields: { subject: 'Antrag auf Wohngeld', submitted: addDays(today, 1) },
    }).expect(400);
    expect(Object.keys(future.body.details.fields)).toEqual(['fields.submitted']);
    await outgoing({ templateId: 'UNKNOWN', recipient, fields: {} }).expect(400);
    expect(await db.case.count({ where: { cabinetId } })).toBe(before);
  });

  it('продление срока: правка с чужой датой 422, профиль изменился → устарел → «Собрать заново»; PDF и «Я отправил(а)»', async () => {
    const deadline = addDays(today, 10);
    const newDate = addDays(today, 24);
    const res = await outgoing({
      templateId: 'FRISTVERLAENGERUNG',
      recipient,
      fields: { deadline, newDate, reason: 'DOCUMENTS_PENDING' },
    }).expect(201);
    const { caseId, draft } = res.body;
    expect(draft.germanText).toContain(`eine Frist bis zum ${de(deadline)} gesetzt.`);
    expect(draft.germanText).toContain(`die Frist bis zum ${de(newDate)} zu verlängern.`);

    // правка: дата не из полей формы не сохраняется
    const wrong = await http()
      .patch(`/drafts/${draft.id}`)
      .set(auth())
      .send({
        germanText: draft.germanText.replace(de(newDate), de(addDays(today, 60))),
        russianText: draft.russianText,
      })
      .expect(422);
    expect(wrong.body.code).toBe('DRAFT_VERIFICATION_FAILED');
    const edited = await http()
      .patch(`/drafts/${draft.id}`)
      .set(auth())
      .send({
        germanText: draft.germanText.replace('Bitte bestätigen Sie mir die neue Frist.', 'Bitte bestätigen Sie mir die neue Frist schriftlich.'),
        russianText: draft.russianText,
      })
      .expect(200);
    expect(edited.body.edited).toBe(true);

    await http()
      .patch('/cabinet')
      .set(auth())
      .send({ profile: { address: 'Neue Str. 5, 10117 Berlin' } })
      .expect(200);
    const stale = await http().get(`/drafts/${draft.id}`).set(auth()).expect(200);
    expect(stale.body.stale).toBe(true);
    const rebuilt = await http()
      .post(`/cases/${caseId}/draft`)
      .set(auth())
      .send({ kind: 'TEMPLATE' })
      .expect(201);
    expect(rebuilt.body.stale).toBe(false);
    expect(rebuilt.body.outgoingTemplateId).toBe('FRISTVERLAENGERUNG');
    expect(rebuilt.body.germanText).toContain('Neue Str. 5, 10117 Berlin');
    expect(rebuilt.body.germanText).toContain(`bis zum ${de(newDate)}`);

    const pdf = await http()
      .get(`/drafts/${rebuilt.body.id}/pdf`)
      .set(auth())
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect((pdf.body as Buffer).subarray(0, 5).toString('latin1')).toBe('%PDF-');

    await http()
      .post(`/cases/${caseId}/sent`)
      .set(auth())
      .send({ draftId: rebuilt.body.id, via: 'post', date: today })
      .expect(201);
    const after = await http().get(`/drafts/${rebuilt.body.id}`).set(auth()).expect(200);
    expect(after.body.status).toBe('SENT');
    await db.cabinet.update({ where: { id: cabinetId }, data: { profile: PERSON } });
  });

  it('все шесть шаблонов собираются из минимального набора полей', async () => {
    const minimal: Record<string, Record<string, string>> = {
      KUENDIGUNG: { subject: 'Mitgliedschaft im Sportverein' },
      AENDERUNG: { change: 'ADDRESS', date: today },
      NEUES_KONTO: { iban: 'DE89 3704 0044 0532 0130 00' },
      BESCHWERDE: { reason: 'LONG_PROCESSING' },
      SACHSTANDSANFRAGE: { subject: 'Antrag auf Wohngeld', submitted: today },
      FRISTVERLAENGERUNG: { deadline: today, reason: 'NONE' },
    };
    for (const [templateId, fields] of Object.entries(minimal)) {
      const res = await outgoing({ templateId, recipient, fields });
      expect(res.status, `${templateId}: ${JSON.stringify(res.body)}`).toBe(201);
      expect(res.body.draft.verification.passed).toBe(true);
    }
  });

  it('«Собрать заново» с kind TEMPLATE для дела из входящего письма: 404', async () => {
    const up = await http()
      .post('/letters')
      .set(auth())
      .attach(
        'files',
        readFileSync(resolve(import.meta.dirname, '..', '..', 'fixtures', 'letters', '01_jobcenter_request.pdf')),
        'a.pdf',
      )
      .expect(201);
    const assigned = await http()
      .post(`/letters/${up.body.letter.id}/assign`)
      .set(auth())
      .send({ newCase: {} })
      .expect(200);
    await http()
      .post(`/cases/${assigned.body.caseId}/draft`)
      .set(auth())
      .send({ kind: 'TEMPLATE' })
      .expect(404);
  });

  it('удаление дела удаляет его факты и черновики', async () => {
    const res = await outgoing({
      templateId: 'BESCHWERDE',
      recipient,
      fields: { reason: 'NO_REPLY' },
    }).expect(201);
    await http().delete(`/cases/${res.body.caseId}`).set(auth()).expect(204);
    expect(await db.claim.count({ where: { caseId: res.body.caseId } })).toBe(0);
    expect(await db.draft.count({ where: { caseId: res.body.caseId } })).toBe(0);
  });
});
