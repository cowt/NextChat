/**
 * 队列图片组件
 * 基于队列管理器的高分辨率图片组件
 * 解决大批量请求被服务端拒绝的问题
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import Image from "next/image";
import styles from "./high-res-image.module.scss"; // 复用现有样式
import {
  imageQueueManager,
  QueueImageOptions,
} from "../utils/image-queue-manager";
import { ImageLoadResult } from "../utils/image-manager";

interface QueuedImageProps {
  src: string;
  thumbnail?: string;
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
  loading?: "lazy" | "eager";
  onLoad?: () => void;
  onError?: (error: Error) => void;
  quality?: number; // 图片质量 0-1
  maxSize?: { width: number; height: number }; // 最大尺寸
  decoding?: "sync" | "async" | "auto"; // 图片解码方式
  fetchPriority?: "high" | "low" | "auto"; // 获取优先级
  previewMode?: boolean; // 是否为预览模式，预览模式下才加载高清图
  priority?: number; // 队列优先级
  maxRetries?: number; // 最大重试次数
  retryDelay?: number; // 重试延迟
  showQueueStatus?: boolean; // 是否显示队列状态
}

export function QueuedImage({
  src,
  thumbnail,
  alt = "",
  className = "",
  style,
  loading = "lazy",
  onLoad,
  onError,
  quality = 0.9,
  maxSize,
  decoding = "async",
  fetchPriority = "auto",
  previewMode = false,
  priority = 5,
  maxRetries = 2,
  retryDelay = 1000,
  showQueueStatus = false,
}: QueuedImageProps) {
  const [currentSrc, setCurrentSrc] = useState(thumbnail || src);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [highResLoaded, setHighResLoaded] = useState(false);
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  const [loadProgress, setLoadProgress] = useState(0);

  const imgRef = useRef<HTMLImageElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const loadAbortRef = useRef<AbortController | null>(null);

  // 计算优化后的图片尺寸
  const getOptimizedStyle = (): React.CSSProperties => {
    if (!maxSize) return style || {};

    return {
      ...style,
      maxWidth: maxSize.width,
      maxHeight: maxSize.height,
      objectFit: "cover",
    };
  };

  // 加载高分辨率图片
  const loadHighResImage = useCallback(async () => {
    if (!thumbnail || thumbnail === src) {
      setHighResLoaded(true);
      return;
    }

    if (!previewMode) {
      // 非预览模式下，只显示缩略图
      setCurrentSrc(thumbnail);
      setHighResLoaded(false);
      return;
    }

    // 预览模式下，使用队列加载高清图
    try {
      setIsLoading(true);
      setHasError(false);
      setLoadProgress(0);

      // 创建中止控制器
      loadAbortRef.current = new AbortController();

      const queueOptions: QueueImageOptions = {
        forceReload: false,
        compress: quality < 1,
        priority,
        maxRetries,
        retryDelay,
        onProgress: (progress) => {
          setLoadProgress(progress);
        },
        onLoad: (result: ImageLoadResult) => {
          if (result.dataUrl) {
            setCurrentSrc(result.dataUrl);
            setHighResLoaded(true);
            setLoadProgress(100);
            onLoad?.();
          }
        },
        onError: (error: string) => {
          console.warn(`高清图片加载失败，保持使用缩略图: ${src}`, error);
          setHasError(true);
          onError?.(new Error(error));
        },
      };

      const result = await imageQueueManager.loadImage(src, queueOptions);

      if (result.dataUrl) {
        setCurrentSrc(result.dataUrl);
        setHighResLoaded(true);
        setLoadProgress(100);
        onLoad?.();
      } else if (result.error) {
        setHasError(true);
        onError?.(new Error(result.error));
      }
    } catch (error) {
      console.warn(`高清图片加载失败，保持使用缩略图: ${src}`, error);
      setHasError(true);
      onError?.(error instanceof Error ? error : new Error("Unknown error"));
    } finally {
      setIsLoading(false);
      loadAbortRef.current = null;
    }
  }, [
    src,
    thumbnail,
    previewMode,
    quality,
    priority,
    maxRetries,
    retryDelay,
    onLoad,
    onError,
  ]);

  // 监听预览模式变化
  useEffect(() => {
    // 清理之前的超时
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    // 中止之前的加载
    if (loadAbortRef.current) {
      loadAbortRef.current.abort();
      loadAbortRef.current = null;
    }

    if (previewMode) {
      // 预览模式下，延迟加载高清图
      timeoutRef.current = setTimeout(() => {
        loadHighResImage();
      }, 100);
    } else {
      // 非预览模式下，只显示缩略图
      setCurrentSrc(thumbnail || src);
      setHighResLoaded(false);
      setIsLoading(false);
    }

    // 清理函数
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      if (loadAbortRef.current) {
        loadAbortRef.current.abort();
        loadAbortRef.current = null;
      }
    };
  }, [previewMode, loadHighResImage, thumbnail, src]);

  // 移动端图片加载超时处理
  useEffect(() => {
    if (!isLoading || !currentSrc) return;

    // 移动端设置更短的超时时间
    const isMobile = typeof window !== "undefined" && window.innerWidth <= 768;
    const timeout = isMobile ? 5000 : 10000; // 移动端5秒，桌面端10秒

    timeoutRef.current = setTimeout(() => {
      if (isLoading) {
        setIsLoading(false);
        setHasError(true);

        // 超时后尝试降级
        if (currentSrc === thumbnail && src) {
          setCurrentSrc(src);
          setHasError(false);
        }
      }
    }, timeout);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [isLoading, currentSrc, thumbnail, src]);

  // 处理图片加载
  const handleLoad = () => {
    setIsLoading(false);
    if (currentSrc === src || !thumbnail) {
      setHighResLoaded(true);
      onLoad?.();
    }
  };

  // 处理图片错误
  const handleError = () => {
    setHasError(true);
    setIsLoading(false);

    if (currentSrc === src && thumbnail) {
      // 高清图失败，降级到缩略图
      setCurrentSrc(thumbnail);
      setHasError(false);
    } else if (currentSrc === thumbnail && src) {
      // 缩略图失败，尝试原图
      setCurrentSrc(src);
      setHasError(false);
    } else {
      onError?.(new Error("Image failed to load"));
    }
  };

  // 获取队列状态
  useEffect(() => {
    if (!showQueueStatus || !previewMode) {
      setQueuePosition(null);
      return;
    }

    const updateQueueStatus = () => {
      const stats = imageQueueManager.getStats();
      // 这里可以根据实际需求计算队列位置
      // 由于队列管理器内部不暴露具体位置，这里只是示例
      setQueuePosition(stats.queueLength);
    };

    updateQueueStatus();
    const interval = setInterval(updateQueueStatus, 500);

    return () => clearInterval(interval);
  }, [showQueueStatus, previewMode]);

  return (
    <div className={`${styles.imageContainer} ${className}`}>
      <Image
        ref={imgRef}
        src={currentSrc}
        alt={alt}
        className={`${styles.image} ${
          highResLoaded ? styles.highRes : styles.thumbnail
        }`}
        style={getOptimizedStyle()}
        loading={loading}
        decoding={decoding}
        fetchPriority={fetchPriority}
        onLoad={handleLoad}
        onError={handleError}
        crossOrigin={currentSrc?.startsWith("data:") ? undefined : "anonymous"}
        width={maxSize?.width || 800}
        height={maxSize?.height || 600}
        quality={quality * 100}
      />

      {/* 加载指示器 */}
      {isLoading && (
        <div className={styles.loadingOverlay}>
          <div className={styles.loadingSpinner} />
          {showQueueStatus && queuePosition !== null && (
            <div className={styles.queueStatus}>队列中: {queuePosition}</div>
          )}
          {loadProgress > 0 && loadProgress < 100 && (
            <div className={styles.progressBar}>
              <div
                className={styles.progressFill}
                style={{ width: `${loadProgress}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* 错误状态 */}
      {hasError && (
        <div className={styles.errorOverlay}>
          <div className={styles.errorIcon}>⚠️</div>
          <div className={styles.errorText}>图片加载失败</div>
        </div>
      )}

      {/* 质量指示器 */}
      {thumbnail && !highResLoaded && !isLoading && (
        <div className={styles.qualityIndicator}>
          <div className={styles.qualityDot} />
        </div>
      )}

      {/* 队列状态指示器 */}
      {showQueueStatus &&
        queuePosition !== null &&
        queuePosition > 0 &&
        !isLoading && (
          <div className={styles.queueIndicator}>
            <div className={styles.queueDot} />
          </div>
        )}
    </div>
  );
}

export default QueuedImage;
