import React, { useState, useEffect, useCallback, useRef } from "react";
import Image from "next/image";
import { useMobileScreen } from "../utils";
import styles from "./image-viewer.module.scss";
import clsx from "clsx";
import { useImage } from "../utils/use-image";
import { imageQueueManager } from "../utils/image-queue-manager";

import CloseIcon from "../icons/close.svg";
import DownloadIcon from "../icons/download.svg";
import MaxIcon from "../icons/max.svg";
import MinIcon from "../icons/min.svg";
import ResetIcon from "../icons/reload.svg";

export interface ImageViewerProps {
  images: string[];
  initialIndex?: number;
  visible: boolean;
  onClose: () => void;
  className?: string;
  onImageChange?: (index: number) => void; // 图片切换回调
  useQueue?: boolean; // 是否使用队列加载
  showQueueStatus?: boolean; // 是否显示队列状态
}

// 将跨域图片 URL 路由到本地代理，避免 CORS 限制
function getProxiedImageUrl(originalUrl: string): string {
  try {
    if (!originalUrl) return originalUrl;
    if (
      originalUrl.startsWith("/api/images/proxy?") ||
      originalUrl.startsWith("data:") ||
      originalUrl.startsWith("blob:") ||
      originalUrl.startsWith("file:")
    ) {
      return originalUrl;
    }
    const isAbsolute = /^(https?:)?\/\//i.test(originalUrl);
    if (!isAbsolute) return originalUrl;
    const urlObj = new URL(originalUrl);
    if (
      typeof window !== "undefined" &&
      urlObj.origin === window.location.origin
    ) {
      return originalUrl;
    }
    return `/api/images/proxy?url=${encodeURIComponent(originalUrl)}`;
  } catch {
    return originalUrl;
  }
}

