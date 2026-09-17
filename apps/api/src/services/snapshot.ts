import { createPortraitVersion, type VersionReason } from './versions.js';

/** 打一个画像版本快照；失败不阻断主流程（已返回业务结果后） */
export async function snapshotAfter(
  customerId: string,
  message: string,
  reason: VersionReason,
  createdBy: string,
) {
  try {
    return await createPortraitVersion({ customerId, message, reason, createdBy });
  } catch {
    return null;
  }
}
