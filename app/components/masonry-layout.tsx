/**
 * 瀑布流布局组件
 * 根据图片尺寸智能排布，支持无限滚动
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import styles from "./masonry-layout.module.scss";
import { PhotoInfo } from "../utils/photo-storage";
import HighResImage from "./high-res-image";

interface MasonryLayoutProps {
  photos: PhotoInfo[];
  onImageClick: (index: number) => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  loading?: boolean;
  columns?: number;
  gap?: number;
  className?: string;
}

interface PhotoItem extends PhotoInfo {
  calculatedHeight: number;
  column: number;
  top: number;
}

export function MasonryLayout({
  photos,
  onImageClick,
  onLoadMore,
  hasMore = false,
  loading = false,
  columns = 3,
  gap = 8,
  className,
}: MasonryLayoutProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [layoutedPhotos, setLayoutedPhotos] = useState<PhotoItem[]>([]);
  const [totalHeight, setTotalHeight] = useState<number>(0);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // 根据容器宽度动态调整列数（充分利用空间）
  const dynamicColumns = useMemo(() => {
    if (containerWidth === 0) return columns;

    // 优化的断点设置，更好地利用宽屏空间
    if (containerWidth < 400) return 2;
    if (containerWidth < 600) return 3;
    if (containerWidth < 800) return 4;
    if (containerWidth < 1000) return 5;
    if (containerWidth < 1200) return 6;
    if (containerWidth < 1400) return 7;
    if (containerWidth < 1600) return 8;
    return Math.min(Math.floor(containerWidth / 180), 10); // 动态计算，最多10列
  }, [containerWidth, columns]);

  // 计算每列的宽度（充分利用容器宽度）
  const columnWidth = useMemo(() => {
    if (containerWidth === 0) return 200;
    const baseWidth = Math.floor(
      (containerWidth - gap * (dynamicColumns - 1)) / dynamicColumns,
    );
    return baseWidth; // 使用全部宽度
  }, [containerWidth, dynamicColumns, gap]);

  // 监听容器尺寸变化
  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // 计算图片布局
  const calculateLayout = useCallback(
    (photos: PhotoInfo[]): PhotoItem[] => {
      if (photos.length === 0 || columnWidth === 0) return [];

      const columnHeights = new Array(dynamicColumns).fill(0);
      const layouted: PhotoItem[] = [];

      photos.forEach((photo, index) => {
        // 计算图片显示高度
        let calculatedHeight = columnWidth; // 默认正方形

        if (photo.width && photo.height) {
          // 按比例缩放
          calculatedHeight = Math.round(
            (photo.height / photo.width) * columnWidth,
          );
          // 限制最小和最大高度
          calculatedHeight = Math.max(
            100,
            Math.min(calculatedHeight, columnWidth * 2),
          );
        }

        // 找到最短的列
        const shortestColumnIndex = columnHeights.indexOf(
          Math.min(...columnHeights),
        );
        const column = shortestColumnIndex;
        const top = columnHeights[column];

        layouted.push({
          ...photo,
          calculatedHeight,
          column,
          top,
        });

        // 更新列高度
        columnHeights[column] += calculatedHeight + gap;
      });

      setTotalHeight(Math.max(...columnHeights));
      return layouted;
    },
    [columnWidth, dynamicColumns, gap],
  );

  // 重新计算布局
  useEffect(() => {
    const layouted = calculateLayout(photos);
    setLayoutedPhotos(layouted);
  }, [photos, calculateLayout]);

  // 设置无限滚动观察者
  useEffect(() => {
    if (!loadMoreRef.current || !onLoadMore || !hasMore) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loading) {
          onLoadMore();
        }
      },
      {
        threshold: 0.1,
        rootMargin: "200px 0px", // 提前200px触发，提高响应速度
      },
    );

    observerRef.current.observe(loadMoreRef.current);

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [onLoadMore, hasMore, loading]);

  const handleImageClick = useCallback(
    (photo: PhotoItem) => {
      const originalIndex = photos.findIndex((p) => p.id === photo.id);
      if (originalIndex !== -1) {
        onImageClick(originalIndex);
      }
    },
    [photos, onImageClick],
  );

  const renderPhoto = useCallback(
    (photo: PhotoItem, index: number) => {
      const style: React.CSSProperties = {
        position: "absolute",
        left: photo.column * (columnWidth + gap),
        top: photo.top,
        width: columnWidth,
        height: photo.calculatedHeight,
        // 逐帧错峰进入动画
        animationDelay: `${Math.min(index, 12) * 40}ms`,
      };

      return (
        <div
          className={styles.photoItem}
          style={style}
          onClick={() => handleImageClick(photo)}
          data-photo-id={photo.id}
        >
          <HighResImage
            src={photo.url}
            thumbnail={photo.thumbUrl || photo.thumbnail}
            alt=""
            className={styles.photo}
            loading="lazy"
            maxSize={{
              width: columnWidth * 2,
              height: photo.calculatedHeight * 2,
            }}
            quality={0.7} // 进一步降低质量，提升加载速度
            // 优化属性
            decoding="async"
            fetchPriority="low"
            previewMode={false} // 网格中不预览，只显示缩略图
          />

          {/* 图片信息 */}
          {photo.width && photo.height && (
            <div className={styles.photoInfo}>
              <span className={styles.dimensions}>
                {photo.width} × {photo.height}
              </span>
              {photo.originalUrls && photo.originalUrls.length > 1 && (
                <span className={styles.duplicateIndicator}>
                  +{photo.originalUrls.length - 1}
                </span>
              )}
            </div>
          )}
        </div>
      );
    },
    [columnWidth, gap, handleImageClick],
  );

  return (
    <div
      className={`${styles.masonryContainer} ${className || ""}`}
      ref={containerRef}
    >
      <div
        className={styles.masonryGrid}
        style={{
          position: "relative",
          height: totalHeight,
        }}
      >
        {layoutedPhotos.map((p, idx) => (
          <React.Fragment key={`${p.id}-${idx}`}>
            {renderPhoto(p, idx)}
          </React.Fragment>
        ))}
      </div>

      {/* 加载更多触发器 */}
      {hasMore && (
        <div ref={loadMoreRef} className={styles.loadMoreTrigger}>
          {loading && (
            <div className={styles.loadingIndicator}>
              <div className={styles.spinner} />
              <span>正在加载...</span>
            </div>
          )}
        </div>
      )}

      {/* 空状态 */}
      {photos.length === 0 && !loading && (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>📷</div>
          <div className={styles.emptyText}>暂无照片</div>
          <div className={styles.emptySubText}>
            开始对话后，您的图片将会显示在这里
          </div>
        </div>
      )}
    </div>
  );
}
