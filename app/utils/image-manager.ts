/**
 * 统一的图片加载管理器
 * 功能：
 * - 图片缓存管理
 * - 请求去重（防止重复请求同一图片）
 * - 加载状态管理
 * - 错误处理和重试
 * - 预加载机制
 */

import { CACHE_URL_PREFIX } from "@/app/constant";
import { compressImage } from "./chat";

export interface ImageLoadResult {
  url: string;
  blob?: Blob;
  dataUrl?: string;
  error?: string;
  loading: boolean;
  width?: number;
  height?: number;
}

interface ImageCacheItem {
  url: string;
  dataUrl?: string;
  blob?: Blob;
  loading: boolean;
  error?: string;
  loadPromise?: Promise<ImageLoadResult>;
  timestamp: number;
  width?: number;
  height?: number;
  size?: number;
}

class ImageManager {
  private cache = new Map<string, ImageCacheItem>();
  private loadingPromises = new Map<string, Promise<ImageLoadResult>>();

  // 配置选项
  private readonly maxCacheSize = 100; // 最大缓存数量
  private readonly maxImageSize = 256 * 1024; // 最大图片压缩大小 256KB
  private readonly retryCount = 1; // 减少到1次重试，避免网络压力
  private readonly retryDelay = 1000; // 增加重试延迟，避免网络拥塞

  constructor() {
    // 定期清理超出限制的缓存（但不基于时间过期）
    setInterval(
      () => {
        this.limitCacheSize();
      },
      1000 * 60 * 5,
    ); // 每5分钟清理一次
  }

  /**
   * 加载图片（带缓存和去重）
   */
  async loadImage(
    url: string,
    options?: {
      forceReload?: boolean;
      compress?: boolean;
      preload?: boolean;
    },
  ): Promise<ImageLoadResult> {
    const {
      forceReload = false,
      compress = true,
      preload = false,
    } = options || {};

    // 如果不是强制重新加载，先检查缓存
    if (!forceReload) {
      const cached = this.cache.get(url);
      if (cached) {
        // 如果已经有完整的缓存数据，立即返回
        if (cached.dataUrl && !cached.error && !cached.loading) {
          return {
            url,
            dataUrl: cached.dataUrl,
            blob: cached.blob,
            loading: false,
            error: undefined,
            width: cached.width,
            height: cached.height,
          };
        }

        // 如果正在加载，返回加载中的Promise
        if (cached.loading && cached.loadPromise) {
          return cached.loadPromise;
        }
      }
    }

    // 双重检查锁定模式，确保并发时不会重复请求
    let loadingPromise = this.loadingPromises.get(url);
    if (loadingPromise) {
      return loadingPromise;
    }

    // 再次检查缓存，避免竞争条件
    const cachedAgain = this.cache.get(url);
    if (
      cachedAgain &&
      cachedAgain.dataUrl &&
      !cachedAgain.error &&
      !forceReload
    ) {
      return {
        url,
        dataUrl: cachedAgain.dataUrl,
        blob: cachedAgain.blob,
        loading: false,
        error: undefined,
        width: cachedAgain.width,
        height: cachedAgain.height,
      };
    }

    // 创建加载Promise并立即存储
    loadingPromise = this.doLoadImage(url, compress, preload);
    this.loadingPromises.set(url, loadingPromise);

    // 更新缓存状态为加载中
    this.cache.set(url, {
      url,
      loading: true,
      loadPromise: loadingPromise,
      timestamp: Date.now(),
    });

    try {
      const result = await loadingPromise;

      // 更新缓存
      this.cache.set(url, {
        url,
        dataUrl: result.dataUrl,
        blob: result.blob,
        loading: false,
        error: result.error,
        timestamp: Date.now(),
        width: result.width,
        height: result.height,
        size: result.blob?.size,
      });

      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";

      // 更新缓存错误状态
      this.cache.set(url, {
        url,
        loading: false,
        error: errorMsg,
        timestamp: Date.now(),
      });

      return {
        url,
        loading: false,
        error: errorMsg,
      };
    } finally {
      // 清理加载Promise
      this.loadingPromises.delete(url);

      // 限制缓存大小
      this.limitCacheSize();
    }
  }

