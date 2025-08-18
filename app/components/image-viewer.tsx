import React, { useState, useEffect, useCallback, useRef } from "react";
import { useMobileScreen } from "../utils";
import styles from "./image-viewer.module.scss";
import clsx from "clsx";

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
}

export function ImageViewer({
  images,
  initialIndex = 0,
  visible,
  onClose,
  className,
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

  const currentImage = images[currentIndex];
  const hasMultipleImages = images.length > 1;

  // 重置状态当组件变为可见时
  useEffect(() => {
    if (visible) {
      setCurrentIndex(initialIndex);
      setImageLoaded(false);
      setIsLoading(true);
      setScale(1);
      setOffset({ x: 0, y: 0 });
    }
  }, [visible, initialIndex]);

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
  }, [visible, currentIndex, images]);

  const goToPrevious = useCallback(() => {
    if (!hasMultipleImages) return;
    setImageLoaded(false);
    setIsLoading(true);
    setCurrentIndex((prev) => (prev === 0 ? images.length - 1 : prev - 1));
  }, [hasMultipleImages, images.length]);

  const goToNext = useCallback(() => {
    if (!hasMultipleImages) return;
    setImageLoaded(false);
    setIsLoading(true);
    setCurrentIndex((prev) => (prev === images.length - 1 ? 0 : prev + 1));
  }, [hasMultipleImages, images.length]);

  const downloadCurrentImage = useCallback(async () => {
    if (!currentImage) return;

    try {
      const response = await fetch(currentImage);
      const blob = await response.blob();
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
  }, [currentImage, currentIndex]);

  const handleImageLoad = () => {
    setIsLoading(false);
    setImageLoaded(true);
  };

  const handleImageError = () => {
    setIsLoading(false);
    setImageLoaded(false);
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
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

  const handleWheel: React.WheelEventHandler<HTMLDivElement> = (e) => {
    if (!visible) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.2 : 0.2;
    setScale((s) => clamp(Number((s + delta).toFixed(2)), 0.5, 4));
  };

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
      onWheel={handleWheel}
      ref={containerRef}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
    >
      {/* 顶部信息栏移除，避免双层结构 */}

      {/* 图片容器 */}
      <div className={styles["image-container"]}>
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

        {isLoading && (
          <div className={styles["loading-placeholder"]}>
            <div className={styles["loading-spinner"]} />
          </div>
        )}
        <img
          ref={imageRef}
          src={currentImage}
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
        />

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
      </div>

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
