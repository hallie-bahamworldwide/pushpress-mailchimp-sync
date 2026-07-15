import { runWithConcurrency } from "./concurrency.js";
import { extractFacility, isSyncable } from "./mapping.js";
import { createMailchimpConfig, upsertMember } from "./mailchimp.js";
import {
  createPushPressClient,
  fetchAllCustomers,
  fetchPlanName,
  fetchRelevantEnrollment,
} from "./pushpress.js";

const CONCURRENCY = 5;

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
        status: customer.role!,
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
    throw new Error(`${failures.length} contact(s) failed to sync`);
  }
}
