# Jobs client prebuild

This is a prebuild for job 96583e5f-4a9b-4ce8-a267-6c166d6188cf, not an awarded PACT or an accepted delivery. Specification read from the live registry on 26 October 2026.

```ts
import { createJobsClient, LaxJobsError } from '@godman-protocols/lax'
const jobs = createJobsClient()
const page = await jobs.listJobs({ limit: 10, offset: 0 })
const job = await jobs.getJob(page.jobs[0]!.id)
```

`submit` uses the legacy `/submissions` contract. It does not bid, sign, pay or deliver a selected tender milestone. Inject `fetch` and `sleep` for offline use. Default retries mean two extra attempts. A single timeout covers fetch and response JSON for each attempt, including injected transports that ignore abort. Untrusted transport errors are replaced with a generic message to avoid leaking URLs or credentials. Registry error text is retained.

Run `npm ci`, `npm test`, `npm run typecheck`. A1-A6 and error/timeout tests are offline. `LAX_LIVE=1 node --test test/jobs.test.mjs` additionally opts into A7, a free GET only. Package dependencies remain unchanged. Existing upstream offer and A2A smoke tests are retained.

## Assumptions and PACT boundary

- OpenAPI at https://lax.kognai.ai/openapi.json has no component Job schema and specifies jobs list items only as objects. Public Job fields are typed from https://www.kognai.ai/docs/kits/lax-registry-harness/registry/jobs.ts. Private PACT data is intentionally not modeled.
- Validate response envelopes, not every Job field. Preserve additional fields returned by the registry for forward compatibility.
- Future tracks are accepted as strings in filters. Limit is 1 to 100, offset is a nonnegative safe integer.
- DID validation follows the published method/identifier shape. No DID resolution or onchain identity claim is made.
- `invalid_response` covers invalid JSON or missing success envelopes and is not retried. Non-JSON HTTP errors keep their status and use a generic HTTP message.
- Retry-After seconds, including zero, take priority on retryable HTTP responses. Negative, date and malformed values use exponential fallback. The specified seconds cap is 30 seconds.
- No ownership of the upstream npm package or right to publish it is claimed. Delivery is the fork and commit, subject to PACT integration review.
- Original upstream Apache-2.0 license and attribution are preserved. The job's generic MIT wording conflicts with the existing package license. Confirm licensing with Kognai in PACT rather than silently relicense upstream code.

Hidden-test risk remains around unspecified strictness of response validation, malformed inputs outside the typed API and future schema changes. There is no claim that unseen tests or a future PACT have passed.
