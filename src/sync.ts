import { runWithConcurrency } from "./concurrency.js";
import { extractFacility, isSyncable, statusLabel } from "./mapping.js";
import { createMailchimpConfig, upsertMember } from "./mailchimp.js";
import {
  createPushPressClient,
  fetchAllCustomers,
  fetchPlanName,
  fetchRelevantEnrollment,
} from "./pushpress.js";

const CONCURRENCY = 5;

// A handful of contacts failing (typo'd emails, etc.) is normal and
// shouldn't trigger a "run failed" notification. Only treat the run as
// failed if nothing succeeded at all, or if failures make up more than
// this share of syncable contacts - either signals a systemic problem
// (bad credentials, API outage) rather than a few bad records.
const FAILURE_RATE_THRESHOLD = 0.1;

export async function runSync(): Promise<void> {
  const pushPress = createPushPressClient();
  const mailchimp = createMailchimpConfig();

  const allCustomers = await fetchAllCustomers(pushPress);
  const syncable = allCustomers.filter(isSyncable);
  console.log(
    `Fetched ${allCustomers.length} PushPress contacts, ${syncable.length} are syncable (lead/non-member/ex-member/member with an email).`,
  );

  let succeeded = 0;
  const failures: Array<{ email: string; error: string }> = [];

  await runWithConcurrency(syncable, CONCURRENCY, async (customer) => {
    try {
      // Only members carry a facility - skip the enrollment/plan lookups entirely
      // for leads/non-members/ex-members.
      const enrollment =
        customer.role === "member"
          ? await fetchRelevantEnrollment(pushPress, customer.id)
          : undefined;
      const planName = enrollment?.planId
        ? await fetchPlanName(pushPress, enrollment.planId)
        : null;
      const facility = extractFacility(customer.role, planName);

      await upsertMember(mailchimp, {
        email: customer.email,
        firstName: customer.name.first,
        lastName: customer.name.last,
        status: statusLabel(customer.role!),
        facility,
      });
      succeeded++;
    } catch (error) {
      failures.push({ email: customer.email, error: String(error) });
    }
  });

  console.log(`Synced ${succeeded}/${syncable.length} contacts to Mailchimp.`);

  if (failures.length > 0) {
    console.error(`${failures.length} contact(s) failed to sync:`);
    for (const failure of failures) {
      console.error(`  ${failure.email}: ${failure.error}`);
    }
  }

  if (syncable.length === 0) {
    return;
  }

  if (succeeded === 0) {
    throw new Error(`Sync failed entirely: 0/${syncable.length} contacts synced`);
  }

  const failureRate = failures.length / syncable.length;
  if (failureRate > FAILURE_RATE_THRESHOLD) {
    throw new Error(
      `${failures.length}/${syncable.length} contacts failed to sync ` +
        `(${(failureRate * 100).toFixed(1)}%), exceeding the ${FAILURE_RATE_THRESHOLD * 100}% threshold`,
    );
  }
}
