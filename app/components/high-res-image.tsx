/**
 * 高分辨率图片组件
 * 支持渐进式加载：缩略图 -> 高清图
 */

import React, { useState, useEffect, useRef } from "react";
import styles from "./high-res-image.module.scss";

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
}: HighResImageProps) {
  const [currentSrc, setCurrentSrc] = useState(thumbnail || src);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [highResLoaded, setHighResLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const preloadRef = useRef<HTMLImageElement | null>(null);

  // 预加载高分辨率图片
  useEffect(() => {
    if (!thumbnail || thumbnail === src) {
      setHighResLoaded(true);
      return;
    }

    // 当缩略图加载完成且可见时，开始预加载高清图
    if (!isLoading && currentSrc === thumbnail) {
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
        preloadRef.current.src = src;
      };

      // 使用 Intersection Observer 检测图片是否在视口中
      if (imgRef.current && "IntersectionObserver" in window) {
        const observer = new IntersectionObserver(
          (entries) => {
            if (entries[0].isIntersecting) {
              preloadHighRes();
              observer.disconnect();
            }
          },
          { threshold: 0.1 },
        );
        observer.observe(imgRef.current);

        return () => observer.disconnect();
      } else {
        // 降级方案：直接预加载
        setTimeout(preloadHighRes, 100);
      }
    }
  }, [src, thumbnail, currentSrc, isLoading, onLoad, onError]);

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
        onLoad={handleLoad}
        onError={handleError}
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
