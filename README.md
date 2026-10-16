# Flight Team | Decision Studio

A local demonstration of where Microsoft-Decision-1 could support travel teams,
using synthetic travel data. The existing Foundry deployment is connected through
a local Entra-authenticated server adapter. No customer system, inventory, or booking API is connected.
The public interface uses generic Flight Team naming and no customer branding.

**Local-demo only:** light theme, desktop-focused, synthetic travel data, no
automated booking or routing. Live inference may incur Azure usage charges.

## At a glance

- **Three bounded decisions:** disruption triage, itinerary selection and booking readiness.
- **Two presentation views:** Experience for a walkthrough; Technical for inputs,
  choices, gates, request/response JSON, model probabilities, token usage and latency.
- **Two execution sources:** Foundry live (default) and explicit local simulation.
  Live failures never silently fall back to synthetic scoring.
- **Passwordless local authentication:** the server uses the signed-in Azure CLI
  identity through `AzureCliCredential`. No API keys or browser tokens.
- **Application-owned safeguards:** budget, arrival, approval and verification
  gates cannot be bypassed by a model score.

[Run locally](#run-locally) | [Architecture](#architecture) |
[Presenter walkthrough](#five-minute-presenter-path) |
[Foundry contract](#foundry-contract-and-safeguards) |
[Troubleshooting](#troubleshooting)

## Plan first

### Use-case and model understanding

Flight Team is a fictional travel team supporting leisure and corporate travel.
The demo illustrates consultant productivity and corporate travel controls
without claiming access to any real organization's requirements, internal
policies, or operational data.

Microsoft-Decision-1 makes bounded, typed decisions: classification, selection
among candidates, ordered scores, and gates. It returns numerical decisions,
not prose or a written rationale. It is not a travel-planning chatbot or a
source of live fares, availability, visa advice, or travel safety advice.

### Three proposed use cases

| Scenario | Input and choices | Demo value hypothesis | Human boundary |
| --- | --- | --- | --- |
| Disruption triage | Traveller message; disruption desk, leisure consultant, refund team, general support | More consistent first-touch routing | Ambiguous or low-scoring messages go to a person |
| Trip shortlist | Three fictional itineraries; budget, arrival deadline, flexibility preference | Help consultants compare an existing shortlist | No eligible option or close scores require review; never books |
| Booking readiness | Fictional fare and corporate policy checks; ready, manager approval, review | Highlight policy exceptions before booking | Exceptions are never cleared by a high score |

These are illustrative use-case hypotheses, not confirmed customer initiatives.
They demonstrate finite decision spaces rather than free-form generation.

### Experience and implementation sequence

1. Research model capabilities and generic travel workflows; select bounded scenarios.
2. Build a single responsive studio: scenario selection, editable context,
   candidate scores, a review threshold, and structured input/output inspection.
3. Validate deterministic rules, review boundaries, errors, and desktop UX.
4. Connect the existing Foundry deployment with server-side Azure CLI / Entra ID
   authentication (approved and implemented on 16 October 2026).

Design: a red horizontal header, clean white and light-grey surfaces, rounded
cards and prominent actions create a straightforward travel-workspace interface.
Flight Team is a fictional identity, not a recreation of any company's branding.
No logos, proprietary fonts, marketing copy or imagery are copied. The studio is
light-only regardless of system preferences or URL theme parameters. Desktop is
the presentation target; existing responsive styles are retained, but mobile is
not a validation priority. It works without external fonts, images,
analytics, or CDNs. Model names appear only as technical integration context.

## Run locally

### Foundry live prerequisites

The repository does **not** provision Azure resources or deploy a model. Before
using **Foundry live**, prepare the following:

| Requirement | What to provide or verify |
| --- | --- |
| Azure subscription and Foundry resource | An existing resource in a region where Microsoft-Decision-1 is available, with billing and sufficient inference quota/capacity. |
| Model deployment | An active **Microsoft-Decision-1** deployment on that resource. Copy its exact deployment name from Foundry; a model catalog entry alone is not a deployment. A chat model or agent deployment is not interchangeable. |
| Supported endpoint | The resource's complete `https://<resource>.services.ai.azure.com/providers/microsoft/v1/systemone` inference URL. This adapter accepts this Azure public-cloud host and route only, with no query string, credentials, explicit port or trailing slash. |
| Entra ID identity | An Azure CLI session for the intended tenant and a user with resource-level inference permissions, such as **Cognitive Services User**. Permission to view a subscription or manage deployments does not by itself verify inference access. |
| Network access | The local server must be able to resolve and reach the configured resource over HTTPS, and Azure CLI must be able to reach Entra ID for authentication. If resource access is restricted, use approved networking such as the required VPN/private connectivity and DNS. Do not disable network restrictions or bypass organizational policy. |
| Local runtime | Node.js 22.12+ (or a supported newer LTS), npm, and Azure CLI available to the process running Vite. `npm ci` installs the project's Azure Identity SDK; no global SDK install is required. |
| Server configuration | A root `.env` containing `FOUNDRY_ENDPOINT` and `FOUNDRY_DEPLOYMENT`; preferably set `AZURE_SUBSCRIPTION_ID` to pin token acquisition. See the examples below. No API key, client secret, stored token or separate app registration is required for this CLI-authenticated local demo. |

The live API must support the documented Decision-1 **choice** contract: a
`model`, `state`, and named `questions` request, and a typed answer containing
the chosen option and per-option probabilities. Choice questions require
**2-255 options**. The application skips inference and requests human review
when fewer than two eligible itineraries remain; it does not invent a model
probability. See [Foundry contract and safeguards](#foundry-contract-and-safeguards)
for response validation, timeouts and application-owned policy gates.

Model availability, deployment setup and current service requirements are
documented in [Microsoft Learn: Deploy and use Microsoft-Decision-1](https://learn.microsoft.com/azure/foundry/foundry-models/how-to/use-foundry-models-microsoft-decision).
If a prerequisite is missing, have the resource owner resolve it; this app does
not deploy resources, assign permissions, or alter Azure account/network settings.

**Not required for local simulation or automated tests:** an Azure resource,
model deployment, Azure CLI sign-in or paid inference access. Those paths use
local rules or mocked responses. Live mode is the default, so select
**Local simulation** explicitly for an offline walkthrough.

### Install and start

Requires Node.js 22.12+ (or a supported newer LTS) and npm; Azure CLI is required
only for live inference.
Foundry live uses the identity already signed into Azure CLI with access to the
configured resource (for example, Cognitive Services User at the resource scope).
If sign-in is needed, run `az login` yourself for the intended tenant. The app
never signs in, switches account context, provisions resources, or grants roles.

```powershell
npm ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
# Edit .env with your endpoint, deployment and optional subscription ID.
npm run dev
```

Open the localhost URL printed by Vite. Development binds to `127.0.0.1`.
For a local-only walkthrough without an Azure deployment, start the app and
choose **Local simulation** in the execution selector. It requires no Azure
credentials or inference access; live mode still requires valid configuration.

```powershell
npm test
npm run build
npm run preview
```

The build runs the strict TypeScript check before producing `dist`. The local
Vite development and preview servers both include the server-side adapter.
Restart the server after changing `.env` or server configuration. Use
`npm run preview -- --port 4173 --strictPort` for the presenter URL.

The original working copy has a configured, ignored `.env`; it is **not included
in Git**. Fresh clones must create their own from [.env.example](./.env.example).
Use the deployment name from your Foundry resource, which can differ from the
underlying model name. Environment settings:

| Variable | Purpose |
| --- | --- |
| `FOUNDRY_ENDPOINT` | Full HTTPS `/providers/microsoft/v1/systemone` URL |
| `FOUNDRY_DEPLOYMENT` | Deployment name (not the response's underlying model name) |
| `AZURE_SUBSCRIPTION_ID` | Optional pin for CLI token acquisition without switching global context |

These are server-only variables, never `VITE_*`. Do not store keys, access tokens,
or refresh tokens in `.env`. `AzureCliCredential` acquires a Cognitive Services
token in server memory through Azure CLI. Subscription pinning is used instead
of simultaneously passing tenant and subscription, which CLI rejects.

### Configure `.env`

Create `.env` in the repository root, next to `package.json`. For example:

```dotenv
FOUNDRY_ENDPOINT=https://your-resource.services.ai.azure.com/providers/microsoft/v1/systemone
FOUNDRY_DEPLOYMENT=your-deployment-name
AZURE_SUBSCRIPTION_ID=your-subscription-guid
```

Replace the placeholders with your existing Foundry resource and deployment.
`FOUNDRY_ENDPOINT` is the **complete** Decision-1 inference URL, not a project URL
or chat-completions endpoint. Do not append an API-version query string.
`FOUNDRY_DEPLOYMENT` is the deployment name, not necessarily `Microsoft-Decision-1`.
`AZURE_SUBSCRIPTION_ID` can be left empty to use the current CLI context; setting
it explicitly makes this local demo independent of the CLI's default subscription.
The committed example contains no real resource identifiers or credentials.

Vite loads these settings on server startup. Restart `npm run dev` or
`npm run preview` after editing `.env`; reloading the browser alone is insufficient.

### Sign in with Azure CLI / Entra ID

Install [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli)
and use a user identity authorized for inference on the existing Foundry resource.
Skip sign-in if your intended identity already has a valid CLI session.

```powershell
az version
az login --tenant "YOUR-TENANT-GUID"
az account show --subscription "YOUR-SUBSCRIPTION-GUID" --query "{subscription:id,tenant:tenantId,user:user.name}" --output json
```

Verify the returned tenant, subscription and user before running the demo.
If browser sign-in is unavailable, use your organization's approved CLI sign-in
method (for example, `az login --tenant "YOUR-TENANT-GUID" --use-device-code`
when allowed). Sign-in is a user action; this app never invokes `az login`
or `az account set`.

To verify token acquisition without printing the access token:

```powershell
az account get-access-token --resource https://cognitiveservices.azure.com --subscription "YOUR-SUBSCRIPTION-GUID" --query "{tenant:tenant,expiresOn:expiresOn}" --output json
```

Use subscription **or** tenant scoping for `get-access-token`, not both. The
server's `AzureCliCredential` requests
`https://cognitiveservices.azure.com/.default`, which maps to that resource.
It uses only the CLI identity, not API keys, environment client secrets, or
a fallback credential chain. Bearer tokens stay in server memory and are absent
from browser requests, JSON exports, `.env`, logs and Git.

The identity needs an appropriate inference role, such as **Cognitive Services
User**, at the target resource scope; subscription visibility alone does not
prove inference access. Ask the resource owner to grant approved least-privilege
access if missing. The app does not create roles or change network policy.
Choose **Foundry live**, then **Run Foundry decision** to verify end-to-end access.
Authentication failures are explicit errors; choose **Local simulation** manually
if you want to continue without live access.

This adapter is **local-demo-only**, bound to `127.0.0.1`. It restricts API Host and
Origin, accepts bounded JSON bodies, serializes inference requests, disables
response caching, uses a fixed configured Azure endpoint and refuses redirects.
It is not an authenticated multi-user service. Do not expose the Vite server on a
public interface. Deploying just `dist` does not deploy this API; production
requires a separately designed backend and managed identity.

## Architecture

```text
Browser: React + TypeScript
  | same-origin /api/config and /api/decision
  v
Local Vite server: input validation + application policy gates
  | AzureCliCredential -> Azure CLI signed-in identity
  | server-only bearer token, HTTPS POST
  v
Foundry Decision-1: bounded choice + option probabilities
  |
  v
Validated response -> application review/approval gates -> browser
```

| Location | Responsibility |
| --- | --- |
| [src/App.tsx](./src/App.tsx) | Experience/Technical views, editable scenarios, execution selector and exports |
| [src/decision.ts](./src/decision.ts) | Scenario definitions, shared policy/review gates and deterministic simulator |
| [src/foundry.ts](./src/foundry.ts) | Typed response validation, model-result mapping and browser API client |
| [server/foundry.ts](./server/foundry.ts) | Server-only configuration, CLI credential, inference and bounded HTTP API |
| [vite.config.ts](./vite.config.ts) | Adapter registration for local dev and production preview |
| [src/decision.test.ts](./src/decision.test.ts), [src/foundry.test.ts](./src/foundry.test.ts), [server/foundry.test.ts](./server/foundry.test.ts) | Deterministic, contract, client and server-boundary regression tests |

### Validation

```powershell
npm test
npm run build
```

Tests use mocked Foundry responses and local HTTP servers; they do not require
Azure sign-in, make paid inference calls, or provision resources. The build also
type-checks the frontend, server adapter and Vite configuration. Browser smoke
checks target desktop, including source/view switching, errors, stale result
clearing, policy gates and exports.

## Five-minute presenter path

### Automated explanation

Choose **Automated demo** in the main navigation for a presenter-led animated
walkthrough with no timer or automatic advancement. Eight text stages follow context, finite choices,
Microsoft Decision-1 inference, option probabilities, application gates and
consultant confirmation, then connect the pattern to all three scenarios and
evaluation. Process nodes, choice cards and animated score bars illustrate the
flow. Previous/Next and Restart controls sit at the top; each step stays visible
until you navigate. The compact layout targets laptop screens without scrolling.
Escape or Close exits; reopening starts at the first step. Reduced-motion
preferences disable decorative animation.

This is **illustrative playback**, not live or recorded Foundry inference. Its
example scores come from the existing local simulator, not Decision-1, and are
labelled accordingly. It makes no inference calls, incurs no inference usage,
and does not change workspace inputs, results, scenario, source or view. Model
value is explained as structured judgment and reviewable numerical output, not
measured ROI or permission to bypass policy. Close the walkthrough and run a
Foundry live example to inspect actual model output in Technical view.

Use the **Experience / Technical** toggle in the workspace bar to switch views
without changing inputs, review threshold, scenario, or the current result.
Experience is the default presentation. Technical replaces the hero and visual
result with a compact introduction and application output JSON, and adds live input,
decision structure (choices, eligibility and gates), and proposed request previews.
In Foundry mode it also shows the actual sent request, validated response fields
(including confidence and token usage when supplied), model ID and round-trip time.
The same forms and execution controls work in both views. Invalid requests show
blocking messages; output appears only after a run and clears on input changes.
Model response JSON stays separate from application results and rule observations.

1. **Set expectations.** Choose the execution source. **Foundry live** (default)
   sends the current synthetic scenario to Azure only when Run is selected and
   may incur inference charges. **Local simulation** makes no inference calls.
   All fares, itineraries and policies are synthetic; live scores are model output.
2. **Disruption triage.** Run the grounded-flight example, inspect the option
   scores, then choose "Unclear request" to demonstrate human review. The
   message is editable. Live results may differ from the local keyword simulator;
   an unclear request is a discussion example, not a guaranteed live classification.
3. **Trip shortlist.** Run the balanced itinerary, change the priority to
   "Lowest fare", then reduce the budget below all candidates. Show that hard
   constraints cannot be overridden by a ranking score.
4. **Booking readiness.** Run a compliant booking, then select the
   "Policy exception" example. Show that approval remains mandatory even when
   the selected option has a high model score or selects "Ready for consultant".
5. **Make the model boundary tangible.** Switch to Technical or open "Inspect
   payload" to compare the sent `choice` request, validated Foundry response and
   separate policy-gated application result. Export a run if useful; filenames
   and JSON identify `foundry`, `local-simulation`, or `application-gate` sources.

Local scores are deterministic softmax-normalized rule weights, not model
probabilities. Live scores use the returned option probabilities without
renormalizing; returned `confidence` is preserved for inspection but does not
authorize policy bypass. Neither is calibrated for this workload. The review threshold is illustrative,
not validated. A top-two gap below 10 percentage points also requests review.
Application rule observations are not model-generated explanations.

Changes to inputs, scenarios, or threshold clear the prior result. Runs and
inputs live only in page memory; reloading resets them. Export is an explicit
local download. In live mode the active scenario is processed by Azure; processing
and retention follow the resource's service configuration. Tokens are never sent
to the browser or included in exports. Never enter real traveller or customer information.

## Foundry contract and safeguards

`server/foundry.ts` implements `/api/config` and `/api/decision` inside the local
Vite servers. The browser sends scenario inputs and a threshold, not an arbitrary
endpoint or credential. The server validates input, constructs the request using
`src/decision.ts`, adds the configured `model` deployment name and authenticates
using **only** `AzureCliCredential`. `src/foundry.ts` validates the typed response
and maps it to a distinct application result.

The verified REST contract is:

```text
POST <FOUNDRY_ENDPOINT>
Authorization: Bearer <server-only Azure CLI token>
Request: { model, state, questions: { next_step: { type: "choice", instructions, criteria } } }
Response: { model, answers: { next_step: { type: "choice", choice, probabilities, confidence? } }, usage? }
```

No extra `api-version` is appended to this documented v1 route. The adapter checks
known option keys, finite probabilities in [0,1], a sum within 0.01 of 1 (rounding
tolerance), a selected option tied for highest probability, and optional confidence
and usage types. It does not fabricate explanations or silently substitute scores.
Auth acquisition is limited to 15 seconds and inference to 45 seconds. CLI,
transport, HTTP and schema failures are surfaced explicitly; tokens and upstream
error bodies are not exposed in errors or logs.

Budget and arrival constraints filter candidates **before** inference. No eligible
itinerary produces `application-gate` output with null request/response and makes
no token or model call. Decision-1 requires 2-255 choice options. With exactly one
eligible itinerary, the application identifies that itinerary for human review,
also skips inference and reports "Not scored". Zero probability fields in such
gate outputs are unscored placeholders, not model probabilities or certainty.
Fare/cabin approval and supplier/refund verification gates
are shared by live and local execution. A model selecting "ready" cannot remove
either gate. Input, source, scenario and threshold edits clear both result and
exchange; stale in-flight responses cannot repopulate the UI.

Automated tests cover mocked inference, schema rejection, auth/HTTP failures,
policy bypass attempts, input validation and the local HTTP boundary. Live
smoke tests use only synthetic examples; they are not a labelled quality evaluation.
On 16 October 2026, the supplied endpoint passed live triage, two- and three-option
shortlist scoring, and combined booking approval/verification checks. Browser
checks also covered zero/one-option gates, explicit error handling, stale-response
discard, source switching, and credential-free exports. The 99 automated tests
and strict production build passed; the Azure CLI tenant/subscription were unchanged.
Before operational use, establish representative labelled examples, calibrate
thresholds, evaluate quality/latency/cost and review privacy/telemetry controls.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Configuration unavailable | Create `.env` from the example, set the full endpoint and deployment, then restart Vite. Do not use `VITE_*` for server settings. |
| Azure CLI token acquisition fails | Sign in to the intended tenant with Azure CLI and verify access to the configured subscription. The app will not switch context for you. |
| Foundry HTTP 401/403 | Verify the CLI identity's resource-level inference permissions and resource network access. Do not weaken network policy to fix connectivity. |
| Foundry HTTP 404/400 | Check the full `systemone` route and exact deployment name. This adapter uses the documented Microsoft Decision-1 choice contract, not chat completions. |
| Foundry HTTP 429 | Wait and retry; inspect quota/capacity if persistent. The app does not retry inference or substitute a simulated answer. |
| Only one or no itinerary remains | Expected application review gate: no model call is needed or supported. Change budget/arrival constraints to compare at least two options. |
| `/api/config` returns HTML, or API is absent | Use this repository's Vite dev/preview server and restart it after configuration changes. A static file server cannot provide the adapter. |
| Port 4173 is occupied | Stop only the known process you own, or select another preview port. The API requires the `127.0.0.1` host. |

`.env`, local configuration, dependencies and generated build output are ignored.
Commit [.env.example](./.env.example), not your configured `.env`. Never commit
access tokens, keys, private certificates, real traveller data or customer records.

## Sources

Reviewed 16 October 2026. These sources document model capabilities; the travel
scenarios above are synthetic assumptions. No performance or ROI claims are made.

- [Microsoft: Microsoft-Decision-1 introduction](https://commandline.microsoft.com/microsoft-decision-1-model-foundry/)
- [Microsoft Learn: Deploy and use Microsoft-Decision-1](https://learn.microsoft.com/azure/foundry/foundry-models/how-to/use-foundry-models-microsoft-decision)
