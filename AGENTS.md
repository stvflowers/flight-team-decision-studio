# Flight Team Decision Studio

- This project is Steve Flowers' streamlined Microsoft-Decision-1 customer demo.
- Plan and customer/use-case assumptions are in README.md. Keep them current.
- Use generic "Flight Team" naming throughout the site, metadata and downloads.
  No real-company names, logos, proprietary fonts or copied marketing assets.
  The reference informs red navigation, white surfaces and rounded travel cards.
- Keep all travel scenarios and policies synthetic and clearly labelled. Live
  Foundry inference is approved; model scores must be distinguished from simulation.
- Decision-1 returns bounded numerical decisions, not generated explanations.
  Keep application rule observations distinct from model output.
- Never turn a score into permission to bypass policy or book travel.
- Do not introduce Azure provisioning or change global Azure authentication.
- Keep the interface light-only, with no theme toggle or system/URL theme override.
- Preserve scenario, inputs and results when switching Experience / Technical views; show sent request, validated Foundry response and application result separately.
- Use server-only .env configuration and AzureCliCredential (CLI tokens in server memory). Never expose tokens to the browser, add keys, switch global Azure context or silently fall back to simulation.
- Keep the Vite API loopback-only; it is a local demo, not a production authentication boundary.
- Validate with `npm test` and `npm run build`; prioritize desktop browser behavior. Mobile is not a validation priority.
