import React, {
  useState,
  useRef,
  useEffect,
  useMemo,
  CSSProperties,
  ImgHTMLAttributes,
} from "react";
import { useImage } from "../utils/use-image"; // 假设 useImage 钩子已按要求更新
import { imageManager } from "../utils/image-manager";
import LoadingIcon from "../icons/loading.svg"; // 您的加载图标
import styles from "./optimized-image.module.scss"; // 您的样式文件

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
  /** 是否为容器锁定宽高比，默认 false（不锁定，避免占位过大） */
  lockAspectRatio?: boolean;
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
  lockAspectRatio = false,
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

  const actualSrc = useFallback && fallbackSrc ? fallbackSrc : src;

  const isLocalImage =
    actualSrc?.startsWith("data:") ||
    actualSrc?.startsWith("blob:") ||
    actualSrc?.startsWith("file:") ||
    actualSrc?.includes("/api/cache/") ||
    (typeof window !== "undefined" &&
      actualSrc?.startsWith(window.location.origin));

  // 1. 从 useImage 获取 blob, width, height 等信息
  const hasCached = useMemo(() => {
    if (!actualSrc) return false;
    try {
      const cached = imageManager.getCacheStatus(actualSrc);
      return !!(cached && (cached.dataUrl || cached.blob));
    } catch (_) {
      return false;
    }
  }, [actualSrc]);

  const {
    blob, // 直接获取 blob 对象
    loading,
    error,
    width: imgWidth,
    height: imgHeight,
  } = useImage(actualSrc, {
    enabled: isInView || hasCached, // 视口外但已缓存时也启用，避免闪烁
    compress: isLocalImage ? false : compress,
    onLoad: (result) => {
      onLoad?.(actualSrc, result.width, result.height);
    },
    onError: (errorMsg) => {
      if (!useFallback && fallbackSrc) {
        setUseFallback(true);
      } else {
        onError?.(actualSrc, errorMsg);
      }
    },
  });

  // 2. 使用 useMemo 从 blob 高效创建 object URL
  const imageObjectURL = useMemo(() => {
    if (!blob) return undefined;
    return URL.createObjectURL(blob);
  }, [blob]);

  // 3. 在组件卸载或 URL 变更时，清理内存
  useEffect(() => {
    return () => {
      if (imageObjectURL) {
        URL.revokeObjectURL(imageObjectURL);
      }
    };
  }, [imageObjectURL]);

  // 懒加载的 Intersection Observer (逻辑不变)
  useEffect(() => {
    if (isLocalImage) {
      setIsInView(true);
      return;
    }
    if (!lazy || isInView) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1, rootMargin: "50px" },
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    return () => observer.disconnect();
  }, [lazy, isInView, isLocalImage]);

  const handleClick = (event: React.MouseEvent<HTMLImageElement>) => {
    onClick?.(actualSrc, event);
  };

  // 4. 动态计算容器样式，防止布局位移 (CLS)
  const dynamicContainerStyle: CSSProperties = { ...containerStyle };
  if (lockAspectRatio && imgWidth && imgHeight && imgHeight > 0) {
    dynamicContainerStyle.aspectRatio = `${imgWidth} / ${imgHeight}`;
  } else if (lockAspectRatio && loading) {
    // 可选：在加载时给一个默认的宽高比，比如 1/1 (方形)
    // dynamicContainerStyle.aspectRatio = "1 / 1";
  }

  const renderContent = () => {
    if (!isInView && lazy) {
      return placeholder || <div className={styles.placeholderDefault} />;
    }

    if (loading) {
      return (
        <>
          {showLoading && (
            <div className={styles.loadingIndicator}>
              <LoadingIcon />
            </div>
          )}
          {placeholder}
        </>
      );
    }

    if (error) {
      return (
        <div className={styles.error}>
          <div className={styles.errorMessage}>{alt || "图片加载失败"}</div>
        </div>
      );
    }

    // 5. 使用 imageObjectURL 渲染图片
    if (imageObjectURL) {
      return (
        <img
          src={imageObjectURL}
          alt={alt}
          className={className}
          style={style}
          onClick={handleClick}
          loading={lazy ? "lazy" : "eager"}
          decoding="async"
          fetchPriority={(lazy ? "low" : "high") as "auto" | "low" | "high"}
          {...imgProps}
        />
      );
    }

    return placeholder || <div className={styles.placeholderDefault} />;
  };

  return (
    <div
      ref={containerRef}
      className={`${styles.container} ${containerClassName || ""}`}
      style={dynamicContainerStyle} // 应用动态样式
    >
      {renderContent()}
    </div>
  );
}

export interface OptimizedImageGridProps {
  /** 图片数组 */
  images: string[];
  /** 列数，默认 3 */
  columns?: number;
  /** 间距，px，默认 8 */
  gap?: number;
  /** 容器 className */
  className?: string;
  /** 容器样式 */
  style?: CSSProperties;
  /** 传递给单个图片的属性（除 src/onClick/onLoad/onError 外） */
  imageProps?: Omit<
    OptimizedImageProps,
    "src" | "onClick" | "onLoad" | "onError"
  >;
  /** 图片点击回调 */
  onImageClick?: (src: string, index: number) => void;
}

export function OptimizedImageGrid({
  images,
  columns = 3,
  gap = 8,
  className,
  style,
  imageProps,
  onImageClick,
}: OptimizedImageGridProps) {
  const gridStyle: CSSProperties = {
    display: "grid",
    gridTemplateColumns: `repeat(${Math.max(1, columns)}, 1fr)`,
    gap,
    ...style,
  };

  return (
    <div className={className} style={gridStyle}>
      {images.map((src, index) => (
        <OptimizedImage
          key={`${src}-${index}`}
          src={src}
          onClick={() => onImageClick?.(src, index)}
          {...imageProps}
        />
      ))}
    </div>
  );
}
