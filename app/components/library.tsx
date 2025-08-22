import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import styles from "./library.module.scss";
import { IconButton } from "./button";
import { Path } from "../constant";
import { photoCollector } from "../utils/photo-collector";
import { PhotoInfo } from "../utils/photo-storage";
import { ImageViewer } from "./image-viewer";
import { MasonryLayout } from "./masonry-layout";

// Icons
import CloseIcon from "../icons/close.svg";
import ImageIcon from "../icons/image.svg";
import ReloadIcon from "../icons/reload.svg";

export function Library() {
  const navigate = useNavigate();
  const [photos, setPhotos] = useState<PhotoInfo[]>([]);
  const [selectedImageIndex, setSelectedImageIndex] = useState<number>(0);
  const [viewerVisible, setViewerVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [stats, setStats] = useState({
    total: 0,
    userPhotos: 0,
    botPhotos: 0,
    sessionsWithPhotos: 0,
    lastUpdated: 0,
  });

  // 加载第一页照片
  const loadPhotos = useCallback(async (reset = false) => {
    try {
      if (reset) {
        setIsLoading(true);
        photoCollector.resetPagination();
      } else {
        setIsLoadingMore(true);
      }

      // 设置超时机制，避免无限等待
      const initPromise = photoCollector.initialize();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("初始化超时")), 10000),
      );

      await Promise.race([initPromise, timeoutPromise]);

      let newPhotos: PhotoInfo[] = [];

      if (reset) {
        try {
          newPhotos = await photoCollector.getPhotos({ limit: 50, offset: 0 });
        } catch (error) {
          console.warn("[Library] 常规获取失败，尝试紧急回退模式:", error);
          newPhotos = await photoCollector.getPhotosFromSessions();
        }
      } else {
        newPhotos = await photoCollector.loadMore();
      }

      const stats = await photoCollector.getStats();

      if (reset) {
        setPhotos(newPhotos);
      } else {
        setPhotos((prevPhotos) => [...prevPhotos, ...newPhotos]);
      }

      setStats(stats);
      setHasMore(newPhotos.length === 50); // 如果返回的数量少于限制，说明没有更多了
    } catch (error) {
      console.error("[Library] 加载照片失败:", error);

      // 即使失败也要停止加载状态
      if (reset) {
        setPhotos([]);
        setStats({
          total: 0,
          userPhotos: 0,
          botPhotos: 0,
          sessionsWithPhotos: 0,
          lastUpdated: Date.now(),
        });
      }
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, []);

  // 初始化加载
  useEffect(() => {
    loadPhotos(true);
  }, [loadPhotos]);

  // 手动刷新
  const handleRefresh = useCallback(async () => {
    await photoCollector.refresh();
    await loadPhotos(true);
  }, [loadPhotos]);

  // 加载更多照片
  const handleLoadMore = useCallback(async () => {
    if (!isLoadingMore && hasMore) {
      await loadPhotos(false);
    }
  }, [isLoadingMore, hasMore, loadPhotos]);

  const handleImageClick = useCallback((index: number) => {
    setSelectedImageIndex(index);
    setViewerVisible(true);
  }, []);

  const closeViewer = useCallback(() => {
    setViewerVisible(false);
    setSelectedImageIndex(0);
  }, []);

  return (
    <div className={styles.libraryContainer}>
      <div className="window-header" data-tauri-drag-region>
        <div className="window-header-title">
          <div className="window-header-main-title">
            <ImageIcon className={styles.titleIcon} />
            照片 {stats.total > 0 && `(${stats.total})`}
          </div>
          {stats.total > 0 && (
            <div className="window-header-sub-title">
              来自 {stats.sessionsWithPhotos} 个对话
            </div>
          )}
        </div>
        <div className="window-actions">
          <div className="window-action-button">
            <IconButton
              icon={<ReloadIcon />}
              onClick={handleRefresh}
              bordered
              title="刷新"
              disabled={isLoading}
            />
          </div>
          <div className="window-action-button">
            <IconButton
              icon={<CloseIcon />}
              onClick={() => navigate(Path.Home)}
              bordered
              title="返回"
            />
          </div>
        </div>
      </div>

      <div className={styles.library}>
        {isLoading ? (
          <>
            <div className={styles.loadingState}>
              <div className={styles.loadingSpinner} />
              <div className={styles.loadingText}>正在收集照片...</div>
            </div>
            {/* 瀑布流骨架屏 */}
            <div className={styles.skeletonGrid}>
              {Array.from({ length: 24 }).map((_, i) => (
                <div key={i} className={styles.skeletonItem} />
              ))}
            </div>
          </>
        ) : (
          <MasonryLayout
            photos={photos}
            onImageClick={handleImageClick}
            onLoadMore={handleLoadMore}
            hasMore={hasMore}
            loading={isLoadingMore}
            className={styles.photoWall}
            columns={8}
            gap={6}
          />
        )}
      </div>

      {viewerVisible && photos.length > 0 && (
        <ImageViewer
          images={photos.map((photo) => photo.url)}
          initialIndex={selectedImageIndex}
          visible={viewerVisible}
          onClose={closeViewer}
        />
      )}
    </div>
  );
}
