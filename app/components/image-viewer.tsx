import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import Image from "next/image";
import { useMobileScreen } from "../utils";
import styles from "./image-viewer.module.scss";
import clsx from "clsx";
import { useImage } from "../utils/use-image";
import { imageQueueManager } from "../utils/image-queue-manager";
import { imageManager } from "../utils/image-manager";

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
  // 调试标识
  const instanceIdRef = useRef<string>(Math.random().toString(36).slice(2, 7));
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
  const lastNavAtRef = useRef<number>(0);
  const prevIndexRef = useRef<number>(currentIndex);
  const lastSrcRef = useRef<string | undefined>(undefined);

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
        // 新图片开始加载时，先清空上一张的 dataUrl，避免复用造成“重复图片”
        setQueueImageDataUrl(undefined);
        setQueueImageLoading(true);
        setQueueImageError(undefined);

        // 回退：从代理原图获取并转为 dataURL
        const blobToDataURL = (blob: Blob): Promise<string> =>
          new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });

        const fallbackFetchOriginal = async () => {
          try {
            const url = getProxiedImageUrl(currentImage);
            const resp = await fetch(url, { mode: "cors" });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const ct = resp.headers.get("content-type") || "";
            if (!ct.startsWith("image/")) {
              throw new Error(`非图片响应: ${ct}`);
            }
            const blob = await resp.blob();
            const dataUrl = await blobToDataURL(blob);
            if (!cancelled) {
              setQueueImageDataUrl(dataUrl);
              setQueueImageBlob(blob);
              setQueueImageError(undefined);
              setQueueImageLoading(false);
            }
          } catch (err) {
            if (!cancelled) {
              const msg = err instanceof Error ? err.message : String(err);
              setQueueImageError(msg);
              setQueueImageLoading(false);
            }
          }
        };

        const result = await imageQueueManager.loadImage(currentImage, {
          compress: false,
          priority: 1, // 查看器图片使用高优先级
          maxRetries: 3,
          retryDelay: 1000,
          onLoad: (result) => {
            if (!cancelled) {
              const isImageBlob =
                !!result.blob && result.blob.type?.startsWith("image/");
              const isImageDataUrl =
                typeof result.dataUrl === "string" &&
                result.dataUrl.startsWith("data:image/");
              if (isImageBlob || isImageDataUrl) {
                setQueueImageDataUrl(result.dataUrl);
                setQueueImageBlob(result.blob);
                setQueueImageLoading(false);
              } else {
                const errMsg =
                  result.error ||
                  `非图片响应: ${
                    result.blob?.type ||
                    (result.dataUrl
                      ? result.dataUrl.slice(0, 40) + "..."
                      : "unknown")
                  }`;
                // 触发回退尝试
                void fallbackFetchOriginal();
              }
            }
          },
          onError: (error) => {
            if (!cancelled) {
              // 触发回退尝试
              void fallbackFetchOriginal();
            }
          },
        });

        if (!cancelled && result.dataUrl) {
          const isImageBlob =
            !!result.blob && result.blob.type?.startsWith("image/");
          const isImageDataUrl =
            typeof result.dataUrl === "string" &&
            result.dataUrl.startsWith("data:image/");
          if (isImageBlob || isImageDataUrl) {
            setQueueImageDataUrl(result.dataUrl);
            setQueueImageBlob(result.blob);
          } else {
            const errMsg =
              result.error ||
              `非图片响应: ${
                result.blob?.type ||
                (result.dataUrl
                  ? result.dataUrl.slice(0, 40) + "..."
                  : "unknown")
              }`;
            // 触发回退尝试
            void fallbackFetchOriginal();
          }
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
  }, [visible, useQueue, currentImage, currentIndex]);

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

  // 仅在从隐藏到显示时重置状态，避免因 images 引用变化导致索引重置
  const prevVisibleRef = useRef<boolean>(visible);
  useEffect(() => {
    if (visible && !prevVisibleRef.current) {
      setCurrentIndex(initialIndex);
      setScale(1);
      setOffset({ x: 0, y: 0 });
    }
    prevVisibleRef.current = visible;
  }, [visible, initialIndex]);

  // 优化状态同步逻辑：当 currentImage 变化时重置加载状态
  useEffect(() => {
    if (!visible) return;
    // 计算将用于渲染的 src（确保 dataUrl 属于当前 URL，避免沿用上一张）
    const cacheForCurrent = currentImage
      ? imageManager.getCacheStatus(currentImage)
      : undefined;
    const nextSrc = useQueue
      ? queueImageDataUrl
      : cacheForCurrent?.dataUrl ||
        (currentImage ? getProxiedImageUrl(currentImage) : undefined);

    // 仅当实际渲染的 src 发生变化时，才重置 loading
    if (nextSrc && lastSrcRef.current !== nextSrc) {
      setImageLoaded(false);

      // 同步检查缓存，避免无意义 loading
      const cached = currentImage ? cacheForCurrent : undefined;
      const hasCache = useQueue
        ? !!queueImageDataUrl && !queueImageError
        : !!cached?.dataUrl;

      if (!hasCache) {
        setIsLoading(true);
      } else {
        // 已有缓存，直接让 onLoad/fallback 立即收尾
        setIsLoading(false);
      }

      lastSrcRef.current = nextSrc;
      prevIndexRef.current = currentIndex;
    } else if (nextSrc && lastSrcRef.current === nextSrc) {
      // 当 src 相同但索引变化时，强制重置，避免误判为已加载（例如上一张 dataUrl 被复用）
      if (prevIndexRef.current !== currentIndex) {
        setImageLoaded(false);
        setIsLoading(useQueue ? queueImageLoading : currentImageLoading);
      } else {
        // 同一索引重复渲染，认为已完成
        setIsLoading(false);
        setImageLoaded(true);
      }
      prevIndexRef.current = currentIndex;
    }
  }, [
    visible,
    currentImage,
    useQueue,
    queueImageDataUrl,
    queueImageError,
    currentImageDataUrl,
    currentImageError,
    currentIndex,
  ]);

  // 移除基于 dataUrl 的自动完成，改为严格依赖 <Image> onLoad

  // 同步图片加载状态（队列模式或普通模式）
  useEffect(() => {
    // 使用底层加载状态驱动 isLoading，但不再根据 dataUrl 提前设置 imageLoaded
    setIsLoading(useQueue ? queueImageLoading : currentImageLoading);
    if (useQueue ? queueImageError : currentImageError) {
      setImageLoaded(false);
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
    const now = Date.now();
    if (now - lastNavAtRef.current < 200) {
      return;
    }
    lastNavAtRef.current = now;
    setCurrentIndex((prev) => {
      const newIndex = prev === 0 ? images.length - 1 : prev - 1;
      onImageChange?.(newIndex);
      return newIndex;
    });
  }, [hasMultipleImages, images.length, onImageChange]);

  const goToNext = useCallback(() => {
    if (!hasMultipleImages) return;
    const now = Date.now();
    if (now - lastNavAtRef.current < 200) {
      return;
    }
    lastNavAtRef.current = now;
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

  // 兜底：如果浏览器已经从缓存同步完成（complete=true），但未触发 onLoad，主动标记加载完成
  useEffect(() => {
    if (!visible) return;
    const src = useQueue ? queueImageDataUrl : currentImageDataUrl;
    if (!src) return;
    const img = imageRef.current;
    if (img && img.complete) {
      if (img.naturalWidth > 0) {
        setIsLoading(false);
        setImageLoaded(true);
      } else {
      }
    }
  }, [visible, useQueue, queueImageDataUrl, currentImageDataUrl]);

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

      {/* 渲染图片：
          - 队列模式：仅在有 dataUrl 时渲染
          - 非队列模式：有 dataUrl 用 dataUrl，否则回退到代理后的原始 URL，确保能触发 onLoad */}
      {(useQueue ? !!queueImageDataUrl : !!currentImage) && (
        <Image
          // key 带上索引，确保同一 URL 不同索引时也会触发重新渲染
          key={`${currentImage}-${currentIndex}`}
          ref={imageRef}
          src={
            useQueue
              ? (queueImageDataUrl as string)
              : ((currentImage &&
                  imageManager.getCacheStatus(currentImage)
                    ?.dataUrl) as string) || getProxiedImageUrl(currentImage)
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

      {/* 加载指示器：严格以 <Image> 是否完成为准，避免提前结束 */}
      {!imageLoaded && !(useQueue ? queueImageError : currentImageError) && (
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
