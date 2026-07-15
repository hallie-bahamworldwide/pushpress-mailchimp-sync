import { createHash } from "node:crypto";
import { requireEnv } from "./env.js";
import { FACILITIES, facilityMergeValue, type Facility } from "./mapping.js";

export type MailchimpConfig = {
  apiKey: string;
  listId: string;
  baseUrl: string;
  statusIfNew: string;
};

export function createMailchimpConfig(): MailchimpConfig {
  const apiKey = requireEnv("MAILCHIMP_API_KEY");
  const serverPrefix = apiKey.split("-").pop();
  if (!serverPrefix || serverPrefix === apiKey) {
    throw new Error(
      "MAILCHIMP_API_KEY doesn't look like a Mailchimp key (expected a '-usXX' datacenter suffix)",
    );
  }
  return {
    apiKey,
    listId: requireEnv("MAILCHIMP_LIST_ID"),
    baseUrl: `https://${serverPrefix}.api.mailchimp.com/3.0`,
    statusIfNew: process.env["MAILCHIMP_STATUS_IF_NEW"] ?? "subscribed",
  };
}

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Every request gets a hard timeout and a few retries with backoff for
 * transient failures (network errors, timeouts, rate limits, 5xxs). Without
 * this, a single stalled connection could hang a worker - and the whole
 * run - indefinitely, which is exactly the unreliability this sync exists
 * to fix. Non-retryable errors (bad email, invalid data, etc.) still fail
 * immediately.
 */
async function mailchimpRequest(
  config: MailchimpConfig,
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response: Response;
    try {
      response = await fetch(`${config.baseUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          Authorization: `Basic ${Buffer.from(`anystring:${config.apiKey}`).toString("base64")}`,
          "Content-Type": "application/json",
          ...init?.headers,
        },
      });
    } catch (error) {
      if (attempt === MAX_ATTEMPTS) {
        throw new Error(
          `Mailchimp ${init?.method ?? "GET"} ${path} timed out or failed to connect after ${MAX_ATTEMPTS} attempts: ${error}`,
        );
      }
      await sleep(1000 * attempt);
      continue;
    }

    if (response.ok) {
      return response.status === 204 ? undefined : response.json();
    }

    const isRetryable = response.status === 429 || response.status >= 500;
    if (isRetryable && attempt < MAX_ATTEMPTS) {
      await sleep(1000 * attempt);
      continue;
    }

    const body = await response.text().catch(() => "");
    throw new Error(
      `Mailchimp ${init?.method ?? "GET"} ${path} failed: ${response.status} ${body}`,
    );
  }

  throw new Error(`Mailchimp ${init?.method ?? "GET"} ${path}: unreachable retry state`);
}

// These map to pre-existing merge fields in the audience (Settings > Audience
// fields and *|MERGE|* tags) - "Member Status" and "Facility" respectively.
// Do not auto-create fields here: doing so previously created unused
// duplicates ("STATUS"/"LOCATION") alongside the real ones below.
const STATUS_MERGE_TAG = "MBRSTATUS";
const FACILITY_MERGE_TAG = "MMERGE26";

export function subscriberHash(email: string): string {
  return createHash("md5").update(email.trim().toLowerCase()).digest("hex");
}

export type ContactUpsert = {
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  /** Only members carry a facility; leads/non-members/ex-members are undefined. */
  facility: Facility | undefined;
};

/** Idempotent create-or-update of a single contact, keyed by email. */
export async function upsertMember(config: MailchimpConfig, contact: ContactUpsert): Promise<void> {
  const hash = subscriberHash(contact.email);
  const mergeFields: Record<string, string> = {
    FNAME: contact.firstName,
    LNAME: contact.lastName,
    [STATUS_MERGE_TAG]: contact.status,
    // The Facility field is a Mailchimp dropdown restricted to "H"/"M". Sending
    // "" clears it for anyone who isn't currently a member at a known facility.
    [FACILITY_MERGE_TAG]: contact.facility ? facilityMergeValue(contact.facility) : "",
  };

  await mailchimpRequest(config, `/lists/${config.listId}/members/${hash}`, {
    method: "PUT",
    body: JSON.stringify({
      email_address: contact.email,
      status_if_new: config.statusIfNew,
      merge_fields: mergeFields,
    }),
  });

  await syncFacilityTags(config, hash, contact.facility);
}

/**
 * Applies the Hammond/Mandeville tag matching the contact's current facility
 * and removes the other one, so tags never go stale as people change
 * facilities or membership status.
 */
async function syncFacilityTags(
  config: MailchimpConfig,
  subscriberHashValue: string,
  facility: Facility | undefined,
): Promise<void> {
  const tags = FACILITIES.map((name) => ({
    name,
    status: name === facility ? "active" : "inactive",
  }));

  await mailchimpRequest(config, `/lists/${config.listId}/members/${subscriberHashValue}/tags`, {
    method: "POST",
    body: JSON.stringify({ tags }),
  });
}
