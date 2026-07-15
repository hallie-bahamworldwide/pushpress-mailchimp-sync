import type { Customer } from "@pushpress/pushpress/models/components";

/**
 * The four statuses that should be reflected in Mailchimp. Staff roles
 * (admin, coach, frontdesk, superuser) are intentionally excluded.
 */
const SYNCABLE_ROLES = new Set(["lead", "non-member", "ex-member", "member"]);

export function isSyncable(customer: Customer): boolean {
  return !!customer.email && !!customer.role && SYNCABLE_ROLES.has(customer.role);
}

// Mailchimp automations/segments match Member Status by exact text (e.g.
// "Member Status is Member"), so this must stay Title Case to match.
const STATUS_LABELS: Record<string, string> = {
  lead: "Lead",
  member: "Member",
  "non-member": "Non-Member",
  "ex-member": "Ex-Member",
};

export function statusLabel(role: string): string {
  return STATUS_LABELS[role] ?? role;
}

export const FACILITIES = ["Hammond", "Mandeville"] as const;
export type Facility = (typeof FACILITIES)[number];

/** The Mailchimp LOCATION merge field is a dropdown restricted to these two letter codes. */
const FACILITY_MERGE_VALUES: Record<Facility, string> = {
  Hammond: "H",
  Mandeville: "M",
};

export function facilityMergeValue(facility: Facility): string {
  return FACILITY_MERGE_VALUES[facility];
}

/**
 * Only current members carry a facility - looks for a known facility name
 * inside a plan's display name. Leads/non-members/ex-members never have one,
 * even if they had an enrollment in the past.
 */
export function extractFacility(
  role: string | null | undefined,
  planName: string | null | undefined,
): Facility | undefined {
  if (role !== "member" || !planName) return undefined;
  const lower = planName.toLowerCase();
  return FACILITIES.find((facility) => lower.includes(facility.toLowerCase()));
}
