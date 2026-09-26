const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function durationMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const match = value.match(/^(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?$/i);
  if (match && (match[1] || match[2])) return (Number(match[1] || 0) * 60 + Number(match[2] || 0)) * 1000;
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return undefined;
}

export function providerRetryDelayMs(retryAfter: string | null, resetAfter: string | null, providerMessage: string, attempt: number) {
  const bodyDelay = providerMessage.match(/(?:try again|retry)(?: in)?\s+(\d+(?:\.\d+)?)\s*(ms|seconds?|secs?|s|minutes?|mins?|m)\b/i);
  let parsedBodyDelay: number | undefined;
  if (bodyDelay) {
    const amount = Number(bodyDelay[1]);
    parsedBodyDelay = /^(?:m|minute|minutes|min|mins)$/i.test(bodyDelay[2]) ? amount * 60_000 : /^(?:ms)$/i.test(bodyDelay[2]) ? amount : amount * 1000;
  }
  const providerWaits = [durationMs(retryAfter), durationMs(resetAfter), parsedBodyDelay].filter((value): value is number => value !== undefined);
  const wait = providerWaits.length ? Math.max(...providerWaits) : undefined;
  return Math.max(0, Math.ceil((wait ?? Math.min(1000 * 2 ** attempt, 30_000)) + (wait ? 250 : 0)));
}

export class GroqRateGate {
  private queue: Promise<void> = Promise.resolve();
  private remainingTokens?: number;
  private tokenResetAt = 0;

  schedule<T>(estimatedTokens: number, request: (updateHeaders: (headers: Headers) => void) => Promise<T>, onWait?: (milliseconds: number) => void): Promise<T> {
    const run = this.queue.then(async () => {
      if (this.remainingTokens !== undefined && this.remainingTokens < estimatedTokens && this.tokenResetAt > Date.now()) {
        const waitMs = this.tokenResetAt - Date.now() + 350;
        onWait?.(waitMs);
        await sleep(waitMs);
        this.remainingTokens = undefined;
      }
      return request((headers) => this.update(headers));
    });
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  private update(headers: Headers) {
    const rawRemaining = headers.get('x-ratelimit-remaining-tokens');
    const remaining = rawRemaining === null ? Number.NaN : Number(rawRemaining);
    const reset = durationMs(headers.get('x-ratelimit-reset-tokens'));
    if (Number.isFinite(remaining)) this.remainingTokens = remaining;
    if (reset !== undefined) this.tokenResetAt = Date.now() + reset;
  }
}

export const groqRateGate = new GroqRateGate();
