import { AzureCliCredential } from '@azure/identity';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  buildRequest, validateInputs,
  type Inputs, type ScenarioId,
} from '../src/decision';
import {
  isRecord, modelDecision, readFoundryResponse, shortlistGate, type DecisionExchange, type FoundryConfig,
} from '../src/foundry';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function readConfig(env: Record<string, string>): FoundryConfig {
  const endpoint = env.FOUNDRY_ENDPOINT;
  const deployment = env.FOUNDRY_DEPLOYMENT?.trim();
  if (!endpoint || !deployment) throw new ApiError(503, 'Configure FOUNDRY_ENDPOINT and FOUNDRY_DEPLOYMENT in the server-side .env, then restart.');
  let url: URL;
  try { url = new URL(endpoint); }
  catch { throw new ApiError(503, 'FOUNDRY_ENDPOINT must be a valid HTTPS Decision-1 URL.'); }
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.services.ai.azure.com')
    || url.pathname !== '/providers/microsoft/v1/systemone'
    || url.port || url.search || url.hash || url.username || url.password) {
    throw new ApiError(503, 'FOUNDRY_ENDPOINT must be an Azure services.ai.azure.com HTTPS systemone endpoint, without credentials or query parameters.');
  }
  return { endpoint: url.href, deployment, auth: 'Azure CLI / Entra ID' };
}
export function readInput(value: unknown): { scenario: ScenarioId; inputs: Inputs; threshold: number } {
  if (!isRecord(value) || (value.scenario !== 'triage' && value.scenario !== 'shortlist' && value.scenario !== 'readiness')
    || !isRecord(value.inputs) || typeof value.threshold !== 'number') {
    throw new ApiError(400, 'Provide a valid scenario, inputs object and numeric review threshold.');
  }
  const source = value.inputs;
  if (typeof source.message !== 'string' || typeof source.budget !== 'number'
    || typeof source.arrivalBy !== 'number' || (source.priority !== 'balanced' && source.priority !== 'price' && source.priority !== 'flexibility')
    || typeof source.fare !== 'number' || (source.cabin !== 'economy' && source.cabin !== 'business')
    || typeof source.approvedSupplier !== 'boolean' || typeof source.refundable !== 'boolean') {
    throw new ApiError(400, 'Decision inputs have invalid or missing field types.');
  }
  const scenario = value.scenario;
  const inputs: Inputs = {
    message: source.message, budget: source.budget, arrivalBy: source.arrivalBy,
    priority: source.priority, fare: source.fare, cabin: source.cabin,
    approvedSupplier: source.approvedSupplier, refundable: source.refundable,
  };
  try { validateInputs(inputs, scenario, value.threshold); }
  catch (error) { throw new ApiError(400, error instanceof Error ? error.message : 'Invalid decision inputs.'); }
  return { scenario, inputs, threshold: value.threshold };
}
interface Dependencies {
  token: () => Promise<string>;
  fetch: typeof fetch;
}
export function createRunner(config: FoundryConfig, dependencies: Dependencies) {
  return async (body: unknown): Promise<DecisionExchange> => {
    const { scenario, inputs, threshold } = readInput(body);
    const gate = shortlistGate(scenario, inputs, threshold);
    if (gate) return { request: null, response: null, durationMs: 0, result: gate };
    const request = { model: config.deployment, ...buildRequest(scenario, inputs) };
    const start = performance.now();
    let token: string;
    try { token = await dependencies.token(); }
    catch { throw new ApiError(401, 'Azure CLI token acquisition failed. Sign in with az login for the configured subscription, then retry. No account context was changed.'); }
    let upstream: Response;
    try {
      upstream = await dependencies.fetch(config.endpoint, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(45000),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(request),
      });
    } catch { throw new ApiError(502, 'Foundry request failed or timed out. Check connectivity; no simulation fallback was used.'); }
    if (!upstream.ok) {
      throw new ApiError(502, `Foundry returned HTTP ${upstream.status}. Check Entra permissions, model deployment, network access or quota. No simulation fallback was used.`);
    }
    let payload: unknown;
    try { payload = await upstream.json(); }
    catch { throw new ApiError(502, 'Foundry returned invalid JSON. No simulation fallback was used.'); }
    try {
      const response = readFoundryResponse(payload, request);
      return { request, response, result: modelDecision(scenario, inputs, threshold, response), durationMs: Math.round(performance.now() - start) };
    } catch (error) { throw new ApiError(502, error instanceof Error ? error.message : 'Invalid Foundry response.'); }
  };
}

export function createApi(env: Record<string, string>) {
  // Pin only the subscription: Azure CLI rejects simultaneous tenant/subscription arguments.
  const credential = new AzureCliCredential({ subscription: env.AZURE_SUBSCRIPTION_ID || undefined, processTimeoutInMs: 15000 });
  let busy = false;
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith('/api/')) { next(); return; }
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify(body));
    };
    let ownsSlot = false;
    try {
      const host = req.headers.host;
      if (!host || !/^127\.0\.0\.1:\d+$/.test(host)) throw new ApiError(403, 'API is restricted to the local 127.0.0.1 host.');
      if ((req.headers.origin && req.headers.origin !== `http://${host}`)
        || (req.method === 'POST' && req.headers.origin !== `http://${host}`)) {
        throw new ApiError(403, 'Only same-origin local requests are allowed.');
      }
      if (req.url === '/api/config' && req.method === 'GET') { send(200, readConfig(env)); return; }
      if (req.url !== '/api/decision') throw new ApiError(404, 'Unknown API route.');
      if (req.method !== 'POST') throw new ApiError(405, 'Use POST for decision requests.');
      if (!req.headers['content-type']?.startsWith('application/json')) throw new ApiError(415, 'Use application/json.');
      if (busy) throw new ApiError(429, 'A decision is already running. Wait and retry.');
      busy = true;
      ownsSlot = true;
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > 16384) throw new ApiError(413, 'Decision request exceeds the 16 KB limit.');
        chunks.push(bytes);
      }
      let body: unknown;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw new ApiError(400, 'Request body must be valid JSON.'); }
      const runner = createRunner(readConfig(env), {
        token: async () => (await credential.getToken('https://cognitiveservices.azure.com/.default')).token,
        fetch,
      });
      send(200, await runner(body));
    } catch (error) {
      const known = error instanceof ApiError;
      const status = known ? error.status : 500;
      const message = known ? error.message : 'The local Foundry adapter failed. No simulation fallback was used.';
      console.error(`[decision-api] ${status}: ${message}`);
      send(status, { error: message });
    } finally { if (ownsSlot) busy = false; }
  };
}