  /**
   * 实际加载图片的方法
   */
  private async doLoadImage(
    url: string,
    compress: boolean,
    preload: boolean,
  ): Promise<ImageLoadResult> {
    let attempt = 0;

    while (attempt < this.retryCount) {
      try {
        // 根据URL类型决定如何处理
        const isCacheUrl = url.includes(CACHE_URL_PREFIX);
        // 视为同源路径：绝对同源或以 "/" 开头的相对路径
        const isLocalUrl =
          url.startsWith(window.location.origin) || url.startsWith("/");
        const isDataUrl = url.startsWith("data:image/");
        const isBlobUrl = url.startsWith("blob:");
        const isFileUrl = url.startsWith("file:");

        // 如果是本地图片（base64、blob、file，或同源非缓存URL），直接处理，不走网络请求
        // 注意：/api/cache/* 需要优先通过 CacheStorage 命中，不能走这里
        if (
          isDataUrl ||
          isBlobUrl ||
          isFileUrl ||
          (isLocalUrl && !isCacheUrl)
        ) {
          try {
            const response = await fetch(url);
            const blob = await response.blob();

            let dataUrl: string;
            if (compress && blob.size > 256 * 1024) {
              // 使用压缩函数，直接返回dataUrl
              dataUrl = await compressImage(blob, 256 * 1024);
            } else {
              dataUrl = await this.blobToDataUrl(blob);
            }

            const dimensions = await this.getImageDimensions(blob);

            return {
              url,
              dataUrl,
              blob: blob, // 保持原始blob
              loading: false,
              error: undefined,
              width: dimensions.width,
              height: dimensions.height,
            };
          } catch (error) {
            throw error;
          }
        }

        let fetchUrl = url;
        let fetchOptions: RequestInit = {
          method: "GET",
          signal: AbortSignal.timeout(5000), // 减少到5秒超时，快速失败
        };

        if (isCacheUrl) {
          // 优先从 CacheStorage 直接读取，避免在 SW 未接管时产生 404
          try {
            if (typeof caches !== "undefined") {
              // 等待 SW 就绪（最多 3s），提高命中率
              if (
                typeof navigator !== "undefined" &&
                navigator.serviceWorker &&
                !navigator.serviceWorker.controller
              ) {
                await Promise.race([
                  navigator.serviceWorker.ready,
                  new Promise((r) => setTimeout(r, 3000)),
                ]);
              }
              const cached = await caches.match(fetchUrl);
              if (cached) {
                const blob = await cached.blob();
                const { width, height } = await this.getImageDimensions(blob);
                const dataUrl =
                  compress && blob.size > this.maxImageSize
                    ? await compressImage(blob, this.maxImageSize)
                    : await this.blobToDataUrl(blob);
                return { url, dataUrl, blob, loading: false, width, height };
              }
            }
          } catch (_) {}
        }

        if (isCacheUrl || isLocalUrl) {
          // 本地缓存或同域请求，直接访问
          fetchOptions.mode = "cors";
          fetchOptions.credentials = "include";
        } else {
          // 外部图片，通过代理访问
          fetchUrl = `/api/images/proxy?url=${encodeURIComponent(url)}`;
          fetchOptions.mode = "cors";
          fetchOptions.credentials = "include";
        }

        const response = await fetch(fetchUrl, fetchOptions);

        if (!response.ok) {
          // 对于 404 的缓存地址，直接失败回退：
          // 1) 如果有 original url（通过 URLSearchParams or 已知前缀），改为原地址重试
          // 2) 否则直接抛错让上层吞掉
          if (response.status === 404 && isCacheUrl) {
            // 如果 /api/cache/xxx.png 这种直接文件名，无法恢复原始 URL，则直接抛错给外层
            throw new Error(`Cache not found: ${response.status}`);
          }
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const blob = await response.blob();

        // 获取图片尺寸
        const { width, height } = await this.getImageDimensions(blob);

        let dataUrl: string;

        if (
          compress &&
          (blob.size > this.maxImageSize || url.includes(CACHE_URL_PREFIX))
        ) {
          // 需要压缩
          dataUrl = await compressImage(blob, this.maxImageSize);
        } else {
          // 直接转换为 data URL
          dataUrl = await this.blobToDataUrl(blob);
        }

        return {
          url,
          dataUrl,
          blob,
          loading: false,
          width,
          height,
        };
      } catch (error) {
        attempt++;

        // 对于缓存404错误，不进行重试
        if (
          error instanceof Error &&
          error.message.includes("Cache not found")
        ) {
          throw error;
        }

        if (attempt < this.retryCount) {
          // 等待后重试
          await new Promise((resolve) =>
            setTimeout(resolve, this.retryDelay * attempt),
          );
        } else {
          // 最后一次尝试失败，抛出错误
          throw error;
        }
      }
    }

    throw new Error("Failed to load image after retries");
  }

  /**
   * 获取图片尺寸
   */
  private getImageDimensions(
    blob: Blob,
  ): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      };
      img.onerror = () => {
        resolve({ width: 0, height: 0 }); // 如果无法获取尺寸，返回默认值
      };
      img.src = URL.createObjectURL(blob);
    });
  }

  /**
   * Blob 转 Data URL
   */
  private blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * 预加载图片列表
   */
  async preloadImages(urls: string[]): Promise<void> {
    const promises = urls.map((url) =>
      this.loadImage(url, { preload: true, compress: true }).catch((error) => {
        return null;
      }),
    );

    await Promise.allSettled(promises);
  }

  /**
   * 获取缓存状态
   */
  getCacheStatus(url: string): ImageLoadResult | null {
    const cached = this.cache.get(url);
    if (!cached) return null;

    return {
      url,
      dataUrl: cached.dataUrl,
      blob: cached.blob,
      loading: cached.loading,
      error: cached.error,
      width: cached.width,
      height: cached.height,
    };
  }

  /**
   * 清除指定图片缓存
   */
  clearCache(url?: string): void {
    if (url) {
      this.cache.delete(url);
      this.loadingPromises.delete(url);
    } else {
      this.cache.clear();
      this.loadingPromises.clear();
    }
  }

  /**
   * 限制缓存大小
   */
  private limitCacheSize(): void {
    if (this.cache.size <= this.maxCacheSize) return;

    // 按时间戳排序，删除最旧的缓存
    const entries = Array.from(this.cache.entries()).sort(
      (a, b) => a[1].timestamp - b[1].timestamp,
    );

    const deleteCount = this.cache.size - this.maxCacheSize;
    for (let i = 0; i < deleteCount; i++) {
      this.cache.delete(entries[i][0]);
    }
  }

  /**
   * 获取缓存统计信息
   */
  getCacheStats() {
    const totalSize = Array.from(this.cache.values()).reduce(
      (sum, item) => sum + (item.size || 0),
      0,
    );

    const loadingCount = Array.from(this.cache.values()).filter(
      (item) => item.loading,
    ).length;

    const errorCount = Array.from(this.cache.values()).filter(
      (item) => item.error,
    ).length;

    return {
      totalCount: this.cache.size,
      totalSize,
      loadingCount,
      errorCount,
      maxCacheSize: this.maxCacheSize,
    };
  }

  getAllCachedImages() {
    return Array.from(this.cache.values())
      .filter((item) => item.dataUrl && !item.error)
      .sort((a, b) => b.timestamp - a.timestamp); // 按时间倒序排列
  }
}

// 全局单例
export const imageManager = new ImageManager();

// 兼容性API，保持与原有代码的兼容
export function cacheImageToBase64Image(imageUrl: string): Promise<string> {
  return imageManager.loadImage(imageUrl, { compress: true }).then((result) => {
    if (result.error) {
      throw new Error(result.error);
    }
    return result.dataUrl || imageUrl;
  });
}
