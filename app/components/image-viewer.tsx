import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
// 改用原生 img，避免 next/image 在 dataUrl 上反复生成 blob: URL
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
  // ----------------------
  // useImageNavigation 抽取
  // ----------------------
  const useImageNavigation = useCallback(
    (opts: {
      images: string[];
      initialIndex: number;
      onImageChange?: (index: number) => void;
      enabled: boolean;
    }) => {
      const { images, initialIndex, onImageChange, enabled } = opts;
      const [currentIndex, setCurrentIndex] = useState(initialIndex);
      const hasMultipleImages = images.length > 1;
      const lastNavAtRef = useRef<number>(0);

      // 在可见状态从隐藏切换到显示时同步初始索引
      const prevEnabledRef = useRef<boolean>(enabled);
      useEffect(() => {
        if (enabled && !prevEnabledRef.current) {
          setCurrentIndex(initialIndex);
        }
        prevEnabledRef.current = enabled;
      }, [enabled, initialIndex]);

      const goToPrevious = useCallback(() => {
        if (!hasMultipleImages) return;
        const now = Date.now();
        if (now - lastNavAtRef.current < 200) return;
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
        if (now - lastNavAtRef.current < 200) return;
        lastNavAtRef.current = now;
        setCurrentIndex((prev) => {
          const newIndex = prev === images.length - 1 ? 0 : prev + 1;
          onImageChange?.(newIndex);
          return newIndex;
        });
      }, [hasMultipleImages, images.length, onImageChange]);

      return {
        currentIndex,
        setCurrentIndex,
        hasMultipleImages,
        goToPrevious,
        goToNext,
      } as const;
    },
    [],
  );

  // 调试标识
  const instanceIdRef = useRef<string>(Math.random().toString(36).slice(2, 7));
  const settleLoaded = (loaded: boolean) => {
    setIsLoading(false);
    setImageLoaded(loaded);
  };
  const {
    currentIndex,
    setCurrentIndex,
    hasMultipleImages,
    goToPrevious,
    goToNext,
  } = useImageNavigation({
    images,
    initialIndex,
    onImageChange,
    enabled: visible,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const isMobile = useMobileScreen();
  const imageRef = useRef<HTMLImageElement>(null);
  const touchStartX = useRef<number>(0);
  const touchStartY = useRef<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // 缩放与拖拽由 Hook 管理
  const prevIndexRef = useRef<number>(currentIndex);
  const lastSrcRef = useRef<string | undefined>(undefined);

  // ----------------------
  // useZoomAndDrag 抽取
  // ----------------------
  const useZoomAndDrag = useCallback(
    (opts: { imageRef: React.RefObject<HTMLImageElement>; enabled: boolean }) => {
      const { imageRef, enabled } = opts;
      const scaleRef = useRef<number>(1);
      const offsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
      const rafIdRef = useRef<number | null>(null);
      const [scale, setScale] = useState(1);
      const [offset, setOffset] = useState({ x: 0, y: 0 });
      const [dragging, setDragging] = useState(false);
      const dragStart = useRef<{ x: number; y: number } | null>(null);

      const applyTransform = useCallback(() => {
        if (!imageRef.current) return;
        const transform = `translate(${offsetRef.current.x}px, ${offsetRef.current.y}px) scale(${scaleRef.current})`;
        imageRef.current.style.transform = transform;
      }, [imageRef]);

      const scheduleApply = useCallback(() => {
        if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = requestAnimationFrame(() => {
          applyTransform();
          rafIdRef.current = null;
        });
      }, [applyTransform]);

      const clamp = (val: number, min: number, max: number) =>
        Math.min(max, Math.max(min, val));

      const zoomIn = useCallback(() => {
        const next = clamp(Number((scaleRef.current + 0.2).toFixed(2)), 0.5, 4);
        scaleRef.current = next;
        setScale(next);
        scheduleApply();
      }, [scheduleApply]);

      const zoomOut = useCallback(() => {
        const next = clamp(Number((scaleRef.current - 0.2).toFixed(2)), 0.5, 4);
        scaleRef.current = next;
        setScale(next);
        scheduleApply();
      }, [scheduleApply]);

      const resetZoom = useCallback(() => {
        scaleRef.current = 1;
        offsetRef.current = { x: 0, y: 0 };
        setScale(1);
        setOffset({ x: 0, y: 0 });
        scheduleApply();
      }, [scheduleApply]);

      // 滚轮缩放
      useEffect(() => {
        if (!enabled) return;
        let lastTs = 0;
        const throttleMs = 50;
        const onWheel = (e: WheelEvent) => {
          if (!enabled) return;
          e.preventDefault();
          const now = Date.now();
          if (now - lastTs < throttleMs) return;
          lastTs = now;
          const delta = e.deltaY > 0 ? -0.2 : 0.2;
          scaleRef.current = clamp(
            Number((scaleRef.current + delta).toFixed(2)),
            0.5,
            4,
          );
          setScale(scaleRef.current);
          scheduleApply();
        };

        const el = containerRef.current;
        if (el && enabled) {
          el.addEventListener("wheel", onWheel, { passive: false });
          return () => el.removeEventListener("wheel", onWheel);
        }
      }, [enabled, scheduleApply]);

      const onMouseDown: React.MouseEventHandler<HTMLDivElement> = (e) => {
        // 避免拦截按钮/图标等交互元素
        const target = e.target as HTMLElement;
        if (
          target.closest(
            "button, a, [role=button], .toolbar-button, .overlay-icon, .nav-hotzone",
          )
        ) {
          return;
        }
        if (scaleRef.current <= 1) return;
        setDragging(true);
        dragStart.current = {
          x: e.clientX - offsetRef.current.x,
          y: e.clientY - offsetRef.current.y,
        };
      };

      const onMouseMove: React.MouseEventHandler<HTMLDivElement> = (e) => {
        if (!dragging || !dragStart.current) return;
        offsetRef.current = {
          x: e.clientX - dragStart.current.x,
          y: e.clientY - dragStart.current.y,
        };
        if (Math.random() < 0.05) setOffset({ ...offsetRef.current });
        scheduleApply();
      };

      const endDrag = () => {
        setDragging(false);
        dragStart.current = null;
      };

      useEffect(() => {
        if (!enabled) return;
        const up = () => endDrag();
        window.addEventListener("mouseup", up);
        window.addEventListener("mouseleave", up);
        return () => {
          window.removeEventListener("mouseup", up);
          window.removeEventListener("mouseleave", up);
        };
      }, [enabled]);

      // 触摸拖拽（移动端）
      const onTouchStart: React.TouchEventHandler<HTMLDivElement> = (e) => {
        if (!enabled) return;
        // 避免阻止按钮/图标的点击生成
        const target = e.target as HTMLElement;
        if (
          target.closest(
            "button, a, [role=button], .toolbar-button, .overlay-icon, .nav-hotzone",
          )
        ) {
          return;
        }
        if (scaleRef.current <= 1) return; // 未放大时交给外层做左右切换
        if (e.touches.length !== 1) return;
        const t = e.touches[0];
        setDragging(true);
        dragStart.current = {
          x: t.clientX - offsetRef.current.x,
          y: t.clientY - offsetRef.current.y,
        };
      };

      const onTouchMove: React.TouchEventHandler<HTMLDivElement> = (e) => {
        if (!enabled) return;
        const target = e.target as HTMLElement;
        if (
          target.closest(
            "button, a, [role=button], .toolbar-button, .overlay-icon, .nav-hotzone",
          )
        ) {
          return;
        }
        if (!dragging || !dragStart.current) return;
        const t = e.touches[0];
        offsetRef.current = {
          x: t.clientX - dragStart.current.x,
          y: t.clientY - dragStart.current.y,
        };
        if (Math.random() < 0.08) setOffset({ ...offsetRef.current });
        scheduleApply();
      };

      const onTouchEnd: React.TouchEventHandler<HTMLDivElement> = (e) => {
        if (!enabled) return;
        const target = e.target as HTMLElement;
        if (
          target.closest(
            "button, a, [role=button], .toolbar-button, .overlay-icon, .nav-hotzone",
          )
        ) {
          return;
        }
        if (!dragging) return;
        endDrag();
      };

      // 当图片源变化或重新显示时，将当前状态应用到 DOM
      useEffect(() => {
        if (!enabled) return;
        scaleRef.current = scale;
        offsetRef.current = offset;
        scheduleApply();
      }, [enabled, scale, offset]);

      return {
        scale,
        setScale,
        offset,
        setOffset,
        dragging,
        onMouseDown,
        onMouseMove,
        onTouchStart,
        onTouchMove,
        onTouchEnd,
        resetZoom,
        zoomIn,
        zoomOut,
        scaleRef,
        applyTransformNow: scheduleApply,
      } as const;
    },
    [],
  );

  const zoomDrag = useZoomAndDrag({ imageRef, enabled: visible });
  const { zoomIn, zoomOut, resetZoom } = zoomDrag;

  // 队列加载状态
  const [queueImageDataUrl, setQueueImageDataUrl] = useState<
    string | undefined
  >();
  const [queueImageLoading, setQueueImageLoading] = useState(false);
  const [queueImageError, setQueueImageError] = useState<string | undefined>();
  const [queueImageBlob, setQueueImageBlob] = useState<Blob | undefined>();
  // 预生成的新图 objectURL（尚未显示）
  const preparedObjectUrlRef = useRef<string | null>(null);
  // 当前正在展示的 objectURL（显示中）
  const activeObjectUrlRef = useRef<string | null>(null);

  const currentImage = images[currentIndex];

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
        // 翻页立即重置视图加载状态，确保出现加载动画
        setImageLoaded(false);
        setIsLoading(true);

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

  // 仅在从隐藏到显示时重置缩放与偏移（索引重置已在 useImageNavigation 中处理）
  const prevVisibleRef = useRef<boolean>(visible);
  useEffect(() => {
    if (visible && !prevVisibleRef.current) {
      zoomDrag.resetZoom();
    }
    prevVisibleRef.current = visible;
  }, [visible, initialIndex, zoomDrag]);

  // 优化状态同步逻辑：当 currentImage 变化时重置加载状态
  useEffect(() => {
    if (!visible) return;
    // 计算将用于渲染的 src（确保 dataUrl 属于当前 URL，避免沿用上一张）
    const cacheForCurrent = currentImage
      ? imageManager.getCacheStatus(currentImage)
      : undefined;
    // 移除对代理原图的直接回退，避免 <img> 再次向服务器发起请求
    // 非队列模式仅在有缓存或 hook 返回的 dataUrl 时才渲染
    const nextSrc = useQueue
      ? queueImageDataUrl
      : cacheForCurrent?.dataUrl || currentImageDataUrl;

    // 仅当实际渲染的 src 发生变化时，才重置 loading
    if (nextSrc && lastSrcRef.current !== nextSrc) {
      setImageLoaded(false);

      // 同步检查缓存，避免无意义 loading
      const cached = currentImage ? cacheForCurrent : undefined;
      const hasCache = useQueue
        ? !!queueImageDataUrl && !queueImageError
        : !!cached?.dataUrl || !!currentImageDataUrl;

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
    } else if (!nextSrc && prevIndexRef.current !== currentIndex) {
      // 索引变化但 dataUrl 尚未就绪，进入加载中，等待 hook/队列返回
      setImageLoaded(false);
      setIsLoading(true);
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

  // 错误出现时立即收尾
  useEffect(() => {
    const hasError = useQueue ? queueImageError : currentImageError;
    if (hasError) {
      settleLoaded(false);
    }
  }, [useQueue, queueImageError, currentImageError]);

  // 移除快速加载备用方案，避免与主要加载机制冲突

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

  // 生成用于渲染的 src（优先 Blob → 退到 dataUrl），并仅在源变更时更新，避免频繁创建 blob: URL 导致图片重复加载
  const lastBlobRef = useRef<Blob | undefined>(undefined);
  const lastDataUrlRef = useRef<string | undefined>(undefined);
  const [renderSrc, setRenderSrc] = useState<string | undefined>(undefined);
  // 实际用于 <img> 的展示 src；在新图片加载完成前保持为上一张，避免闪白
  const [displaySrc, setDisplaySrc] = useState<string | undefined>(undefined);

  useEffect(() => {
    const blob = useQueue ? queueImageBlob : currentImageBlob;
    const dataUrl = useQueue ? queueImageDataUrl : currentImageDataUrl;

    // 如果 Blob 发生变化，创建“预备”的 objectURL（不立刻替换正在展示的图片）
    if (blob && blob !== lastBlobRef.current) {
      if (
        preparedObjectUrlRef.current &&
        preparedObjectUrlRef.current !== activeObjectUrlRef.current
      ) {
        URL.revokeObjectURL(preparedObjectUrlRef.current);
      }
      const url = URL.createObjectURL(blob);
      preparedObjectUrlRef.current = url;
      lastBlobRef.current = blob;
      lastDataUrlRef.current = undefined;
      setRenderSrc(url);
      return;
    }

    // 无 Blob 时，若 dataUrl 变化则更新
    if (!blob && dataUrl && dataUrl !== lastDataUrlRef.current) {
      // 释放未使用的预备 URL（与当前展示无关）
      if (
        preparedObjectUrlRef.current &&
        preparedObjectUrlRef.current !== activeObjectUrlRef.current
      ) {
        URL.revokeObjectURL(preparedObjectUrlRef.current);
        preparedObjectUrlRef.current = null;
      }
      lastBlobRef.current = undefined;
      lastDataUrlRef.current = dataUrl;
      setRenderSrc(dataUrl);
      return;
    }

    // 源未变化，不做任何事，保持现有 renderSrc，避免触发重新加载
  }, [useQueue, queueImageBlob, currentImageBlob, queueImageDataUrl, currentImageDataUrl]);

  // 卸载时释放 URL
  useEffect(() => {
    return () => {
      if (preparedObjectUrlRef.current) {
        URL.revokeObjectURL(preparedObjectUrlRef.current);
        preparedObjectUrlRef.current = null;
      }
      if (activeObjectUrlRef.current) {
        URL.revokeObjectURL(activeObjectUrlRef.current);
        activeObjectUrlRef.current = null;
      }
    };
  }, []);

  // 预加载即将显示的图片，加载完成后再切换 displaySrc，并以淡入效果呈现
  useEffect(() => {
    if (!renderSrc) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      // 开始淡入：先将当前图片标记为未加载，切换 src 后下一帧再标记为已加载
      setImageLoaded(false);
      setDisplaySrc(renderSrc);
      // 如果是 objectURL，更新“正在展示”的 URL 并释放旧的
      if (renderSrc.startsWith("blob:")) {
        if (activeObjectUrlRef.current && activeObjectUrlRef.current !== renderSrc) {
          try { URL.revokeObjectURL(activeObjectUrlRef.current); } catch {}
        }
        activeObjectUrlRef.current = renderSrc;
      }
      requestAnimationFrame(() => {
        if (!cancelled) setImageLoaded(true);
      });
    };
    img.onerror = () => {
      if (!cancelled) settleLoaded(false);
    };
    img.src = renderSrc;
    return () => { cancelled = true; };
  }, [renderSrc]);

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
    settleLoaded(true);
  };

  const handleImageError = () => {
    settleLoaded(false);
  };

  // 允许在未放大时进行 HTML5 拖拽（拖出到其它应用/标签）
  const handleImageDragStart = useCallback(
    (e: React.DragEvent<HTMLImageElement>) => {
      if (!renderSrc) return;
      try {
        e.dataTransfer.effectAllowed = "copy";
        // 标准 URL 拖拽类型
        e.dataTransfer.setData("text/uri-list", renderSrc);
        e.dataTransfer.setData("text/plain", renderSrc);
      } catch {}
    },
    [renderSrc],
  );

  // 兜底：如果浏览器已经从缓存同步完成（complete=true），但未触发 onLoad，主动标记加载完成
  useEffect(() => {
    if (!visible) return;
    const img = imageRef.current;
    // 仅当 key 对应的 src 与当前期望一致时，才用 complete 快速收尾
    const expectedSrc = useQueue
      ? queueImageDataUrl
      : currentImageDataUrl ||
        (currentImage && imageManager.getCacheStatus(currentImage)?.dataUrl) ||
        undefined;
    if (img && expectedSrc && img.getAttribute("src") === expectedSrc) {
      if (img.complete && img.naturalWidth > 0) {
        settleLoaded(true);
      }
    }
  }, [
    visible,
    useQueue,
    queueImageDataUrl,
    currentImageDataUrl,
    currentImage,
    currentIndex,
  ]);

  // 卸载清理：当前无计时器，无需处理

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

  // 当图片源变化或重新显示时，将当前状态应用到 DOM
  useEffect(() => {
    if (!visible) return;
    zoomDrag.applyTransformNow();
  }, [renderSrc, visible, zoomDrag]);

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
      onTouchStart={(e) => {
        // 如果已放大，优先进行平移拖拽；否则用于左右切换
        if (zoomDrag.scaleRef.current > 1) {
          zoomDrag.onTouchStart(e);
        } else {
          handleTouchStart(e);
        }
      }}
      onTouchMove={(e) => {
        if (zoomDrag.scaleRef.current > 1) {
          zoomDrag.onTouchMove(e);
        }
      }}
      onTouchEnd={(e) => {
        if (zoomDrag.scaleRef.current > 1) {
          zoomDrag.onTouchEnd(e);
        } else {
          handleTouchEnd(e);
        }
      }}
      ref={containerRef}
      onMouseDown={zoomDrag.onMouseDown}
      onMouseMove={zoomDrag.onMouseMove}
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

      {/* 渲染图片：仅在拿到 dataUrl/缓存后再渲染，避免直接命中代理导致重复请求 */}
      {(useQueue
        ? !!(queueImageBlob || queueImageDataUrl)
        : !!(
            currentImageBlob ||
            currentImageDataUrl ||
            (currentImage && imageManager.getCacheStatus(currentImage)?.dataUrl)
          )) &&
        !(
          (useQueue ? queueImageError : currentImageError) &&
          !(useQueue
            ? queueImageBlob || queueImageDataUrl
            : currentImageBlob || currentImageDataUrl)
        ) && (
          <img
            key={`${currentImage}-${currentIndex}`}
            ref={imageRef}
            src={displaySrc as string}
            alt={`图片 ${currentIndex + 1}`}
            className={clsx(styles["main-image"], {
              [styles["image-loaded"]]: imageLoaded,
            })}
            style={{
              cursor:
                zoomDrag.scaleRef.current > 1
                  ? (zoomDrag.dragging ? "grabbing" : "grab")
                  : "default",
            }}
            onLoad={handleImageLoad}
            onError={handleImageError}
            draggable={zoomDrag.scaleRef.current <= 1}
            onDragStart={handleImageDragStart}
            loading="eager"
          />
        )}

      {/* 加载指示器：以实际 isLoading 为准 */}
      {isLoading && !(useQueue ? queueImageError : currentImageError) && (
        <div className={styles["loading-placeholder"]}>
          <div className={styles["loading-spinner"]} />
          {showQueueStatus && useQueue && (
            <div className={styles["queue-status"]}>队列加载中...</div>
          )}
        </div>
      )}

      {/* 错误提示：仅当未加载完成、当前不在加载中、且存在错误并且无可用 dataUrl 时显示 */}
      {!imageLoaded &&
        !isLoading &&
        !(useQueue ? queueImageDataUrl : currentImageDataUrl) &&
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
