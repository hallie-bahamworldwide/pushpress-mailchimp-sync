import type { Customer } from "@pushpress/pushpress/models/components";

/**
 * The four statuses that should be reflected in Mailchimp. Staff roles
 * (admin, coach, frontdesk, superuser) are intentionally excluded.
 */
const SYNCABLE_ROLES = new Set(["lead", "non-member", "ex-member", "member"]);

export function isSyncable(customer: Customer): boolean {
  return !!customer.email && !!customer.role && SYNCABLE_ROLES.has(customer.role);
}

const FACILITIES = ["Hammond", "Mandeville"] as const;
export type Facility = (typeof FACILITIES)[number];

/** Looks for a known facility name inside a plan's display name. */
export function extractFacility(planName: string | null | undefined): Facility | undefined {
  if (!planName) return undefined;
  const lower = planName.toLowerCase();
  return FACILITIES.find((facility) => lower.includes(facility.toLowerCase()));
}
