import { PushPress } from "@pushpress/pushpress";
import type { Customer, Enrollment } from "@pushpress/pushpress/models/components";
import { requireEnv } from "./env.js";

export type PushPressClient = PushPress;

export function createPushPressClient(): PushPressClient {
  return new PushPress({
    apiKey: requireEnv("PUSHPRESS_API_KEY"),
    companyId: requireEnv("PUSHPRESS_COMPANY_ID"),
  });
}

/** Pages through every customer (lead, member, staff, etc.) in the company. */
export async function fetchAllCustomers(client: PushPressClient): Promise<Customer[]> {
  const customers: Customer[] = [];
  const pager = await client.customers.list({ limit: 100 });
  for await (const page of pager) {
    customers.push(...page.result.data.resultArray);
  }
  return customers;
}

/**
 * Finds the enrollment (subscription) most relevant to determining a
 * customer's facility: the active one if there is one, otherwise the most
 * recently started one. Returns undefined if the customer has never
 * enrolled in a plan (e.g. a brand new lead).
 */
export async function fetchRelevantEnrollment(
  client: PushPressClient,
  customerId: string,
): Promise<Enrollment | undefined> {
  const pager = await client.enrollment.list({ customerId, limit: 50 });
  let mostRecent: Enrollment | undefined;
  for await (const page of pager) {
    for (const enrollment of page.result.data.resultArray) {
      if (enrollment.status === "active") {
        return enrollment;
      }
      if (
        !mostRecent ||
        (enrollment.startDate ?? "") > (mostRecent.startDate ?? "")
      ) {
        mostRecent = enrollment;
      }
    }
  }
  return mostRecent;
}

const planNameCache = new Map<string, string | null>();

/** Resolves a plan's display name, caching per run since many customers share plans. */
export async function fetchPlanName(
  client: PushPressClient,
  planId: string,
): Promise<string | null> {
  if (planNameCache.has(planId)) {
    return planNameCache.get(planId) ?? null;
  }
  try {
    const plan = await client.plans.get({ id: planId });
    planNameCache.set(planId, plan.name);
    return plan.name;
  } catch (error) {
    console.error(`Failed to fetch plan ${planId}:`, error);
    planNameCache.set(planId, null);
    return null;
  }
}
