import type { LlmClient, LlmRequest, LlmResponse } from '../clients/llm.ts';

const FAKE_QUOTE = '"영상에 나오지 않은 지어낸 대사"';

/** 실제/모의 클라이언트를 감싸 Marketing 출력에 허위 인용을 주입한다 (장애 주입 #3). */
export class HallucinationInjectingLlm implements LlmClient {
  private readonly inner: LlmClient;
  constructor(inner: LlmClient) {
    this.inner = inner;
  }
  get mode() {
    return this.inner.mode;
  }
  get provider() {
    return this.inner.provider;
  }
  get billing() {
    return this.inner.billing;
  }
  async generate<T>(req: LlmRequest<T>): Promise<LlmResponse<T>> {
    const res = await this.inner.generate(req);
    if (req.role !== 'MARKETING') return res;
    const data = res.data as unknown as { candidates: { content: string }[] };
    const candidates = data.candidates.map((c) => ({ ...c, content: `${FAKE_QUOTE} ${c.content}`.slice(0, 118) }));
    return { ...res, data: { ...data, candidates } as unknown as T };
  }
}
