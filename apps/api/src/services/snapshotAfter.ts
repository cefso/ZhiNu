import { createPortraitVersion, type VersionReason } from './versions.js';

/** Best-effort portrait snapshot after a mutation. Swallows errors so main op still succeeds. */
export async function snapshotAfter(
  customerId: string,
  message: string,
  reason: VersionReason,
  createdBy: string,
) {
  if (!customerId) return;
  try {
    await createPortraitVersion({ customerId, message, reason, createdBy });
  } catch {
    // ignore snapshot failures; live data already committed
  }
}
