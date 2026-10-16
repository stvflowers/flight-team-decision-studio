import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildRequest, defaultInputs } from './decision';
import { modelDecision, readFoundryResponse, runFoundry } from './foundry';

afterEach(() => { vi.unstubAllGlobals(); });

describe('browser exchange boundary', () => {
  const request = { model: 'Decision-1', ...buildRequest('triage', defaultInputs) };
  const response = {
    model: 'microsoft-decision-1',
    answers: { next_step: { type: 'choice', choice: 'disruption', probabilities: { disruption: 0.97, leisure: 0.01, refunds: 0.01, support: 0.01 } } },
  };
  it('uses the same-origin API without sending credentials from the browser', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      request, response, result: { source: 'foundry' }, durationMs: 300,
    }));
    vi.stubGlobal('fetch', fetcher);
    const result = await runFoundry('triage', defaultInputs, 0.8, new AbortController().signal);
    expect(result.result.source).toBe('foundry');
    expect(result.response?.model).toBe('microsoft-decision-1');
    expect(fetcher.mock.calls[0][0]).toBe('/api/decision');
    expect(fetcher.mock.calls[0][1]?.headers).toEqual({ 'Content-Type': 'application/json' });
  });
  it('does not turn an auth failure into a local result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'Azure CLI token acquisition failed.' }, { status: 401 })));
    await expect(runFoundry('triage', defaultInputs, 0.8, new AbortController().signal)).rejects.toThrow('Azure CLI token');
  });
  it.each([null, {}, { result: {}, durationMs: 0, request: null, response: null }])('rejects malformed adapter exchanges %#', async (value) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(value)));
    await expect(runFoundry('triage', defaultInputs, 0.8, new AbortController().signal)).rejects.toThrow();
  });
  it('rejects a fabricated application gate when multiple itineraries are eligible', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
      request: null, response: null, result: { source: 'application-gate' }, durationMs: 0,
    })));
    await expect(runFoundry('shortlist', defaultInputs, 0.8, new AbortController().signal)).rejects.toThrow('unexpectedly blocked');
  });
  it('uses the selected model option to break exact probability ties and requires review', () => {
    const wire = readFoundryResponse({
      model: 'microsoft-decision-1', answers: { next_step: {
        type: 'choice', choice: 'refunds', probabilities: { disruption: 0.5, leisure: 0, refunds: 0.5, support: 0 },
      } },
    }, request);
    const result = modelDecision('triage', defaultInputs, 0.5, wire);
    expect(result.selected).toBe('refunds');
    expect(result.gap).toBe(0);
    expect(result.needsReview).toBe(true);
  });
});
