import { createHash } from "node:crypto";
import { requireEnv } from "./env.js";
import type { Facility } from "./mapping.js";

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

async function mailchimpRequest(
  config: MailchimpConfig,
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const response = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Basic ${Buffer.from(`anystring:${config.apiKey}`).toString("base64")}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Mailchimp ${init?.method ?? "GET"} ${path} failed: ${response.status} ${body}`,
    );
  }

  return response.status === 204 ? undefined : response.json();
}

const WANTED_MERGE_FIELDS = [
  { tag: "STATUS", name: "Member Status", type: "text" },
  { tag: "LOCATION", name: "Facility Location", type: "text" },
] as const;

/** Creates the STATUS/LOCATION merge fields on the audience if they don't already exist. */
export async function ensureMergeFields(config: MailchimpConfig): Promise<void> {
  const existing = (await mailchimpRequest(
    config,
    `/lists/${config.listId}/merge-fields?count=1000`,
  )) as { merge_fields: Array<{ tag: string }> };
  const existingTags = new Set(existing.merge_fields.map((field) => field.tag));

  for (const field of WANTED_MERGE_FIELDS) {
    if (!existingTags.has(field.tag)) {
      await mailchimpRequest(config, `/lists/${config.listId}/merge-fields`, {
        method: "POST",
        body: JSON.stringify(field),
      });
    }
  }
}

export function subscriberHash(email: string): string {
  return createHash("md5").update(email.trim().toLowerCase()).digest("hex");
}

export type ContactUpsert = {
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  location: Facility | undefined;
};

/** Idempotent create-or-update of a single contact, keyed by email. */
export async function upsertMember(config: MailchimpConfig, contact: ContactUpsert): Promise<void> {
  const hash = subscriberHash(contact.email);
  const mergeFields: Record<string, string> = {
    FNAME: contact.firstName,
    LNAME: contact.lastName,
    STATUS: contact.status,
  };
  if (contact.location) {
    mergeFields["LOCATION"] = contact.location;
  }

  await mailchimpRequest(config, `/lists/${config.listId}/members/${hash}`, {
    method: "PUT",
    body: JSON.stringify({
      email_address: contact.email,
      status_if_new: config.statusIfNew,
      merge_fields: mergeFields,
    }),
  });
}
