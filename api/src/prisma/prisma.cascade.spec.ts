import { createTestDatabase } from '../../test/test-db.js';
import { PrismaService } from './prisma.service.js';

describe('Схема базы: каскадное удаление', () => {
  let db: PrismaService;
  let cleanup: () => Promise<void>;

  beforeAll(() => {
    const test = createTestDatabase();
    cleanup = test.cleanup;
    db = new PrismaService({ DATABASE_URL: test.url });
  }, 60000);

  afterAll(async () => {
    await db.$disconnect();
    await cleanup();
  });

  /** Кабинет со всем, что в нём бывает: дело, письма, факты, срок, черновик, история. */
  async function createFullCabinet(email: string) {
    const cabinet = await db.cabinet.create({
      data: { email, passwordHash: 'hash', consentAt: new Date() },
    });
    await db.session.create({
      data: {
        cabinetId: cabinet.id,
        tokenHash: `s-${email}`,
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    await db.passwordResetToken.create({
      data: {
        cabinetId: cabinet.id,
        tokenHash: `r-${email}`,
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    const kase = await db.case.create({
      data: { cabinetId: cabinet.id, title: 'Jobcenter' },
    });
    const letter = await db.letter.create({
      data: {
        cabinetId: cabinet.id,
        caseId: kase.id,
        sourceType: 'PDF_TEXT',
        rawText: 'Bitte reichen Sie bis zum 01.12.2026 ein.',
        pages: [{ n: 1, readable: true, chars: 41 }],
        files: [
          { n: 1, fileKey: 'random-key', mime: 'application/pdf', bytes: 1000 },
        ],
      },
    });
    await db.letter.create({
      data: {
        cabinetId: cabinet.id,
        sourceType: 'IMAGE',
        rawText: 'Inbox',
        pages: [],
        files: [],
      },
    });
    const old = await db.claim.create({
      data: {
        letterId: letter.id,
        caseId: kase.id,
        kind: 'DEADLINE',
        value: '2026-12-01',
        text: 'Срок 1 декабря',
        quote: 'bis zum 01.12.2026',
        basis: 'DOCUMENT',
        status: 'SUPERSEDED',
      },
    });
    const fixed = await db.claim.create({
      data: {
        letterId: letter.id,
        caseId: kase.id,
        kind: 'DEADLINE',
        value: '2026-12-02',
        text: 'Срок 2 декабря',
        basis: 'USER',
        supersedesId: old.id,
        updatedBy: 'USER',
      },
    });
    await db.deadline.create({
      data: {
        letterId: letter.id,
        caseId: kase.id,
        claimId: fixed.id,
        date: new Date('2026-12-02T00:00:00Z'),
        kind: 'DOCUMENTS',
      },
    });
    await db.event.create({
      data: { caseId: kase.id, type: 'LETTER_RECEIVED', details: {} },
    });
    await db.message.create({
      data: { caseId: kase.id, role: 'USER', kind: 'QUESTION', text: '?' },
    });
    await db.draft.create({
      data: {
        caseId: kase.id,
        kind: 'CLARIFICATION',
        germanText: 'Sehr geehrte Damen und Herren',
        russianText: 'Уважаемые дамы и господа',
        claimIds: [fixed.id],
        claimSnapshot: [{ id: fixed.id, value: fixed.value }],
        verification: { ok: true },
      },
    });
    await db.llmCall.create({
      data: {
        cabinetId: cabinet.id,
        promptName: 'extract',
        promptVersion: 1,
        provider: 'demo',
        model: 'demo',
        input: '***',
        ok: true,
        attempts: 1,
        durationMs: 1,
      },
    });
    return { cabinet, kase, letter, fixed };
  }

  async function countFor(cabinetId: string) {
    const caseIds = (
      await db.case.findMany({ where: { cabinetId }, select: { id: true } })
    ).map((c) => c.id);
    return {
      sessions: await db.session.count({ where: { cabinetId } }),
      resetTokens: await db.passwordResetToken.count({ where: { cabinetId } }),
      cases: caseIds.length,
      letters: await db.letter.count({ where: { cabinetId } }),
      claims: await db.claim.count({ where: { letter: { cabinetId } } }),
      deadlines: await db.deadline.count({ where: { letter: { cabinetId } } }),
      events: await db.event.count({ where: { case: { cabinetId } } }),
      messages: await db.message.count({ where: { case: { cabinetId } } }),
      drafts: await db.draft.count({ where: { case: { cabinetId } } }),
    };
  }

  it('удаление кабинета удаляет его сессии, дела, письма, факты, сроки и черновики', async () => {
    const mine = await createFullCabinet('a@example.org');
    const other = await createFullCabinet('b@example.org');

    const before = await countFor(mine.cabinet.id);
    expect(before).toEqual({
      sessions: 1,
      resetTokens: 1,
      cases: 1,
      letters: 2,
      claims: 2,
      deadlines: 1,
      events: 1,
      messages: 1,
      drafts: 1,
    });

    await db.cabinet.delete({ where: { id: mine.cabinet.id } });

    expect(await countFor(mine.cabinet.id)).toEqual({
      sessions: 0,
      resetTokens: 0,
      cases: 0,
      letters: 0,
      claims: 0,
      deadlines: 0,
      events: 0,
      messages: 0,
      drafts: 0,
    });
    // Чужой кабинет не задет.
    expect(await countFor(other.cabinet.id)).toEqual(before);
    // LlmCall без внешних ключей: его удаляет код удаления аккаунта (A01), не база.
    expect(
      await db.llmCall.count({ where: { cabinetId: mine.cabinet.id } }),
    ).toBe(1);
  });

  it('удаление факта удаляет его срок', async () => {
    const { cabinet, fixed } = await createFullCabinet('c@example.org');
    await db.claim.delete({ where: { id: fixed.id } });
    expect(
      await db.deadline.count({ where: { letter: { cabinetId: cabinet.id } } }),
    ).toBe(0);
  });

  it('удаление дела удаляет его письма, но не кабинет', async () => {
    const { cabinet, kase } = await createFullCabinet('d@example.org');
    await db.case.delete({ where: { id: kase.id } });
    expect(await db.cabinet.count({ where: { id: cabinet.id } })).toBe(1);
    expect(await db.letter.count({ where: { caseId: kase.id } })).toBe(0);
    // Письмо во входящих (без дела) остаётся.
    expect(await db.letter.count({ where: { cabinetId: cabinet.id } })).toBe(1);
  });

  it('одинаковый e-mail нельзя зарегистрировать дважды', async () => {
    await db.cabinet.create({
      data: {
        email: 'e@example.org',
        passwordHash: 'h',
        consentAt: new Date(),
      },
    });
    await expect(
      db.cabinet.create({
        data: {
          email: 'e@example.org',
          passwordHash: 'h',
          consentAt: new Date(),
        },
      }),
    ).rejects.toThrow();
  });
});
