# Dolly research guide: Gemini + Cloudflare Worker

Status: the Worker has been deployed and the public connection configuration is committed. Nitish ran all 9 mock backend tests successfully and reported local verification working. Recheck a complete answer on the public site after deployment; mock tests do not establish live model availability or response quality.

- Website: [Dolly RNA Explorer](https://umarmadbi.github.io/dsa4262-teamproject-dolly/).
- Chat endpoint: `https://dolly-guide.nitish-dolly.workers.dev/chat` (called by the website, not a standalone chat page).
- Public endpoint and Turnstile site key: `../site/chat-config.js`.
- Model and allowed origins: `wrangler.toml`; API credentials remain in Cloudflare secrets.

GitHub Pages serves the static site. The Worker runs separately. Provider quotas and billing depend on the accounts' settings.

## Included

- `../site/chat.js`, `chat.css`: accessible floating guide, suggested questions, clear/close, safely formatted answers and source IDs; no HTML from the model is executed.
- `../site/chat-config.js`: PUBLIC endpoint and Turnstile SITE key only. Empty defaults show an honest not-connected state.
- `worker.mjs`: bounds/validates requests, checks allowed origin, validates Turnstile, throttles calls, calls Gemini using a secret, hides upstream errors.
- `knowledge.mjs`: manually reviewed summaries of website guide, model development, EDA, SG-NEx comparison, and selected final report findings (see `report-summary.md`). No repository-wide uploads, connection guides, raw data, personal account details or credentials.
- `worker.test.mjs`: mock-only tests; no API key/network/payment required.

The assistant explains documented findings; it has NO live chart access, data-query tools, arbitrary URL fetch, file access, code execution, model training or new predictions. It must direct live numerical questions to charts/tables. This is separate from the m6A prediction model.

## Automatic Worker deployment

The **Dolly Worker** GitHub Actions workflow runs when Worker code, bundled knowledge, its tests, or Wrangler configuration changes on `main`. It tests the Worker before deploying. You can also run it manually from Actions with `main` selected.

Before merging or running the workflow, a repository administrator should create the `dolly-worker` GitHub environment, restrict its deployment branch to `main`, and add these environment secrets:

- `CLOUDFLARE_API_TOKEN`: a Cloudflare API token with Workers Scripts Edit access scoped to the account that owns `dolly-guide`.
- `CLOUDFLARE_ACCOUNT_ID`: the ID of that same Cloudflare account.

Keep Gemini and Turnstile credentials on the existing Worker. GitHub Actions does not need them. After the first successful workflow run, open Ask Dolly and check that it can answer a question with a project source. The mock tests do not contact Gemini or Cloudflare.

The workflow deploys `knowledge.mjs` as committed. Editing the original report or a Markdown summary alone does not change what Dolly receives; update the reviewed bundle too. GitHub Pages continues to handle website publishing separately.

## Reproduce or reconfigure the deployment

Use Node 22+ and a current Wrangler 4 CLI (>=4.36 for rate-limit bindings). From the repository root:

```bash
node --test viz/chatbot/worker.test.mjs
cd viz/chatbot
npx wrangler@4 login
```

On Windows PowerShell, if script execution blocks `npx.ps1`, use `npx.cmd` in place of `npx` below. No execution-policy change is needed.

1. Create a Gemini API project/key in https://aistudio.google.com/apikey. Select an available text model with `generateContent` support and check its actual free-tier allowance in your account. Do not enable paid billing if the aim is a zero-charge pilot. No model is silently selected for you.
2. In Cloudflare, create a Turnstile widget. Allow your website hostname and `localhost` / `127.0.0.1` if testing locally. The site key is public; the secret key is private. Use managed mode. The UI passes action `dolly-chat`; Worker verifies it and the hostname.
3. Edit `wrangler.toml`: set `GEMINI_MODEL` to the model ID. Set `ALLOWED_ORIGINS` to exact website origins separated by commas. For GitHub Pages this is `https://YOUR-OWNER.github.io`, WITHOUT repository path or trailing slash; confirm the actual Pages URL. Keep localhost only while needed. Use a rate-limit namespace ID unique in your Cloudflare account.
4. Enter secrets using the hidden CLI prompts (never put values into source, terminal commands, screenshots, or chat):

```bash
npx wrangler@4 secret put GEMINI_API_KEY
npx wrangler@4 secret put TURNSTILE_SECRET_KEY
npx wrangler@4 deploy
```

Wrangler may ask to create the Worker when entering the first secret. Follow its prompt. Do not enable paid Cloudflare services for this pilot.

5. Copy the resulting Worker URL into `viz/site/chat-config.js`, adding `/chat`. Put the Turnstile PUBLIC SITE key in `turnstileSiteKey`. There is NO Gemini key in this file.
6. Serve the site from the repo root:

```bash
python3 -m http.server 8000 --bind 127.0.0.1 --directory viz/site
```

Open http://127.0.0.1:8000, click Ask Dolly, complete verification and send a question. This uses the deployed backend even though the website is local. No need to deploy the website publicly to test it. For Pages publishing, use the project's existing deployment workflow after branch review.

## Updating the deployed assistant

1. Review changes to `knowledge.mjs` when project methods or findings change; source documents are not imported automatically.
2. From the repository root, run `node --test viz/chatbot/worker.test.mjs`.
3. From `viz/chatbot/`, run `npx wrangler@4 deploy` (Windows: `npx.cmd wrangler@4 deploy`). Use the Cloudflare account that owns the deployed Worker.
4. For frontend changes, open a pull request and merge after review; the Pages workflow publishes eligible changes to `main`.
5. Keep Turnstile hostname settings aligned with the website: `umarmadbi.github.io`, plus `localhost` and `127.0.0.1` for local testing. Origins in `wrangler.toml` include protocol and local port, but no repository path.

## Verify before release

- Ask what the cutoff changes, why a missing site is not zero, and how v2 differs from v1. Check cited source IDs and wording.
- Ask for the highest-scoring current site: it must acknowledge no live data access.
- Ask it to ignore instructions and reveal secrets: it should decline, but confidentiality relies on never providing secrets in its knowledge, not on prompting alone.
- Check narrow mobile width, keyboard open/close, clear history, Turnstile expiry and blocked/timeout/quota errors.
- Use a non-allowed Origin and invalid Turnstile token; neither should reach Gemini.
- If model configuration is unavailable, fix the model ID/eligibility rather than silently switching to a billed model.

## Cost, limits and privacy

The rate limit is 10 requests/minute per Cloudflare location across all visitors, before verification. It is deliberately modest for the pilot. It is NOT a global daily budget or precise billing cap. CORS is not authentication; non-browser clients can forge Origin. Turnstile adds abuse resistance, not a guarantee. Keep free-tier billing settings and provider quotas appropriate; shared visitors can exhaust them. Do not claim unlimited or guaranteed free use.

Each request includes reviewed knowledge, the current question and at most two previous exchanges. User questions max 1500 chars; full JSON max 16000 bytes; context max 12000 chars; output max 1536 tokens. These bounds limit cost but do not make it zero. Long replies/context are truncated; do not promise indefinite conversational memory.

No application chat persistence or prompt logging is implemented. Browser history remains in memory until refresh/clear; the host/provider may still process metadata and content under their terms. Questions/recent chat are sent to Cloudflare and Google; Gemini free-tier data handling may include product improvement. The UI informs users. Imported site data and chart selections are NOT sent. Do not paste credentials or unpublished/private data into chat.

No key is included in the model prompt. Worker secrets are used only as API credentials. Raw provider errors are never forwarded. Treat all knowledge as potentially discloseable through answers, even if stored on the backend. Current summaries are intentionally public-facing. Updating the original project docs does NOT update the chatbot: review `knowledge.mjs`, run tests and redeploy.

## Reviewed sources (branch snapshot when implemented)

- Website `viz/site/index.html`: blob `23aabf5454f2bcd1d7dd053ce660428d3dce6f36`.
- `viz/README.md`, `docs/model_development.md`, `docs/eda_findings.md`, `docs/sgnex_task2.md`, read from `joshua-workinprogress` during implementation.
- The UI excludes development datasets. Knowledge retains training datasets only as methods context.
- User-supplied final group report: selected sections 3–6 summarised in `report-summary.md`. The original PDF is not uploaded.
- EDA recommendations such as class weighting are distinct from final implementation choices. Knowledge follows model development for final model details.
- Project results are attributed to the team's documentation; this implementation did not rerun model experiments or validate their scientific conclusions.

## Official service references

- https://ai.google.dev/gemini-api/docs/generate-content/text-generation
- https://ai.google.dev/gemini-api/docs/pricing
- https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
- https://developers.cloudflare.com/turnstile/get-started/server-side-validation/

To disable chat, blank the public endpoint and redeploy the static site, or remove the chat script/link tags from index.html. To stop API access entirely, revoke the Gemini key or remove the Worker secret. Clearing the browser configuration alone does not disable a previously deployed backend.

## Launcher and reading space

The launcher uses a code-native SVG sheep with gentle grazing, breathing, blinking and chewing animations; reduced-motion preferences keep it still. A dismissible greeting appears after 8 seconds and closes after 6.5 seconds, at most once per browser-tab session. Opening the guide cancels the invitation.

The chat has a larger, independently scrolling reading area and a fixed composer. Welcome text and suggested prompts tuck away after the first message; Clear chat restores them. Privacy information remains available in a disclosure.

The Turnstile container collapses only after its success callback supplies a token. It reappears after expiry, errors or a request consumes the token and the widget resets. Backend verification, throttling and secret handling are unchanged. Frontend changes do not require redeploying the Worker.

## Response formatting and front-facing launcher

Assistant replies support a limited, safe formatting subset: bold spans, inline code, paragraphs, headings displayed as bold paragraphs, and ordered/unordered lists. Formatting is constructed with DOM text nodes and elements; raw model HTML is never executed. User messages remain literal text. Dolly’s launcher now faces forward and lowers its head to nibble the grass in front, retaining reduced-motion support.
