/**
 * 图片缓存优化配置
 * 统一管理图片加载和缓存的配置参数
 */

export interface ImageCacheConfig {
  // 队列管理器配置
  queue: {
    maxConcurrent: number;
    requestDelay: number;
    maxQueueSize: number;
    maxRetries: number;
    retryDelay: number;
  };

  // 缓存配置
  cache: {
    maxSize: number; // 最大缓存数量
    ttl: number; // 缓存生存时间（毫秒）
    cleanupInterval: number; // 清理间隔（毫秒）
  };

  // 网络自适应配置
  network: {
    slowNetworkThreshold: number; // 慢网络阈值（毫秒）
    mediumNetworkThreshold: number; // 中等网络阈值（毫秒）
    adaptiveDelayMultiplier: {
      slow: number;
      medium: number;
      fast: number;
    };
  };

  // 预加载配置
  preload: {
    enabled: boolean;
    maxPreloadSize: number; // 预加载最大文件大小（字节）
    neighborCount: number; // 邻近图片预加载数量
  };
}

// 默认配置
export const DEFAULT_IMAGE_CACHE_CONFIG: ImageCacheConfig = {
  queue: {
    maxConcurrent: 2, // 降低并发数，减少服务器压力
    requestDelay: 300, // 增加请求间隔
    maxQueueSize: 50, // 减少队列大小
    maxRetries: 2,
    retryDelay: 1000,
  },

  cache: {
    maxSize: 200, // 最多缓存200张图片
    ttl: 30 * 60 * 1000, // 30分钟TTL
    cleanupInterval: 5 * 60 * 1000, // 5分钟清理一次
  },

  network: {
    slowNetworkThreshold: 3000, // 3秒以上为慢网络
    mediumNetworkThreshold: 1500, // 1.5秒以上为中等网络
    adaptiveDelayMultiplier: {
      slow: 2.0, // 慢网络时延迟加倍
      medium: 1.5, // 中等网络时延迟增加50%
      fast: 1.0, // 快网络时正常延迟
    },
  },

  preload: {
    enabled: true,
    maxPreloadSize: 5 * 1024 * 1024, // 5MB
    neighborCount: 3, // 预加载前后3张图片
  },
};

// 移动端优化配置
export const MOBILE_IMAGE_CACHE_CONFIG: ImageCacheConfig = {
  ...DEFAULT_IMAGE_CACHE_CONFIG,
  queue: {
    ...DEFAULT_IMAGE_CACHE_CONFIG.queue,
    maxConcurrent: 1, // 移动端进一步降低并发
    requestDelay: 500, // 增加延迟
    maxQueueSize: 30, // 减少队列大小
  },

  cache: {
    ...DEFAULT_IMAGE_CACHE_CONFIG.cache,
    maxSize: 100, // 移动端减少缓存数量
    ttl: 15 * 60 * 1000, // 15分钟TTL
  },

  preload: {
    ...DEFAULT_IMAGE_CACHE_CONFIG.preload,
    maxPreloadSize: 2 * 1024 * 1024, // 2MB
    neighborCount: 2, // 减少预加载数量
  },
};

// 高性能配置（用于高带宽环境）
export const HIGH_PERFORMANCE_CONFIG: ImageCacheConfig = {
  ...DEFAULT_IMAGE_CACHE_CONFIG,
  queue: {
    ...DEFAULT_IMAGE_CACHE_CONFIG.queue,
    maxConcurrent: 4, // 增加并发数
    requestDelay: 100, // 减少延迟
    maxQueueSize: 100, // 增加队列大小
  },

  cache: {
    ...DEFAULT_IMAGE_CACHE_CONFIG.cache,
    maxSize: 500, // 增加缓存数量
    ttl: 60 * 60 * 1000, // 1小时TTL
  },

  preload: {
    ...DEFAULT_IMAGE_CACHE_CONFIG.preload,
    maxPreloadSize: 10 * 1024 * 1024, // 10MB
    neighborCount: 5, // 增加预加载数量
  },
};

/**
 * 根据环境自动选择配置
 */
export function getOptimalConfig(): ImageCacheConfig {
  if (typeof window === "undefined") {
    return DEFAULT_IMAGE_CACHE_CONFIG;
  }

  // 检测移动端
  const isMobile =
    window.innerWidth <= 768 ||
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent,
    );

  if (isMobile) {
    return MOBILE_IMAGE_CACHE_CONFIG;
  }

  // 检测网络状况
  const connection = (navigator as any).connection;
  if (connection) {
    const effectiveType = connection.effectiveType;
    if (effectiveType === "slow-2g" || effectiveType === "2g") {
      return MOBILE_IMAGE_CACHE_CONFIG; // 慢网络使用移动端配置
    } else if (effectiveType === "4g" && connection.downlink > 10) {
      return HIGH_PERFORMANCE_CONFIG; // 高速网络使用高性能配置
    }
  }

  return DEFAULT_IMAGE_CACHE_CONFIG;
}

/**
 * 应用配置到图片队列管理器
 */
export function applyConfigToQueueManager(config: ImageCacheConfig) {
  // 动态导入避免循环依赖
  import("./image-queue-manager").then(({ imageQueueManager }) => {
    imageQueueManager.setConfig({
      maxConcurrent: config.queue.maxConcurrent,
      requestDelay: config.queue.requestDelay,
      maxQueueSize: config.queue.maxQueueSize,
    });
  });
}

/**
 * 初始化图片缓存配置
 */
export function initializeImageCacheConfig() {
  const config = getOptimalConfig();
  applyConfigToQueueManager(config);

  console.log("[ImageCache] 配置已应用:", {
    maxConcurrent: config.queue.maxConcurrent,
    requestDelay: config.queue.requestDelay,
    maxQueueSize: config.queue.maxQueueSize,
    isMobile: config === MOBILE_IMAGE_CACHE_CONFIG,
  });

  return config;
}
