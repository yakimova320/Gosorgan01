import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const collection = JSON.parse(
  readFileSync('postman/Razberemsya.postman_collection.json', 'utf8'),
);
function runUpload(status: number, body: unknown) {
  const failures: string[] = [];
  const setNextRequest = vi.fn();
  const script = collection.item[1].event
    .find((event: { listen: string }) => event.listen === 'test')
    .script.exec.join('\n');
  const pm = {
    response: {
      code: status,
      json: () => body,
      text: () => JSON.stringify(body),
      to: {
        have: { status: (expected: number) => expect(status).toBe(expected) },
      },
    },
    expect,
    execution: { setNextRequest },
    test: (name: string, check: () => void) => {
      try {
        check();
      } catch {
        failures.push(name);
      }
    },
  };
  runInNewContext(script, { pm, console: { error: vi.fn() } });
  return { failures, setNextRequest };
}
it('reports the API error and stops the collection instead of reading missing extraction fields', () => {
  for (const status of [422, 502]) {
    const { failures, setNextRequest } = runUpload(status, {
      code: 'LLM_FAILED',
      message: 'Unavailable',
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('LLM_FAILED');
    expect(setNextRequest).toHaveBeenCalledWith(null);
  }
});
it('continues when upload and extraction succeed', () => {
  const { failures, setNextRequest } = runUpload(201, {
    extracted: { caseNumber: { value: 'JC-2026-1001' } },
  });
  expect(failures).toEqual([]);
  expect(setNextRequest).not.toHaveBeenCalled();
});
