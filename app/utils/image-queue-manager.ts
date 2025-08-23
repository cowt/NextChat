/**
 * 图片加载队列管理器
 * 解决大批量图片请求被服务端拒绝的问题
 * 功能：
 * - 并发控制：限制同时加载的图片数量
 * - 请求间隔：每个请求之间添加延迟
 * - 智能重试：失败后自动重试，使用指数退避
 * - 优先级管理：支持高优先级图片优先加载
 * - 缓存集成：与现有的 imageManager 集成
 */

import { imageManager, ImageLoadResult } from "./image-manager";

export interface QueueImageOptions {
  /** 是否强制重新加载 */
  forceReload?: boolean;
  /** 是否压缩图片 */
  compress?: boolean;
  /** 优先级：数字越小优先级越高 */
  priority?: number;
  /** 最大重试次数 */
  maxRetries?: number;
  /** 重试延迟基数（毫秒） */
  retryDelay?: number;
  /** 加载完成的回调 */
  onLoad?: (result: ImageLoadResult) => void;
  /** 加载出错的回调 */
  onError?: (error: string) => void;
  /** 加载进度回调 */
  onProgress?: (progress: number) => void;
}

interface QueueItem {
  id: string;
  url: string;
  options: QueueImageOptions;
  resolve: (result: ImageLoadResult) => void;
  reject: (error: string) => void;
  retryCount: number;
  timestamp: number;
}

interface QueueStats {
  totalQueued: number;
  totalLoaded: number;
  totalFailed: number;
  currentlyLoading: number;
  queueLength: number;
  averageLoadTime: number;
}

class ImageQueueManager {
  private queue: QueueItem[] = [];
  private loadingItems = new Set<string>();
  private stats = {
    totalQueued: 0,
    totalLoaded: 0,
    totalFailed: 0,
    loadTimes: [] as number[],
  };

  // 配置选项
  private maxConcurrent = 3; // 最大并发数
  private requestDelay = 200; // 请求间隔（毫秒）
  private readonly defaultMaxRetries = 2;
  private readonly defaultRetryDelay = 1000;
  private maxQueueSize = 100; // 最大队列长度

  private isProcessing = false;
  private processingTimer: NodeJS.Timeout | null = null;

  constructor() {
    // 启动队列处理器
    this.startProcessing();
  }

  /**
   * 添加图片到加载队列
   */
  async loadImage(
    url: string,
    options: QueueImageOptions = {},
  ): Promise<ImageLoadResult> {
    const {
      forceReload = false,
      compress = true,
      priority = 5,
      maxRetries = this.defaultMaxRetries,
      retryDelay = this.defaultRetryDelay,
    } = options;

    // 生成唯一ID
    const id = `${url}-${Date.now()}-${Math.random()}`;

    // 检查队列是否已满
    if (this.queue.length >= this.maxQueueSize) {
      throw new Error("图片加载队列已满，请稍后重试");
    }

    // 检查是否已经在加载中
    if (this.loadingItems.has(url)) {
      // 如果正在加载，等待现有请求完成
      return this.waitForExistingLoad(url);
    }

    // 检查缓存
    const cached = imageManager.getCacheStatus(url);
    if (cached && cached.dataUrl && !cached.error && !forceReload) {
      this.stats.totalLoaded++;
      return cached;
    }

    return new Promise<ImageLoadResult>((resolve, reject) => {
      const queueItem: QueueItem = {
        id,
        url,
        options: {
          ...options,
          maxRetries,
          retryDelay,
        },
        resolve,
        reject,
        retryCount: 0,
        timestamp: Date.now(),
      };

      // 按优先级插入队列
      this.insertByPriority(queueItem, priority);
      this.stats.totalQueued++;

      // 触发队列处理
      this.triggerProcessing();
    });
  }

