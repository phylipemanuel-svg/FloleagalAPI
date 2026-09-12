# Hartwell & Rowe mock booking API

Backs the `DEMO-HR-Hartwell-Rowe-Assistant` Telnyx voice agent demo. No
dependencies — plain Node.js, using the built-in `fetch`/runtime only.

All five endpoints are handled by **one file**, `api/[...path].js`, on
purpose: Vercel deploys each file under `api/` as a separate, isolated
serverless function, so five separate files would NOT share in-memory
state (a booking made via `/api/book` would be invisible to
`/api/availability`). Routing all five through one catch-all function
keeps them sharing the same in-memory store.

**Known limitation, accepted for this demo:** state lives in that one
function's process memory. It persists across "warm" repeated invocations
but resets if Vercel spins up a fresh instance (e.g. after a period of no
traffic). Use `/api/reset` to reseed on demand between demo runs.

## Endpoints

- `POST /api/availability` — `{practice_area (required), solicitor?, preferred_period?}` → up to 3 future, unbooked slots.
- `POST /api/book` — `{full_name, phone, slot_id, practice_area (all required), email?, format?, property_address?, matter_summary?, other_parties?, referral_source?}` → `{booking_reference}` (format `HR-XXXX`).
- `POST /api/confirm` — `{booking_reference (required), channel?}` → composes and **logs** (does not really send) a confirmation message with the appointment, the £195+VAT consultation fee, and the practice-area-specific document list.
- `POST /api/reset` — re-seeds the next 14 days of slots (skipping weekends and UK bank holidays), pre-books 3 first-week slots so the agent has to handle "that one's gone" at least once.
- `GET /api/bookings` — lists everything booked so far, for showing a prospect after the call.

Every inbound request is logged to the console (method, path, body) —
watch it live via the Vercel dashboard's function logs, or `vercel logs
<project> --follow`.

## Deploying (same browser-only path as the other Telnyx demo backend)

1. Push this `mock-api` folder to a GitHub repo (e.g. `hartwell-rowe-mock-api`) — drag the folder into GitHub's "Add file → Upload files" on a new repo.
2. Import it at vercel.com → **Add New → Project**.
3. No environment variables are required for this one.
4. Deploy. Your endpoints will be at `https://<your-project>.vercel.app/api/availability` etc.

## Testing locally (optional)

Requires Node.js installed. From this folder:

```bash
npx vercel dev
```

Then:

```bash
curl -X POST http://localhost:3000/api/availability \
  -H "Content-Type: application/json" \
  -d '{"practice_area": "residential_conveyancing"}'
```

## Seed data

Four solicitors, recurring weekly slot patterns (see `lib/store.js`),
seeded for the next 14 days from whenever the function starts, skipping
weekends and a hardcoded UK bank holiday list (covers late 2026–2027 — not
a general Easter-calculation algorithm, good enough for a demo, not for
production scheduling).
