/**
 * 优化的图片组件
 * 使用统一的图片管理器，支持缓存、去重、加载状态等
 */

import React, {
  useState,
  useRef,
  CSSProperties,
  ImgHTMLAttributes,
} from "react";
import { useImage } from "../utils/use-image";
import LoadingIcon from "../icons/loading.svg";
import styles from "./optimized-image.module.scss";

interface OptimizedImageProps
  extends Omit<
    ImgHTMLAttributes<HTMLImageElement>,
    "src" | "onLoad" | "onError" | "onClick"
  > {
  /** 图片URL */
  src: string;
  /** 备用图片URL */
  fallbackSrc?: string;
  /** 占位符内容 */
  placeholder?: React.ReactNode;
  /** 是否显示加载状态 */
  showLoading?: boolean;
  /** 是否启用懒加载 */
  lazy?: boolean;
  /** 是否压缩图片 */
  compress?: boolean;
  /** 点击回调 */
  onClick?: (src: string, event: React.MouseEvent<HTMLImageElement>) => void;
  /** 加载完成回调 */
  onLoad?: (src: string, width?: number, height?: number) => void;
  /** 加载错误回调 */
  onError?: (src: string, error: string) => void;
  /** 容器样式 */
  containerStyle?: CSSProperties;
  /** 容器类名 */
  containerClassName?: string;
}

export function OptimizedImage({
  src,
  fallbackSrc,
  placeholder,
  showLoading = true,
  lazy = true,
  compress = true,
  onClick,
  onLoad,
  onError,
  containerStyle,
  containerClassName,
  style,
  className,
  alt = "",
  ...imgProps
}: OptimizedImageProps) {
  const [isInView, setIsInView] = useState(!lazy);
  const [useFallback, setUseFallback] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // 使用实际的src或备用src
  const actualSrc = useFallback && fallbackSrc ? fallbackSrc : src;

  // 检查是否为本地图片（base64、blob、file、缓存URL等）
  const isLocalImage =
    actualSrc?.startsWith("data:") ||
    actualSrc?.startsWith("blob:") ||
    actualSrc?.startsWith("file:") ||
    actualSrc?.includes("/api/cache/") ||
    actualSrc?.startsWith(window.location.origin);

  const {
    dataUrl,
    loading,
    error,
    width: imgWidth,
    height: imgHeight,
  } = useImage(isInView ? actualSrc : undefined, {
    compress: isLocalImage ? false : compress, // 本地图片不压缩
    onLoad: (result) => {
      onLoad?.(actualSrc, result.width, result.height);
    },
    onError: (errorMsg) => {
      // 如果主图片失败且有备用图片，尝试备用图片
      if (!useFallback && fallbackSrc) {
        setUseFallback(true);
      } else {
        onError?.(actualSrc, errorMsg);
      }
    },
  });

  // 懒加载的Intersection Observer
  React.useEffect(() => {
    // 本地图片不需要懒加载，直接显示
    if (isLocalImage) {
      setIsInView(true);
      return;
    }

    if (!lazy || isInView) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry.isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      {
        threshold: 0.1,
        rootMargin: "50px",
      },
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, [lazy, isInView, isLocalImage]);

  const handleClick = (event: React.MouseEvent<HTMLImageElement>) => {
    onClick?.(actualSrc, event);
  };

  const renderContent = () => {
    // 本地图片直接显示，不需要懒加载和加载状态
    if (isLocalImage && actualSrc) {
      return (
        <img
          ref={imgRef}
          src={actualSrc}
          alt={alt}
          className={className}
          style={style}
          onClick={handleClick}
          loading="eager"
          {...imgProps}
        />
      );
    }

    // 如果还没有进入视口且启用了懒加载，显示占位符
    if (!isInView && lazy) {
      return (
        <div className={styles.placeholder}>
          {placeholder || <div className={styles.placeholderDefault} />}
        </div>
      );
    }

    // 如果正在加载
    if (loading) {
      return (
        <div className={styles.loading}>
          {showLoading && (
            <div className={styles.loadingIndicator}>
              <LoadingIcon />
            </div>
          )}
          {placeholder}
        </div>
      );
    }

    // 如果加载失败
    if (error) {
      return (
        <div className={styles.error}>
          <div className={styles.errorMessage}>{alt || "图片加载失败"}</div>
        </div>
      );
    }

    // 加载成功，显示图片
    if (dataUrl) {
      return (
        <img
          ref={imgRef}
          src={dataUrl}
          alt={alt}
          className={className}
          style={style}
          onClick={handleClick}
          {...imgProps}
        />
      );
    }

    // 默认占位符
    return (
      <div className={styles.placeholder}>
        {placeholder || <div className={styles.placeholderDefault} />}
      </div>
    );
  };

  return (
    <div
      ref={containerRef}
      className={`${styles.container} ${containerClassName || ""}`}
      style={containerStyle}
    >
      {renderContent()}
    </div>
  );
}

/**
 * 多图片网格组件
 */
interface OptimizedImageGridProps {
  images: string[];
  columns?: number;
  gap?: number;
  onImageClick?: (src: string, index: number) => void;
  imageProps?: Partial<OptimizedImageProps>;
  className?: string;
  style?: CSSProperties;
}

export function OptimizedImageGrid({
  images,
  columns = 3,
  gap = 10,
  onImageClick,
  imageProps = {},
  className,
  style,
}: OptimizedImageGridProps) {
  const gridStyle: CSSProperties = {
    display: "grid",
    gridTemplateColumns: `repeat(${columns}, 1fr)`,
    gap: `${gap}px`,
    ...style,
  };

  return (
    <div className={`${styles.grid} ${className || ""}`} style={gridStyle}>
      {images.map((src, index) => (
        <OptimizedImage
          key={src}
          src={src}
          {...imageProps}
          onClick={(imageSrc, event) => {
            onImageClick?.(imageSrc, index);
            imageProps.onClick?.(imageSrc, event);
          }}
        />
      ))}
    </div>
  );
}
