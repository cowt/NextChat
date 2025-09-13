import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import { useImage } from "../utils/use-image";
import { imageQueueManager } from "../utils/image-queue-manager";
import { imageManager } from "../utils/image-manager";
import Lightbox from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import Fullscreen from "yet-another-react-lightbox/plugins/fullscreen";
import Counter from "yet-another-react-lightbox/plugins/counter";
import Download from "yet-another-react-lightbox/plugins/download";

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

// 顶层自定义 Hook：管理图片导航（必须在组件外声明，遵循 Hooks 规则）
function useImageNavigation(opts: {
  images: string[];
  initialIndex: number;
  onImageChange?: (index: number) => void;
  enabled: boolean;
}) {
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
  // 镜像功能已移除
  const prevIndexRef = useRef<number>(currentIndex);
  const lastSrcRef = useRef<string | undefined>(undefined);

  // 旧的缩放/拖拽 Hook 已移除，由 Lightbox 插件处理

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

  // 仅在从隐藏到显示时同步索引（缩放由 Lightbox 接管）
  const prevVisibleRef = useRef<boolean>(visible);
  useEffect(() => {
    if (visible && !prevVisibleRef.current) {
      setCurrentIndex(initialIndex);
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
    // 依赖中包含加载中的状态，避免 hooks/exhaustive-deps 警告
    queueImageLoading,
    currentImageLoading,
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
  }, [
    useQueue,
    queueImageBlob,
    currentImageBlob,
    queueImageDataUrl,
    currentImageDataUrl,
  ]);

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
        if (
          activeObjectUrlRef.current &&
          activeObjectUrlRef.current !== renderSrc
        ) {
          try {
            URL.revokeObjectURL(activeObjectUrlRef.current);
          } catch {}
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
    return () => {
      cancelled = true;
    };
  }, [renderSrc]);

  // 键盘下载快捷键（Lightbox 已内置方向键/ESC 行为）
  useEffect(() => {
    if (!visible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === "s" || e.key === "S") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        downloadCurrentImage();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [visible, downloadCurrentImage]);

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

  // 兜底：如果浏览器已缓存完成但未触发 onLoad（迁移后主要通过预加载处理）
  useEffect(() => {
    if (!visible) return;
    const expectedSrc = useQueue
      ? queueImageDataUrl
      : currentImageDataUrl ||
        (currentImage && imageManager.getCacheStatus(currentImage)?.dataUrl) ||
        undefined;
    if (expectedSrc === displaySrc && imageLoaded) {
      settleLoaded(true);
    }
  }, [
    visible,
    useQueue,
    queueImageDataUrl,
    currentImageDataUrl,
    currentImage,
    currentIndex,
    displaySrc,
    imageLoaded,
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

  // 触控左右切换交由 Lightbox 处理，这里不再额外处理

  // slides 保持稳定引用，避免索引变化导致 Lightbox 重建从而闪烁
  const slides = useMemo(() => {
    return images.map((url) => ({ src: getProxiedImageUrl(url) }));
  }, [images]);

  const plugins = useMemo(() => [Zoom, Fullscreen, Counter, Download], []);
  // Zoom 插件参数：开启滚轮/触控/键盘无级缩放
  const zoomOptions = useMemo(
    () => ({
      maxZoomPixelRatio: 4,
      zoomInMultiplier: 1.2,
      doubleTapDelay: 250,
      doubleClickDelay: 250,
      doubleClickMaxStops: 4,
      keyboardMoveDistance: 40,
      wheelZoomDistanceFactor: 80,
      pinchZoomDistanceFactor: 60,
      scrollToZoom: true,
    }),
    [],
  );
  const toolbarButtons = useMemo(
    () => [
      // 下载按钮改用官方 Download 插件提供的按钮与图标
      showQueueStatus && useQueue && isLoading ? (
        <div key="queue" style={{ marginRight: 8, fontSize: 12 }}>
          队列加载中...
        </div>
      ) : null,
      "close",
    ],
    [showQueueStatus, useQueue, isLoading],
  );
  const onHandlers = useMemo(
    () => ({
      view: ({ index }: any) => {
        if (typeof index === "number" && index !== currentIndex) {
          // 避免在渲染阶段直接 setState 引发深度更新
          requestAnimationFrame(() => {
            setCurrentIndex(index);
            onImageChange?.(index);
          });
        }
      },
    }),
    [currentIndex, onImageChange, setCurrentIndex],
  );

  // 镜像效果逻辑已移除

  // 工具栏位置移动到底部中间
  const lightboxStyles = useMemo(
    () => ({
      toolbar: {
        top: "auto",
        bottom: 24,
        left: "50%",
        right: "auto",
        transform: "translateX(-50%)",
        backgroundColor: "rgba(0,0,0,0)",
        padding: "6px 6px",
        borderRadius: 8,
      },
      icon: {
        transform: "scale(0.6)",
        transformOrigin: "center",
      },
      // 给容器与每个 slide 添加对称内边距，修复左右间距不一致
      container: {
        paddingLeft: 24,
        paddingRight: 8,
        backgroundColor: "rgba(0,0,0,0.8)",
      },
      slide: {
        paddingLeft: 12,
        paddingRight: 12,
        paddingBottom: 64, // 为工具栏预留空间，避免遮挡图片底部
      },
    }),
    [],
  );

  // 增加拖动：为内部图片开启原生拖拽（拖出到其他应用/新标签）
  useEffect(() => {
    if (!visible) return;
    const imgEl = document.querySelector(
      ".yarl__slide_image img",
    ) as HTMLImageElement | null;
    if (!imgEl) return;
    imgEl.setAttribute("draggable", "true");
    const handleDragStart = (e: DragEvent) => {
      const src =
        (displaySrc as string) ||
        (currentImage ? getProxiedImageUrl(currentImage) : "");
      try {
        if (src && e.dataTransfer) {
          e.dataTransfer.effectAllowed = "copy";
          e.dataTransfer.setData("text/uri-list", src);
          e.dataTransfer.setData("text/plain", src);
        }
      } catch {}
    };
    imgEl.addEventListener("dragstart", handleDragStart);
    return () => imgEl.removeEventListener("dragstart", handleDragStart);
  }, [visible, displaySrc, currentImage]);

  return (
    <Lightbox
      open={visible}
      close={onClose}
      slides={slides}
      index={currentIndex}
      carousel={{ finite: images.length <= 1 }}
      animation={{ fade: 0 }}
      styles={lightboxStyles as any}
      plugins={plugins}
      toolbar={{ buttons: toolbarButtons as any }}
      on={onHandlers}
      zoom={zoomOptions as any}
    />
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
