export interface ProviderRequest {
  prompt: string;
  promptName: string;
  variables: Record<string, unknown>;
}
export interface ProviderResult {
  content: string;
  tokens: number | null;
}
export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  complete(request: ProviderRequest): Promise<ProviderResult>;
}
export const LLM_PROVIDER = Symbol('LLM_PROVIDER');
export class FakeLlmProvider implements LlmProvider {
  readonly name = 'fake';
  readonly model = 'fake';
  readonly requests: ProviderRequest[] = [];
  constructor(private readonly responses: (string | Error)[] = []) {}
  complete(request: ProviderRequest): Promise<ProviderResult> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (response instanceof Error) return Promise.reject(response);
    if (response === undefined)
      return Promise.reject(new Error('No fake response configured'));
    return Promise.resolve({ content: response, tokens: 0 });
  }
}
