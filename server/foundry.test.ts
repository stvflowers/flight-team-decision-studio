import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { createApi, createRunner, readConfig, readInput } from './foundry';
import { buildRequest, defaultInputs } from '../src/decision';
import { readFoundryResponse, type ModelRequest } from '../src/foundry';

const env = {
  FOUNDRY_ENDPOINT: 'https://example.services.ai.azure.com/providers/microsoft/v1/systemone',
  FOUNDRY_DEPLOYMENT: 'Decision-1',
};
const body = (scenario = 'triage', patch = {}, threshold = 0.8) => ({
  scenario, inputs: { ...defaultInputs, ...patch }, threshold,
});
const payload = (probabilities = { disruption: 0.97, leisure: 0.01, refunds: 0.01, support: 0.01 }, choice = 'disruption') => ({
  model: 'microsoft-decision-1',
  answers: { next_step: { type: 'choice', choice, probabilities, confidence: 0.95 } },
  usage: { input_tokens: 80, output_tokens: 1 },
});
const request: ModelRequest = { model: 'Decision-1', ...buildRequest('triage', defaultInputs) };

describe('server configuration and input boundaries', () => {
  it('requires configuration rather than defaulting silently', () => {
    expect(() => readConfig({})).toThrow('Configure FOUNDRY_ENDPOINT');
    expect(readConfig(env)).toEqual({ endpoint: env.FOUNDRY_ENDPOINT, deployment: 'Decision-1', auth: 'Azure CLI / Entra ID' });
  });
  it.each([
    'http://example.services.ai.azure.com/providers/microsoft/v1/systemone',
    'https://example.services.ai.azure.com.evil.test/providers/microsoft/v1/systemone',
    'https://example.services.ai.azure.com/other',
    'https://example.services.ai.azure.com/providers/microsoft/v1/systemone?secret=x',
    'https://user:pass@example.services.ai.azure.com/providers/microsoft/v1/systemone',
    'not-a-url',
  ])('rejects unsafe or unsupported endpoint %s', (endpoint) => {
    expect(() => readConfig({ ...env, FOUNDRY_ENDPOINT: endpoint })).toThrow();
  });
  it.each([
    null, {}, body('unknown'), body('triage', { message: '' }), body('shortlist', { budget: null }),
    body('readiness', { approvedSupplier: 'false' }), body('triage', {}, 1),
  ])('rejects malformed input %#', (value) => {
    expect(() => readInput(value)).toThrow();
  });
});

describe('Foundry output validation', () => {
  it('preserves real model fields and token usage', () => {
    expect(readFoundryResponse(payload(), request)).toEqual(payload());
  });
  it.each([
    null,
    { model: 'test', answers: {} },
    { ...payload(), answers: { next_step: { type: 'score', choice: 'disruption', probabilities: {} } } },
    payload({ disruption: 0.97, leisure: 0.01, refunds: 0.01, support: 0.01 }, 'unknown'),
    payload({ disruption: NaN, leisure: 0.01, refunds: 0.01, support: 0.01 }),
    payload({ disruption: 1.1, leisure: -0.1, refunds: 0, support: 0 }),
    payload({ disruption: 0.2, leisure: 0.2, refunds: 0.2, support: 0.2 }),
    payload({ disruption: 0.97, leisure: 0.01, refunds: 0.01, support: 0.01 }, 'support'),
    { ...payload(), usage: { input_tokens: -1, output_tokens: 0 } },
  ])('rejects invalid model response %#', (value) => {
    expect(() => readFoundryResponse(value, request)).toThrow('Foundry');
  });
  it('rejects missing or unknown probability keys', () => {
    const value = payload();
    expect(() => readFoundryResponse({ ...value, answers: { next_step: {
      ...value.answers.next_step, probabilities: { disruption: 1, unknown: 0 },
    } } }, request)).toThrow();
  });
});

