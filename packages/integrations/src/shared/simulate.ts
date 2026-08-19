/**
 * Shared failure-injection helper for the Mock* providers. CLAUDE.md §3 requires
 * every external provider mock to be able to simulate: success, decline,
 * rate-limit, server error, and timeout.
 */

export type SimulatedOutcome = 'success' | 'decline' | 'rate_limit' | 'server_error' | 'timeout';

export interface SimulationConfig {
  /** Force a specific outcome (overrides probabilities). */
  readonly force?: SimulatedOutcome;
  /** Probability [0,1] of a transient 5xx. */
  readonly serverErrorRate?: number;
  /** Probability [0,1] of a 429. */
  readonly rateLimitRate?: number;
  /** Probability [0,1] of a hard decline. */
  readonly declineRate?: number;
  /** Artificial latency in ms applied before returning. */
  readonly latencyMs?: number;
  /** Injectable RNG for deterministic tests. */
  readonly rng?: () => number;
}

export class SimulatedProviderError extends Error {
  constructor(
    readonly outcome: Exclude<SimulatedOutcome, 'success'>,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = 'SimulatedProviderError';
  }
}

export async function simulate(config: SimulationConfig = {}): Promise<'success' | 'decline'> {
  const rng = config.rng ?? Math.random;

  if (config.latencyMs && config.latencyMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, config.latencyMs));
  }

  const outcome: SimulatedOutcome = config.force ?? roll(rng, config);

  switch (outcome) {
    case 'success':
      return 'success';
    case 'decline':
      return 'decline';
    case 'rate_limit':
      throw new SimulatedProviderError(
        'rate_limit',
        true,
        'Provider returned 429 Too Many Requests',
      );
    case 'server_error':
      throw new SimulatedProviderError(
        'server_error',
        true,
        'Provider returned 500 Internal Server Error',
      );
    case 'timeout':
      throw new SimulatedProviderError('timeout', true, 'Provider request timed out');
    default: {
      const _exhaustive: never = outcome;
      return _exhaustive;
    }
  }
}

function roll(rng: () => number, config: SimulationConfig): SimulatedOutcome {
  const r = rng();
  const serverError = config.serverErrorRate ?? 0;
  const rateLimit = config.rateLimitRate ?? 0;
  const decline = config.declineRate ?? 0;

  if (r < serverError) return 'server_error';
  if (r < serverError + rateLimit) return 'rate_limit';
  if (r < serverError + rateLimit + decline) return 'decline';
  return 'success';
}
