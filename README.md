# PushPress → Mailchimp Sync

Keeps Mailchimp in sync with PushPress Core contacts: first name, last name,
member status (`lead` / `non-member` / `ex-member` / `member`), and facility
location (`Hammond` / `Mandeville`, inferred from the customer's subscription
plan name).

## How it works

This runs as a **scheduled GitHub Actions workflow** (`.github/workflows/sync.yml`),
not a webhook — no server to host or maintain. Every run:

1. Pages through every PushPress customer.
2. Keeps only leads/non-members/ex-members/members (skips staff accounts).
3. For each one, looks up their most relevant subscription (active, or most
   recent if none is active) and resolves its plan name to figure out
   `Hammond` or `Mandeville`.
4. Upserts the contact into your Mailchimp audience by email — creating them
   if new, updating them if they already exist. This is idempotent, so a
   flaky run or an overlapping run never causes duplicates or corruption.

Because every run reconciles the *entire* audience from scratch, a single
missed or failed run only means data is briefly stale — it self-heals on
the next run instead of silently drifting like a one-shot webhook would.

## One-time setup

### 1. PushPress API credentials

In PushPress Core, generate an API key (Settings → Developer/API) and note
your company ID.

### 2. Mailchimp credentials

- API key: Mailchimp → Account → Extras → API keys.
- Audience/List ID: Mailchimp → Audience → Settings → Audience name and defaults.

The sync automatically creates two merge fields on your audience if they
don't already exist: `STATUS` and `LOCATION`.

### 3. Add repo secrets

In this repo's GitHub settings → Secrets and variables → Actions, add:

- `PUSHPRESS_API_KEY`
- `PUSHPRESS_COMPANY_ID`
- `MAILCHIMP_API_KEY`
- `MAILCHIMP_LIST_ID`

### 4. Done

The workflow runs automatically every 4 hours. To change the frequency,
edit the cron expression in `.github/workflows/sync.yml`. To run it
immediately, use the "Run workflow" button under the Actions tab
(workflow_dispatch).

A failed run shows as a red ✗ in the Actions tab, and per-contact failures
are printed in the job log without blocking the rest of the sync.

## Local development

```bash
cp .env.example .env   # fill in the four values
npm install
npm run sync
```

## Notes / things worth knowing

- **Facility location** comes entirely from the plan name containing the
  literal text "Hammond" or "Mandeville" (case-insensitive). If a plan gets
  renamed to drop that word, contacts on it will stop resolving a location.
  Contacts with no enrollment yet (brand new leads) are synced with the
  `LOCATION` field left blank.
- **New-contact consent**: `MAILCHIMP_STATUS_IF_NEW` (default `subscribed`)
  controls the subscribe status applied the first time Mailchimp sees a
  given email. Only set this to `subscribed` if you have a lawful basis to
  email these contacts — check your Mailchimp compliance requirements
  (CAN-SPAM/GDPR/etc.) before changing it.
- **Staff accounts** (admin/coach/frontdesk/superuser roles) are never
  synced.