export function ImageViewer({
  images,
  initialIndex = 0,
  visible,
  onClose,
  className,
  onImageChange,
  useQueue = false,
  showQueueStatus = false,
}: ImageViewerProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [isLoading, setIsLoading] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const isMobile = useMobileScreen();
  const imageRef = useRef<HTMLImageElement>(null);
  const touchStartX = useRef<number>(0);
  const touchStartY = useRef<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // 缩放与拖拽
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  // 队列加载状态
  const [queueImageDataUrl, setQueueImageDataUrl] = useState<
    string | undefined
  >();
  const [queueImageLoading, setQueueImageLoading] = useState(false);
  const [queueImageError, setQueueImageError] = useState<string | undefined>();
  const [queueImageBlob, setQueueImageBlob] = useState<Blob | undefined>();

  const currentImage = images[currentIndex];
  const hasMultipleImages = images.length > 1;

  // 队列加载当前图片
  useEffect(() => {
    if (!visible || !useQueue || !currentImage) {
      setQueueImageDataUrl(undefined);
      setQueueImageLoading(false);
      setQueueImageError(undefined);
      setQueueImageBlob(undefined);
      return;
    }

    let cancelled = false;

    const loadQueueImage = async () => {
      try {
        setQueueImageLoading(true);
        setQueueImageError(undefined);

        const result = await imageQueueManager.loadImage(currentImage, {
          compress: false,
          priority: 1, // 查看器图片使用高优先级
          maxRetries: 3,
          retryDelay: 1000,
          onLoad: (result) => {
            if (!cancelled) {
              setQueueImageDataUrl(result.dataUrl);
              setQueueImageBlob(result.blob);
              setQueueImageLoading(false);
            }
          },
          onError: (error) => {
            if (!cancelled) {
              setQueueImageError(error);
              setQueueImageLoading(false);
            }
          },
        });

        if (!cancelled && result.dataUrl) {
          setQueueImageDataUrl(result.dataUrl);
          setQueueImageBlob(result.blob);
        }
      } catch (error) {
        if (!cancelled) {
          const errorMsg =
            error instanceof Error ? error.message : "Unknown error";
          setQueueImageError(errorMsg);
        }
      } finally {
        if (!cancelled) {
          setQueueImageLoading(false);
        }
      }
    };

    loadQueueImage();

    return () => {
      cancelled = true;
    };
  }, [visible, useQueue, currentImage]);

  // 预加载下一张图片
  const nextImage = hasMultipleImages
    ? images[(currentIndex + 1) % images.length]
    : undefined;
  const prevImage = hasMultipleImages
    ? images[(currentIndex - 1 + images.length) % images.length]
    : undefined;

  // 队列预加载邻近图片
  useEffect(() => {
    if (!visible || !useQueue || !hasMultipleImages) return;

    // 预加载下一张和上一张图片（低优先级）
    const preloadImages = async () => {
      const imagesToPreload = [];
      if (nextImage) imagesToPreload.push(nextImage);
      if (prevImage) imagesToPreload.push(prevImage);

      if (imagesToPreload.length > 0) {
        await imageQueueManager.preloadImages(imagesToPreload);
      }
    };

    // 延迟预加载，避免阻塞当前图片
    const timer = setTimeout(preloadImages, 500);
    return () => clearTimeout(timer);
  }, [visible, useQueue, hasMultipleImages, nextImage, prevImage]);

  // 使用图片管理器加载当前图片（只在非队列模式且预览时加载高清图片）
  const {
    dataUrl: currentImageDataUrl,
    loading: currentImageLoading,
    error: currentImageError,
    blob: currentImageBlob,
  } = useImage(visible && !useQueue ? currentImage : undefined, {
    compress: false, // 查看器不压缩，保持原图质量
    forceReload: false,
    delay: 0, // 立即加载，不延迟
    enabled: visible && !useQueue, // 只在可见且非队列模式时加载
  });

  // 启用邻近预加载，提升浏览体验（只在非队列模式且预览时）
  useImage(visible && !useQueue && nextImage ? nextImage : undefined, {
    compress: false,
    forceReload: false,
    delay: 100, // 延迟100ms预加载，避免阻塞当前图片
    enabled: visible && !useQueue, // 只在非队列模式且预览时预加载
  });

  useImage(visible && !useQueue && prevImage ? prevImage : undefined, {
    compress: false,
    forceReload: false,
    delay: 200, // 延迟200ms预加载上一张
    enabled: visible && !useQueue, // 只在非队列模式且预览时预加载
  });

  // 重置状态当组件变为可见时
  useEffect(() => {
    if (visible) {
      setCurrentIndex(initialIndex);
      setScale(1);
      setOffset({ x: 0, y: 0 });
    }
  }, [visible, initialIndex, images]);

  // 优化状态同步逻辑：当 currentImage 变化时重置加载状态
  useEffect(() => {
    setImageLoaded(false);

    // 当切换到新图片时，如果需要加载（没有缓存），立即显示加载状态
    if (currentImage && visible) {
      // 检查是否有缓存
      const hasCache = useQueue
        ? queueImageDataUrl && !queueImageError
        : currentImageDataUrl && !currentImageError;

      if (!hasCache) {
        setIsLoading(true);
      }
    }
  }, [
    currentImage,
    visible,
    useQueue,
    queueImageDataUrl,
    queueImageError,
    currentImageDataUrl,
    currentImageError,
  ]);

  // 额外优化：当 dataUrl 突然出现时（比如从缓存快速加载），立即设置加载完成
  useEffect(() => {
    if (currentImageDataUrl && !currentImageLoading && !currentImageError) {
      // 使用 setTimeout 确保状态更新在下一个事件循环中执行
      const timer = setTimeout(() => {
        setImageLoaded(true);
        setIsLoading(false);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [currentImageDataUrl, currentImageLoading, currentImageError]);

  // 同步图片加载状态（队列模式或普通模式）
  useEffect(() => {
    if (useQueue) {
      // 队列模式：使用队列加载状态
      setIsLoading(queueImageLoading);

      if (queueImageDataUrl && !queueImageLoading && !queueImageError) {
        setImageLoaded(true);
      } else if (queueImageError) {
        setImageLoaded(false);
      } else if (queueImageLoading) {
        // 正在加载时，确保 imageLoaded 为 false
        setImageLoaded(false);
      }
    } else {
      // 普通模式：使用图片管理器加载状态
      setIsLoading(currentImageLoading);

      if (currentImageDataUrl && !currentImageLoading && !currentImageError) {
        setImageLoaded(true);
      } else if (currentImageError) {
        setImageLoaded(false);
      } else if (currentImageLoading) {
        // 正在加载时，确保 imageLoaded 为 false
        setImageLoaded(false);
      }
    }
  }, [
    useQueue,
    queueImageLoading,
    queueImageDataUrl,
    queueImageError,
    currentImageLoading,
    currentImageError,
    currentImageDataUrl,
  ]);

  // 移除快速加载备用方案，避免与主要加载机制冲突

  const goToPrevious = useCallback(() => {
    if (!hasMultipleImages) return;
    setCurrentIndex((prev) => {
      const newIndex = prev === 0 ? images.length - 1 : prev - 1;
      onImageChange?.(newIndex);
      return newIndex;
    });
  }, [hasMultipleImages, images.length, onImageChange]);

  const goToNext = useCallback(() => {
    if (!hasMultipleImages) return;
    setCurrentIndex((prev) => {
      const newIndex = prev === images.length - 1 ? 0 : prev + 1;
      onImageChange?.(newIndex);
      return newIndex;
    });
  }, [hasMultipleImages, images.length, onImageChange]);

  const downloadCurrentImage = useCallback(async () => {
    if (!currentImage) return;

    try {
      // 优先使用已经缓存的blob
      let blob = useQueue ? queueImageBlob : currentImageBlob;

      if (!blob) {
        // 如果没有缓存，才发起请求
        const response = await fetch(getProxiedImageUrl(currentImage), {
          mode: "cors",
        });
        blob = await response.blob();
      }

      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `image-${currentIndex + 1}.${
        blob.type.split("/")[1] || "jpg"
      }`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("下载图片失败:", error);
    }
  }, [currentImage, currentIndex, currentImageBlob, queueImageBlob, useQueue]);

  // 键盘导航
  useEffect(() => {
    if (!visible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      switch (e.key) {
        case "Escape":
          onClose();
          break;
        case "ArrowLeft":
          goToPrevious();
          break;
        case "ArrowRight":
          goToNext();
          break;
        case "s":
        case "S":
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            downloadCurrentImage();
          }
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    visible,
    currentIndex,
    images,
    onClose,
    goToPrevious,
    goToNext,
    downloadCurrentImage,
  ]);

  const handleImageLoad = () => {
    setIsLoading(false);
    setImageLoaded(true);
  };

  const handleImageError = () => {
    setIsLoading(false);
    setImageLoaded(false);
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    // 如果点击的是 overlay 本身，或者点击的不是图片、按钮等交互元素，就关闭预览
    const target = e.target as HTMLElement;

    // 如果点击的是 overlay 容器本身
    if (e.target === e.currentTarget) {
      onClose();
      return;
    }

    // 如果点击的是交互元素（图片、按钮等），不关闭预览
    const isInteractiveElement = target.closest(
      "img, button, .toolbar-button, .overlay-icon, .loading-placeholder, .error-placeholder, .nav-hotzone",
    );

    // 如果不是交互元素，说明点击的是空白区域，关闭预览
    if (!isInteractiveElement) {
      onClose();
    }
  };

  // 缩放相关
  const clamp = (val: number, min: number, max: number) =>
    Math.min(max, Math.max(min, val));
  const zoomIn = () =>
    setScale((s) => clamp(Number((s + 0.2).toFixed(2)), 0.5, 4));
  const zoomOut = () =>
    setScale((s) => clamp(Number((s - 0.2).toFixed(2)), 0.5, 4));
  const resetZoom = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  // 使用useEffect添加原生wheel事件监听器，以避免被动监听器警告
  useEffect(() => {
    // 节流滚轮缩放，避免频繁触发状态更新
    let lastTs = 0;
    const throttleMs = 50;
    const handleWheel = (e: WheelEvent) => {
      if (!visible) return;
      e.preventDefault();
      const now = Date.now();
      if (now - lastTs < throttleMs) return;
      lastTs = now;
      const delta = e.deltaY > 0 ? -0.2 : 0.2;
      setScale((s) => clamp(Number((s + delta).toFixed(2)), 0.5, 4));
    };

    if (containerRef.current && visible) {
      // 明确设置为非被动模式
      containerRef.current.addEventListener("wheel", handleWheel, {
        passive: false,
      });

      return () => {
        const currentContainer = containerRef.current;
        if (currentContainer) {
          currentContainer.removeEventListener("wheel", handleWheel);
        }
      };
    }
  }, [visible]);

  // 拖拽
  const onMouseDown: React.MouseEventHandler<HTMLDivElement> = (e) => {
    if (scale <= 1) return;
    setDragging(true);
    dragStart.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
  };

  const onMouseMove: React.MouseEventHandler<HTMLDivElement> = (e) => {
    if (!dragging || !dragStart.current) return;
    setOffset({
      x: e.clientX - dragStart.current.x,
      y: e.clientY - dragStart.current.y,
    });
  };

  const endDrag = () => {
    setDragging(false);
    dragStart.current = null;
  };

  useEffect(() => {
    if (!visible) return;
    const up = () => endDrag();
    window.addEventListener("mouseup", up);
    window.addEventListener("mouseleave", up);
    return () => {
      window.removeEventListener("mouseup", up);
      window.removeEventListener("mouseleave", up);
    };
  }, [visible]);

  // 触控手势处理
  const handleTouchStart = (e: React.TouchEvent) => {
    if (!isMobile || !hasMultipleImages) return;
    const touch = e.touches[0];
    touchStartX.current = touch.clientX;
    touchStartY.current = touch.clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!isMobile || !hasMultipleImages) return;

    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - touchStartX.current;
    const deltaY = touch.clientY - touchStartY.current;

    // 检查是否是横向滑动（而不是纵向滚动）
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 50) {
      if (deltaX > 0) {
        // 向右滑动 - 上一张
        goToPrevious();
      } else {
        // 向左滑动 - 下一张
        goToNext();
      }
    }
  };

  if (!visible) return null;

  return (
    <div
      className={clsx(styles["image-viewer-overlay"], className)}
      onClick={handleBackdropClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      ref={containerRef}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
    >
      {hasMultipleImages && (
        <>
          <button
            className={clsx(styles["nav-hotzone"], styles["left-zone"])}
            onClick={(e) => {
              e.stopPropagation();
              goToPrevious();
            }}
            onMouseDown={(e) => e.stopPropagation()}
            aria-label="上一张 热区"
            title="上一张"
          />
          <button
            className={clsx(styles["nav-hotzone"], styles["right-zone"])}
            onClick={(e) => {
              e.stopPropagation();
              goToNext();
            }}
            onMouseDown={(e) => e.stopPropagation()}
            aria-label="下一张 热区"
            title="下一张"
          />
        </>
      )}

      {/* 左箭头（透明图标） */}
      {hasMultipleImages && (
        <button
          className={clsx(styles["overlay-icon"], styles["icon-left"])}
          onClick={goToPrevious}
          title="上一张 (←)"
          aria-label="上一张"
        >
          <span className={styles["chevron"]}>‹</span>
        </button>
      )}

      {/* 队列模式：只有拿到 dataUrl 才渲染，避免绕过队列直接请求原图 */}
      {(useQueue
        ? !!queueImageDataUrl
        : !!(currentImageDataUrl || currentImage)) && (
        <Image
          ref={imageRef}
          src={
            useQueue
              ? (queueImageDataUrl as string)
              : currentImageDataUrl || currentImage
          }
          alt={`图片 ${currentIndex + 1}`}
          className={clsx(styles["main-image"], {
            [styles["image-loaded"]]: imageLoaded,
          })}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            cursor: scale > 1 ? (dragging ? "grabbing" : "grab") : "default",
          }}
          onLoad={handleImageLoad}
          onError={handleImageError}
          onDragStart={(e) => e.preventDefault()}
          width={1920}
          height={1080}
          unoptimized
        />
      )}

      {/* 加载指示器只在没有 dataUrl 且正在加载时显示 */}
      {!(useQueue ? queueImageDataUrl : currentImageDataUrl) &&
        (useQueue ? queueImageLoading : isLoading) && (
          <div className={styles["loading-placeholder"]}>
            <div className={styles["loading-spinner"]} />
            {showQueueStatus && useQueue && (
              <div className={styles["queue-status"]}>队列加载中...</div>
            )}
          </div>
        )}

      {/* 错误提示只在没有 dataUrl 且有错误时显示 */}
      {!(useQueue ? queueImageDataUrl : currentImageDataUrl) &&
        (useQueue ? queueImageError : currentImageError) && (
          <div className={styles["error-placeholder"]}>
            <div className={styles["error-message"]}>图片加载失败</div>
          </div>
        )}

      {/* 右箭头（透明图标） */}
      {hasMultipleImages && (
        <button
          className={clsx(styles["overlay-icon"], styles["icon-right"])}
          onClick={goToNext}
          title="下一张 (→)"
          aria-label="下一张"
        >
          <span className={styles["chevron"]}>›</span>
        </button>
      )}

      {/* 右上角关闭按钮 */}
      <div className={styles["top-right"]}>
        <button
          className={styles["toolbar-button"]}
          onClick={onClose}
          title="关闭"
          aria-label="关闭"
        >
          <CloseIcon />
        </button>
      </div>

      {/* 底部工具栏 - 居中浮层 */}
      <div className={styles["bottom-toolbar"]}>
        <div
          className={clsx(styles["toolbar-button"], styles["pager"])}
          aria-label={`第 ${currentIndex + 1} 张，共 ${images.length} 张`}
        >
          {currentIndex + 1}/{images.length}
        </div>
        <button
          className={styles["toolbar-button"]}
          onClick={zoomOut}
          title="缩小"
          aria-label="缩小"
        >
          <MinIcon />
        </button>

        <button
          className={styles["toolbar-button"]}
          onClick={zoomIn}
          title="放大"
          aria-label="放大"
        >
          <MaxIcon />
        </button>
        <button
          className={styles["toolbar-button"]}
          onClick={resetZoom}
          title="重置"
          aria-label="重置"
        >
          <ResetIcon />
        </button>
        <button
          className={styles["toolbar-button"]}
          onClick={downloadCurrentImage}
          title="下载图片"
          aria-label="下载图片"
        >
          <DownloadIcon />
        </button>
      </div>
    </div>
  );
}

// Hook 用于管理图片查看器状态
export function useImageViewer() {
  const [isVisible, setIsVisible] = useState(false);
  const [images, setImages] = useState<string[]>([]);
  const [initialIndex, setInitialIndex] = useState(0);

  const showImageViewer = useCallback(
    (imageList: string[], startIndex: number = 0) => {
      setImages(imageList);
      setInitialIndex(startIndex);
      setIsVisible(true);
    },
    [],
  );

  const hideImageViewer = useCallback(() => {
    setIsVisible(false);
  }, []);

  return {
    isVisible,
    images,
    initialIndex,
    showImageViewer,
    hideImageViewer,
  };
}
