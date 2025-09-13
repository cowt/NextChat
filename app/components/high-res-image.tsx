/**
 * 高分辨率图片组件
 * 支持渐进式加载：缩略图 -> 高清图
 */

import React, { useState, useEffect, useRef } from "react";
import { imageManager } from "../utils/image-manager";
import styles from "./high-res-image.module.scss";

// 1x1 transparent placeholder，避免无缩略图时触发原图加载
const PLACEHOLDER_SRC =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

interface HighResImageProps {
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
}

export function HighResImage({
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
}: HighResImageProps) {
  const [currentSrc, setCurrentSrc] = useState(thumbnail || PLACEHOLDER_SRC);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [highResLoaded, setHighResLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const preloadRef = useRef<HTMLImageElement | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 预加载高分辨率图片 - 只在预览模式下加载
  useEffect(() => {
    // 清理之前的超时
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    if (previewMode) {
      // 预览模式下，加载高清图
      const preloadHighRes = () => {
        preloadRef.current = new Image();
        preloadRef.current.onload = () => {
          setCurrentSrc(src);
          setHighResLoaded(true);
          onLoad?.();
        };
        preloadRef.current.onerror = () => {
          console.warn(`高清图片加载失败，保持使用缩略图: ${src}`);
          setHighResLoaded(true);
          onError?.(new Error("High resolution image failed to load"));
        };
        preloadRef.current.crossOrigin = "anonymous";
        preloadRef.current.src = src;
      };

      // 延迟加载，避免阻塞缩略图显示
      setTimeout(preloadHighRes, 100);
    } else {
      // 非预览模式下：优先显示缩略图；无缩略图时异步生成低清占位，避免白块
      setCurrentSrc(thumbnail || PLACEHOLDER_SRC);
      setHighResLoaded(false);
      if (!thumbnail && src) {
        let cancelled = false;
        imageManager
          .loadImage(src, { compress: true, forceReload: false })
          .then((res) => {
            if (!cancelled && res?.dataUrl) {
              setCurrentSrc(res.dataUrl);
            }
          })
          .catch(() => {});
        return () => {
          cancelled = true;
        };
      }
    }

    // 清理函数
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [src, thumbnail, previewMode, onLoad, onError]);

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

  return (
    <div className={`${styles.imageContainer} ${className}`}>
      <img
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
        // 移动端优化：添加crossOrigin属性
        crossOrigin={currentSrc?.startsWith("data:") ? undefined : "anonymous"}
      />

      {/* 加载指示器 */}
      {isLoading && (
        <div className={styles.loadingOverlay}>
          <div className={styles.loadingSpinner} />
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
    </div>
  );
}

export default HighResImage;
