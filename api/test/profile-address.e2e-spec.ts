import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/app.factory.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { PERSON } from './person.js';
import { createTestDatabase } from './test-db.js';

describe('Профиль: адрес по частям и имя в столбцах (e2e, поправки 6 и 9)', () => {
  let app: INestApplication;
  let db: PrismaService;
  let cleanup: () => Promise<void>;
  let token: string;
  const http = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const test = createTestDatabase();
    cleanup = test.cleanup;
    app = await createApp({
      env: { LLM_MODE: 'demo', NODE_ENV: 'test', DATABASE_URL: test.url },
      logger: false,
    });
    await app.init();
    db = app.get(PrismaService);
    const res = await http()
      .post('/auth/register')
      .send({
        email: 'adresse@example.org',
        password: 'mein-langes-Passwort',
        consent: true,
        ...PERSON,
      })
      .expect(201);
    token = res.body.sessionToken;
  }, 60000);

  afterAll(async () => {
    await app.close();
    await cleanup();
  });

  const row = () =>
    db.cabinet.findUniqueOrThrow({
      where: { email: 'adresse@example.org' },
      select: { firstName: true, lastName: true, profile: true },
    });

  it('регистрация: имя и фамилия видны отдельными столбцами', async () => {
    expect(await row()).toMatchObject({ firstName: 'Anna', lastName: 'Muster' });
  });

  it('части адреса: строка address собирается из них', async () => {
    const res = await http()
      .patch('/cabinet')
      .set(auth())
      .send({ profile: { street: 'Neue Str. 2', postalCode: '50667', city: 'Köln' } })
      .expect(200);
    expect(res.body.profile).toMatchObject({
      street: 'Neue Str. 2',
      postalCode: '50667',
      city: 'Köln',
      address: 'Neue Str. 2, 50667 Köln',
    });
  });

  it('не все части или неверный индекс: 400 с полем', async () => {
    await db.cabinet.update({
      where: { email: 'adresse@example.org' },
      data: { profile: { ...PERSON } },
    });
    const partial = await http()
      .patch('/cabinet')
      .set(auth())
      .send({ profile: { street: 'Neue Str. 2' } })
      .expect(400);
    expect(Object.keys(partial.body.details.fields)).toEqual(
      expect.arrayContaining(['profile.postalCode', 'profile.city']),
    );
    const zip = await http()
      .patch('/cabinet')
      .set(auth())
      .send({ profile: { street: 'Neue Str. 2', postalCode: '506', city: 'Köln' } })
      .expect(400);
    expect(zip.body.details.fields['profile.postalCode']).toBe('Индекс: 5 цифр');
  });

  it('только строка address: старые части убираются; новое имя попадает в столбец', async () => {
    await http()
      .patch('/cabinet')
      .set(auth())
      .send({ profile: { street: 'A-Str. 1', postalCode: '10115', city: 'Berlin' } })
      .expect(200);
    const res = await http()
      .patch('/cabinet')
      .set(auth())
      .send({ profile: { address: 'Andere Str. 3, 80331 München', firstName: 'Jana' } })
      .expect(200);
    expect(res.body.profile.street).toBeUndefined();
    expect(res.body.profile.address).toBe('Andere Str. 3, 80331 München');
    expect(await row()).toMatchObject({ firstName: 'Jana', lastName: 'Muster' });
  });
});
