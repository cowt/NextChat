import { photoStorage } from "./photo-storage";

export type RetryProgress = {
  current: number;
  total: number;
  success: number;
  failed: number;
  skipped?: number;
};

export class PhotoService {
  async runSmartRetry(onProgress?: (p: RetryProgress) => void) {
    const result1 = await photoStorage.smartRetryFailedImages(
      (p) => onProgress?.(p),
    );
    const result2 = await photoStorage.retryMissingThumbnails(
      2,
      100,
      (p) => onProgress?.(p),
    );
    return {
      stage1: result1,
      stage2: result2,
    };
  }

  async runBatchRetry(
    concurrencyImages: number = 2,
    concurrencyThumbs: number = 2,
    onProgress?: (p: RetryProgress) => void,
  ) {
    const result = await photoStorage.retryFailedImages(
      concurrencyImages,
      concurrencyThumbs,
      (p) => onProgress?.(p),
    );
    return result;
  }
}

export const photoService = new PhotoService();