describe('live runner', () => {
  it('uses a bearer token only server-side and returns explicit model provenance', async () => {
    const token = vi.fn().mockResolvedValue('test-token-never-exported');
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload()));
    const result = await createRunner(readConfig(env), { token, fetch: fetcher })(body());
    expect(result.result.source).toBe('foundry');
    expect(result.result.selected).toBe('disruption');
    expect(result.response?.usage?.input_tokens).toBe(80);
    expect(result.request?.model).toBe('Decision-1');
    expect(JSON.stringify(result)).not.toContain('test-token-never-exported');
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe(env.FOUNDRY_ENDPOINT);
    expect(options?.headers).toMatchObject({ Authorization: 'Bearer test-token-never-exported' });
    expect(options?.redirect).toBe('error');
  });
  it('does not acquire a token or call Foundry with no eligible itinerary', async () => {
    const token = vi.fn();
    const fetcher = vi.fn();
    const exchange = await createRunner(readConfig(env), { token, fetch: fetcher })(body('shortlist', { budget: 500 }));
    expect(exchange.result.source).toBe('application-gate');
    expect(exchange.result.selected).toBeNull();
    expect(exchange.result.needsReview).toBe(true);
    expect(exchange.request).toBeNull();
    expect(exchange.response).toBeNull();
    expect(token).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('sends only eligible itineraries when at least two remain', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      model: 'microsoft-decision-1', answers: { next_step: { type: 'choice', choice: 'direct', probabilities: { direct: 0.9, flex: 0.1 } } },
    }));
    const exchange = await createRunner(readConfig(env), { token: async () => 'test', fetch: fetcher })(body('shortlist', { budget: 1200, arrivalBy: 14 }));
    expect(Object.keys(exchange.request!.questions.next_step.criteria)).toEqual(['direct', 'flex']);
    expect(exchange.result.scores.filter((score) => !score.eligible).every((score) => score.probability === 0)).toBe(true);
  });
  it('handles one eligible itinerary without a model call or fabricated probability', async () => {
    const token = vi.fn();
    const fetcher = vi.fn();
    const exchange = await createRunner(readConfig(env), { token, fetch: fetcher })(body('shortlist', { budget: 1000, arrivalBy: 14 }));
    expect(exchange.result.source).toBe('application-gate');
    expect(exchange.result.selected).toBe('direct');
    expect(exchange.result.topScore).toBe(0);
    expect(exchange.result.needsReview).toBe(true);
    expect(exchange.result.disposition).toContain('only one eligible');
    expect(exchange.request).toBeNull();
    expect(exchange.response).toBeNull();
    expect(token).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    [{ fare: 1500 }, 'Manager approval required'],
    [{ cabin: 'business' }, 'Manager approval required'],
    [{ approvedSupplier: false }, 'Human review - verify booking conditions'],
    [{ refundable: false }, 'Human review - verify booking conditions'],
    [{ fare: 1500, approvedSupplier: false }, 'Human review and manager approval required'],
  ])('keeps mandatory policy gates even if the model chooses ready: %j', async (patch, disposition) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      model: 'microsoft-decision-1', answers: { next_step: { type: 'choice', choice: 'ready', probabilities: { ready: 0.99, approval: 0.005, review: 0.005 } } },
    }));
    const exchange = await createRunner(readConfig(env), { token: async () => 'test', fetch: fetcher })(body('readiness', patch));
    expect(exchange.result.selected).toBe('ready');
    expect(exchange.result.needsReview).toBe(true);
    expect(exchange.result.disposition).toBe(disposition);
  });
  it('applies the threshold to model probabilities, not confidence', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload()));
    const exchange = await createRunner(readConfig(env), { token: async () => 'test', fetch: fetcher })(body('triage', {}, 0.99));
    expect(exchange.result.needsReview).toBe(true);
    expect(exchange.result.disposition).toContain('below score threshold');
  });
  it.each([401, 403, 429, 500])('surfaces upstream HTTP %s without fallback or body leakage', async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('sensitive upstream text', { status }));
    const runner = createRunner(readConfig(env), { token: async () => 'test', fetch: fetcher });
    await expect(runner(body())).rejects.toThrow(`Foundry returned HTTP ${status}`);
  });
  it('reports CLI failures without leaking CLI output', async () => {
    const runner = createRunner(readConfig(env), { token: async () => { throw new Error('secret stderr'); }, fetch });
    await expect(runner(body())).rejects.toThrow('Azure CLI token acquisition failed');
  });
  it('reports transport failures explicitly', async () => {
    const runner = createRunner(readConfig(env), { token: async () => 'test', fetch: async () => { throw new Error('network'); } });
    await expect(runner(body())).rejects.toThrow('no simulation fallback');
  });
});

describe('local HTTP boundary', () => {
  const servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
      server.closeAllConnections();
      server.close((error) => error ? reject(error) : resolve());
    })));
    vi.restoreAllMocks();
  });
  async function start() {
    const api = createApi(env);
    const server = createServer((req, res) => { void api(req, res, () => { res.writeHead(404); res.end(); }); });
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No test server address');
    return `http://127.0.0.1:${address.port}`;
  }
  it('provides non-secret config and rejects cross-origin POSTs', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const url = await start();
    const config = await fetch(`${url}/api/config`);
    expect(config.headers.get('cache-control')).toBe('no-store');
    expect(await config.json()).toEqual(readConfig(env));
    const denied = await fetch(`${url}/api/decision`, { method: 'POST', headers: { Origin: 'https://other.example', 'Content-Type': 'application/json' }, body: JSON.stringify(body()) });
    expect(denied.status).toBe(403);
  });
  it('rejects malformed JSON, wrong media type and oversized bodies', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const url = await start();
    const post = (data: string, contentType = 'application/json') => fetch(`${url}/api/decision`, {
      method: 'POST', headers: { Origin: url, 'Content-Type': contentType }, body: data,
    });
    expect((await post('{')).status).toBe(400);
    expect((await post('{}', 'text/plain')).status).toBe(415);
    expect((await post(JSON.stringify({ text: 'a'.repeat(17000) }))).status).toBe(413);
    expect((await post('{}')).status).toBe(400);
  });
  it('returns an application-only gate through the real HTTP adapter', async () => {
    const url = await start();
    const response = await fetch(`${url}/api/decision`, {
      method: 'POST', headers: { Origin: url, 'Content-Type': 'application/json' },
      body: JSON.stringify(body('shortlist', { budget: 500 })),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).result.source).toBe('application-gate');
  });
});
