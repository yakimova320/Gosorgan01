import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { AppModule } from '../app.module.js';
import { CasesService } from '../cases/cases.service.js';
import { CaseWorkflowService } from '../workflow/case-workflow.service.js';
import { ConfigService } from '@nestjs/config';
import { PromptRegistry } from '../llm/prompt-registry.js';
const app = await NestFactory.createApplicationContext(AppModule, {
  logger: ['error'],
});
try {
  const cases = app.get(CasesService),
    workflow = app.get(CaseWorkflowService),
    config = app.get(ConfigService);
  const fixtures = (await readdir('fixtures/letters'))
    .filter((f) => f.endsWith('.json'))
    .sort();
  const rows: Record<string, unknown>[] = [];
  const callStats: { durationMs: number; tokens: number | null }[] = [];
  for (const name of fixtures) {
    const f = JSON.parse(
      await readFile(join('fixtures/letters', name), 'utf8'),
    ) as {
      id: string;
      file: string;
      source: string;
      readable: boolean;
      expected: {
        authority: string;
        caseNumber: string | null;
        deadlines: string[];
      };
    };
    const c = await cases.create('EVAL ' + f.id);
    try {
      const buffer = await readFile(join('fixtures/letters', f.file));
      const extension = extname(f.file),
        mimetype =
          extension === '.pdf'
            ? 'application/pdf'
            : extension === '.jpg'
              ? 'image/jpeg'
              : 'image/png';
      const { extracted } = await workflow.ingestLetter(c.id, {
        buffer,
        mimetype,
        originalname: f.file,
      });
      const state = await cases.state(c.id);
      const fields = [
        extracted.authority,
        extracted.caseNumber,
        extracted.letterDate,
        ...extracted.requirements,
      ];
      const quotes =
        fields
          .filter((v) => v.value !== null)
          .every(
            (v) =>
              v.quote &&
              state.letters[0].rawText
                .replace(/\s+/g, ' ')
                .includes(v.quote.replace(/\s+/g, ' ')),
          ) &&
        extracted.deadlines.every((d) =>
          state.letters[0].rawText
            .replace(/\s+/g, ' ')
            .includes(d.quote.replace(/\s+/g, ' ')),
        );
      for (const claim of state.claims)
        await workflow.confirmClaim(c.id, claim.id);
      let draftPassed = false;
      try {
        draftPassed = (await workflow.prepareDraft(c.id)).report.passed;
      } catch {
        /* measured failure, never counted as a successful draft */
      }
      rows.push({
        id: f.id,
        source: f.source,
        readable: f.readable,
        readabilityCorrect: f.readable,
        authority: extracted.authority.value === f.expected.authority,
        caseNumber: extracted.caseNumber.value === f.expected.caseNumber,
        deadlines:
          JSON.stringify(extracted.deadlines.map((d) => d.date).sort()) ===
          JSON.stringify([...f.expected.deadlines].sort()),
        quotes,
        draftPassed,
      });
    } catch (error) {
      const status = (error as { getStatus?: () => number }).getStatus?.();
      rows.push({
        id: f.id,
        source: f.source,
        readable: f.readable,
        readabilityCorrect: !f.readable && status === 422,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    callStats.push(...(await cases.trace(c.id)));
  }
  const metrics = Object.fromEntries(
    ['TEXT_LAYER', 'OCR'].map((source) => {
      const all = rows.filter((r) => r.source === source),
        readable = all.filter((r) => r.readable === true);
      const rate = (key: string, samples = readable) =>
        samples.length
          ? samples.filter((r) => r[key] === true).length / samples.length
          : null;
      return [
        source,
        {
          count: all.length,
          authority: rate('authority'),
          caseNumber: rate('caseNumber'),
          deadlines: rate('deadlines'),
          quoteValidity: rate('quotes'),
          draftPassRate: rate('draftPassed'),
          readabilityAccuracy: rate('readabilityCorrect', all),
        },
      ];
    }),
  );
  const tokenCalls = callStats.filter((c) => c.tokens !== null);
  const report = {
    at: new Date().toISOString(),
    providerMode: config.get('LLM_MODE'),
    model:
      config.get('LLM_MODE') === 'demo'
        ? 'deterministic-demo-v1'
        : config.get('LLM_MODEL'),
    note:
      config.get('LLM_MODE') === 'demo'
        ? 'Offline demo regression, NOT an LLM quality benchmark. OCR is real.'
        : 'Real provider extraction and OCR benchmark.',
    promptVersions: Object.fromEntries(
      ['extract', 'dialogue', 'draft'].map((n) => [
        n,
        app.get(PromptRegistry).get(n).version,
      ]),
    ),
    metrics,
    rows,
    meanCallLatencyMs: callStats.length
      ? callStats.reduce((s, c) => s + c.durationMs, 0) / callStats.length
      : null,
    meanTokens: tokenCalls.length
      ? tokenCalls.reduce((s, c) => s + (c.tokens ?? 0), 0) / tokenCalls.length
      : null,
    calls: callStats.length,
  };
  console.table(rows);
  console.log(JSON.stringify(metrics, null, 2));
  await mkdir('reports', { recursive: true });
  await writeFile(
    'reports/eval-latest.json',
    JSON.stringify(report, null, 2) + '\n',
  );
  if (
    rows.some(
      (r) =>
        r.readabilityCorrect !== true ||
        (r.readable === true && r.quotes !== true),
    )
  )
    process.exitCode = 1;
} finally {
  await app.close();
}
