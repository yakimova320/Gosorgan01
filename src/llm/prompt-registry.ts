import { Injectable } from '@nestjs/common';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
@Injectable()
export class PromptRegistry {
  get(name: string, version?: number) {
    if (!/^[a-z-]+$/.test(name)) throw new Error('Invalid prompt name');
    const directory = join(import.meta.dirname, 'prompts');
    const versions = readdirSync(directory).flatMap((f) => {
      const m = f.match(new RegExp(`^${name}\\.v(\\d+)\\.md$`));
      return m ? [Number(m[1])] : [];
    });
    const selected = version ?? Math.max(...versions);
    if (!versions.includes(selected))
      throw new Error(`Prompt ${name} v${selected} not found`);
    return {
      name,
      version: selected,
      template: readFileSync(
        join(directory, `${name}.v${selected}.md`),
        'utf8',
      ),
    };
  }
}