  /**
   * 等待现有加载完成
   */
  private async waitForExistingLoad(url: string): Promise<ImageLoadResult> {
    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        const cached = imageManager.getCacheStatus(url);
        if (cached && !cached.loading) {
          clearInterval(checkInterval);
          if (cached.error) {
            reject(cached.error);
          } else {
            resolve(cached);
          }
        }
      }, 100);

      // 设置超时
      setTimeout(() => {
        clearInterval(checkInterval);
        reject(new Error("等待现有加载超时"));
      }, 10000);
    });
  }

  /**
   * 按优先级插入队列
   */
  private insertByPriority(item: QueueItem, priority: number) {
    const insertIndex = this.queue.findIndex(
      (queueItem) => (queueItem.options.priority || 5) > priority,
    );

    if (insertIndex === -1) {
      this.queue.push(item);
    } else {
      this.queue.splice(insertIndex, 0, item);
    }
  }

  /**
   * 触发队列处理
   */
  private triggerProcessing() {
    if (!this.isProcessing) {
      this.startProcessing();
    }
  }

  /**
   * 启动队列处理器
   */
  private startProcessing() {
    if (this.isProcessing) return;

    this.isProcessing = true;
    this.processQueue();
  }

  /**
   * 处理队列
   */
  private async processQueue() {
    while (
      this.queue.length > 0 &&
      this.loadingItems.size < this.maxConcurrent
    ) {
      const item = this.queue.shift();
      if (!item) break;

      // 开始加载
      this.loadingItems.add(item.url);
      this.processItem(item);
    }

    this.isProcessing = false;
  }

  /**
   * 处理单个队列项
   */
  private async processItem(item: QueueItem) {
    const startTime = Date.now();

    try {
      // 添加请求延迟
      if (this.requestDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.requestDelay));
      }

      // 使用 imageManager 加载图片
      const result = await imageManager.loadImage(item.url, {
        forceReload: item.options.forceReload,
        compress: item.options.compress,
      });

      // 记录加载时间
      const loadTime = Date.now() - startTime;
      this.stats.loadTimes.push(loadTime);
      if (this.stats.loadTimes.length > 100) {
        this.stats.loadTimes.shift();
      }

      this.stats.totalLoaded++;
      item.resolve(result);

      // 调用回调
      item.options.onLoad?.(result);
      item.options.onProgress?.(100);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";

      // 重试逻辑
      if (
        item.retryCount < (item.options.maxRetries || this.defaultMaxRetries)
      ) {
        item.retryCount++;
        const delay =
          (item.options.retryDelay || this.defaultRetryDelay) *
          Math.pow(2, item.retryCount - 1);

        console.warn(
          `图片加载失败，${delay}ms 后重试 (${item.retryCount}/${item.options.maxRetries}): ${item.url}`,
        );

        // 重新加入队列
        setTimeout(() => {
          this.insertByPriority(item, item.options.priority || 5);
          this.triggerProcessing();
        }, delay);

        return;
      }

      // 重试次数用完，记录失败
      this.stats.totalFailed++;
      item.reject(errorMsg);
      item.options.onError?.(errorMsg);
    } finally {
      // 从加载中移除
      this.loadingItems.delete(item.url);

      // 继续处理队列
      setTimeout(() => {
        this.processQueue();
      }, 50);
    }
  }

  /**
   * 批量加载图片
   */
  async loadImages(
    urls: string[],
    options: QueueImageOptions = {},
  ): Promise<ImageLoadResult[]> {
    const promises = urls.map((url, index) =>
      this.loadImage(url, {
        ...options,
        priority: (options.priority || 5) + index, // 按顺序设置优先级
      }),
    );

    return Promise.allSettled(promises).then((results) =>
      results.map((result) =>
        result.status === "fulfilled"
          ? result.value
          : {
              url: "",
              loading: false,
              error: result.reason,
            },
      ),
    );
  }

  /**
   * 预加载图片（低优先级）
   */
  async preloadImages(urls: string[]): Promise<void> {
    const promises = urls.map((url) =>
      this.loadImage(url, {
        priority: 10, // 低优先级
        compress: true,
        maxRetries: 1, // 预加载减少重试次数
      }).catch(() => {
        // 预加载失败静默处理
      }),
    );

    await Promise.allSettled(promises);
  }

  /**
   * 获取队列统计信息
   */
  getStats(): QueueStats {
    const averageLoadTime =
      this.stats.loadTimes.length > 0
        ? this.stats.loadTimes.reduce((sum, time) => sum + time, 0) /
          this.stats.loadTimes.length
        : 0;

    return {
      totalQueued: this.stats.totalQueued,
      totalLoaded: this.stats.totalLoaded,
      totalFailed: this.stats.totalFailed,
      currentlyLoading: this.loadingItems.size,
      queueLength: this.queue.length,
      averageLoadTime: Math.round(averageLoadTime),
    };
  }

  /**
   * 清空队列
   */
  clearQueue(): void {
    this.queue.forEach((item) => {
      item.reject("队列已清空");
    });
    this.queue = [];
  }

  /**
   * 暂停队列处理
   */
  pause(): void {
    this.isProcessing = false;
    if (this.processingTimer) {
      clearTimeout(this.processingTimer);
      this.processingTimer = null;
    }
  }

  /**
   * 恢复队列处理
   */
  resume(): void {
    this.startProcessing();
  }

  /**
   * 设置配置
   */
  setConfig(config: {
    maxConcurrent?: number;
    requestDelay?: number;
    maxQueueSize?: number;
  }): void {
    if (config.maxConcurrent !== undefined) {
      this.maxConcurrent = Math.max(1, config.maxConcurrent);
    }
    if (config.requestDelay !== undefined) {
      this.requestDelay = Math.max(0, config.requestDelay);
    }
    if (config.maxQueueSize !== undefined) {
      this.maxQueueSize = Math.max(10, config.maxQueueSize);
    }
  }
}

// 全局单例
export const imageQueueManager = new ImageQueueManager();

// 兼容性API
export function queueLoadImage(
  url: string,
  options?: QueueImageOptions,
): Promise<ImageLoadResult> {
  return imageQueueManager.loadImage(url, options);
}

export function queueLoadImages(
  urls: string[],
  options?: QueueImageOptions,
): Promise<ImageLoadResult[]> {
  return imageQueueManager.loadImages(urls, options);
}
