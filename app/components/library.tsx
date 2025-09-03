import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import styles from "./library.module.scss";
import "./library-mobile.scss"; // 导入移动端全局样式
import { IconButton } from "./button";
import { Path } from "../constant";
import { photoCollector } from "../utils/photo-collector";
import { PhotoInfo } from "../utils/photo-storage";
import { ImageViewer } from "./image-viewer";
import { MasonryLayout } from "./masonry-layout";

// Icons
import CloseIcon from "../icons/close.svg";
import CloudSuccessIcon from "../icons/cloud-success.svg";
import ReloadIcon from "../icons/reload.svg";

export function Library() {
  const navigate = useNavigate();
  const [photos, setPhotos] = useState<PhotoInfo[]>([]);
  const [selectedImageIndex, setSelectedImageIndex] = useState<number>(0);
  const [viewerVisible, setViewerVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [useQueue, setUseQueue] = useState(true); // 默认启用队列加载
  const [isSmartCollecting, setIsSmartCollecting] = useState(false); // 智能收集状态
  const [isRetrying, setIsRetrying] = useState(false); // 重试状态
  const [retryProgress, setRetryProgress] = useState({
    current: 0,
    total: 0,
    success: 0,
    failed: 0,
  });
  const [stats, setStats] = useState({
    total: 0,
    userPhotos: 0,
    botPhotos: 0,
    sessionsWithPhotos: 0,
    lastUpdated: 0,
  });
  const [downloadStats, setDownloadStats] = useState({
    total: 0,
    downloading: 0,
    complete: 0,
    failed: 0,
  });

  // 滚动容器
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  // 防抖锁，避免同时多源触发导致重复加载
  const loadingLockRef = useRef(false);

  // 加载照片
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
      const timeoutPromise = new Promise(
        (_, reject) => setTimeout(() => reject(new Error("初始化超时")), 8000), // 减少超时时间
      );

      await Promise.race([initPromise, timeoutPromise]);

      let newPhotos: PhotoInfo[] = [];

      if (reset) {
        try {
          // 首屏只加载12张，提升加载速度
          newPhotos = await photoCollector.getPhotos({ limit: 12, offset: 0 });
        } catch (error) {
          console.warn("[Library] 常规获取失败，尝试紧急回退模式:", error);
          newPhotos = await photoCollector.getPhotosFromSessions();
        }
      } else {
        newPhotos = await photoCollector.loadMore();
      }

      // 异步获取统计信息，不阻塞UI
      photoCollector
        .getStats()
        .then((stats) => {
          setStats(stats);
        })
        .catch((error) => {
          console.warn("[Library] 获取统计信息失败:", error);
        });

      // 异步获取下载状态统计
      import("../utils/photo-storage")
        .then(({ photoStorage }) => photoStorage.getDownloadStats())
        .then((downloadStats) => {
          setDownloadStats(downloadStats);
        })
        .catch((error) => {
          console.warn("[Library] 获取下载状态统计失败:", error);
        });

      if (reset) {
        setPhotos(newPhotos);
      } else {
        setPhotos((prevPhotos) => [...prevPhotos, ...newPhotos]);
      }

      // 如果返回的数量少于限制，说明没有更多了
      const limit = reset ? 12 : 20;
      const more = newPhotos.length > 0 && newPhotos.length >= limit;
      setHasMore(more);
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
        setHasMore(false);
      }
    } finally {
      // 确保在加载结束后，无论成功失败都停止加载状态
      if (reset) {
        setIsLoading(false);
      } else {
        setTimeout(() => {
          setIsLoadingMore(false);
          loadingLockRef.current = false; // 释放加载锁
        }, 100); // 进一步减少延迟时间
      }
    }
  }, []);

  // 初始化加载
  useEffect(() => {
    loadPhotos(true);
  }, [loadPhotos]);

  // 监听新照片事件，新增的放在最前面
  useEffect(() => {
    const handleNewPhotos = (e: Event) => {
      const detail = (e as CustomEvent<PhotoInfo[]>).detail || [];
      if (Array.isArray(detail) && detail.length > 0) {
        setPhotos((prev) => {
          // 去重：按 id 去重
          const existing = new Set(prev.map((p) => p.id));
          const uniques = detail.filter((p) => !existing.has(p.id));
          if (uniques.length === 0) return prev;
          // 新的在前，保持时间倒序
          const merged = [...uniques, ...prev];
          merged.sort((a, b) => b.timestamp - a.timestamp);
          return merged;
        });
        setStats((s) => ({
          ...s,
          total: s.total + detail.length,
          lastUpdated: Date.now(),
        }));
      }
    };

    // 监听统计更新事件
    const handleStatsUpdate = (e: Event) => {
      const detail = (e as CustomEvent<any>).detail;
      if (detail) {
        setStats(detail);
      }
    };

    window.addEventListener(
      "photoCollector:newPhotos",
      handleNewPhotos as EventListener,
    );
    window.addEventListener(
      "photoCollector:statsUpdated",
      handleStatsUpdate as EventListener,
    );

    return () => {
      window.removeEventListener(
        "photoCollector:newPhotos",
        handleNewPhotos as EventListener,
      );
      window.removeEventListener(
        "photoCollector:statsUpdated",
        handleStatsUpdate as EventListener,
      );
    };
  }, []);

  // 手动刷新
  const handleRefresh = useCallback(async () => {
    await photoCollector.refresh();
    await loadPhotos(true);
  }, [loadPhotos]);

  // 智能重试失败图片
  const handleSmartRetry = useCallback(async () => {
    if (isRetrying || downloadStats.failed === 0) return;

    setIsRetrying(true);
    setRetryProgress({ current: 0, total: 0, success: 0, failed: 0 });

    try {
      console.log("[Library] 开始智能重试失败图片...");

      const { photoStorage } = await import("../utils/photo-storage");

      // 阶段1：重试下载失败的图片
      const result1 = await photoStorage.smartRetryFailedImages((progress) => {
        setRetryProgress(progress);
      });

      console.log(
        `[Library] 智能重试(阶段1-下载失败)完成: 成功 ${result1.success}, 失败 ${result1.failed}, 跳过 ${result1.skipped}`,
      );

      // 阶段2：仅重试缺失缩略图（限制数量，避免压力过大）
      console.log("[Library] 开始重试缺失缩略图...");
      const result2 = await photoStorage.retryMissingThumbnails(
        2,
        100,
        (progress) => {
          setRetryProgress(progress);
        },
      );

      console.log(
        `[Library] 智能重试(阶段2-缩略图)完成: 成功 ${result2.success}, 失败 ${result2.failed}`,
      );

      // 重试完成后刷新数据
      await loadPhotos(true);

      // 显示结果通知
      const totalRecovered = (result1.success || 0) + (result2.success || 0);
      if (totalRecovered > 0) {
        console.log(`✅ 成功恢复 ${totalRecovered} 张图片/缩略图！`);
      }
      const totalFailed = (result1.failed || 0) + (result2.failed || 0);
      if (totalFailed > 0) {
        console.warn(`⚠️ ${totalFailed} 张仍存在问题（包含图片或缩略图）`);
      }
      if (result1.skipped > 0) {
        console.log(`⏭️ 跳过 ${result1.skipped} 张不适合重试的图片`);
      }
    } catch (error) {
      console.error("[Library] 智能重试失败:", error);
    } finally {
      setIsRetrying(false);
      setRetryProgress({ current: 0, total: 0, success: 0, failed: 0 });
    }
  }, [isRetrying, downloadStats.failed, loadPhotos]);

  // 批量重试失败图片
  const handleBatchRetry = useCallback(async () => {
    if (isRetrying || downloadStats.failed === 0) return;

    setIsRetrying(true);
    setRetryProgress({ current: 0, total: 0, success: 0, failed: 0 });

    try {
      console.log("[Library] 开始批量重试失败图片...");

      const { photoStorage } = await import("../utils/photo-storage");

      const result = await photoStorage.retryFailedImages(2, 2, (progress) => {
        setRetryProgress(progress);
      });

      console.log(
        `[Library] 批量重试完成: 成功 ${result.success}, 失败 ${result.failed}`,
      );

      // 重试完成后刷新数据
      await loadPhotos(true);

      // 显示结果
      if (result.success > 0) {
        console.log(`✅ 成功恢复 ${result.success} 张图片！`);
      }
      if (result.failed > 0) {
        console.warn(`⚠️ ${result.failed} 张图片重试失败`);
      }
    } catch (error) {
      console.error("[Library] 批量重试失败:", error);
    } finally {
      setIsRetrying(false);
      setRetryProgress({ current: 0, total: 0, success: 0, failed: 0 });
    }
  }, [isRetrying, downloadStats.failed, loadPhotos]);

  // 加载更多照片（带防抖锁）
  const handleLoadMore = useCallback(async () => {
    if (loadingLockRef.current) return;
    if (isLoading || isLoadingMore || !hasMore) return;

    loadingLockRef.current = true;
    await loadPhotos(false);
  }, [isLoading, isLoadingMore, hasMore, loadPhotos]);

  const handleImageClick = useCallback(
    (index: number) => {
      setSelectedImageIndex(index);
      setViewerVisible(true);

      // 预加载邻近照片，优化预览体验
      if (photos[index]) {
        photoCollector.preloadForPreview(photos[index].id).catch((error) => {
          console.warn("[Library] 预览预加载失败:", error);
        });
      }
    },
    [photos],
  );

  const closeViewer = useCallback(() => {
    setViewerVisible(false);
    setSelectedImageIndex(0);
  }, []);

  // 移除 IntersectionObserver，因为 MasonryLayout 内部已经处理了无限滚动
  // 这样可以避免重复的 loading 提示

  return (
    <div className={styles.libraryContainer}>
      <div className="window-header" data-tauri-drag-region>
        <div className="window-header-title">
          <div className="window-header-main-title">
            图片库 {stats.total > 0 && `(${stats.total})`}
            {downloadStats.failed > 0 && !isRetrying && (
              <span
                style={{
                  color: "#ff6b6b",
                  fontSize: "12px",
                  marginLeft: "8px",
                }}
              >
                {downloadStats.failed} 失败
              </span>
            )}
          </div>
          {/* 重试进度显示在导航栏 */}
          {isRetrying ? (
            <div className={`window-header-sub-title ${styles.retryProgress}`}>
              {/* 第一行：主要信息 */}
              <div className={styles.retryMainInfo}>
                <div className={styles.retryIconWrapper}>
                  <div className={styles.retryIcon} />
                </div>
                <span className={styles.retryText}>
                  重试失败图片 ({retryProgress.current}/{retryProgress.total})
                </span>
                {retryProgress.total > 0 && (
                  <div
                    className={styles.progressBar}
                    style={{
                      width: "60px",
                      height: "3px",
                      backgroundColor: "rgba(255, 107, 107, 0.2)",
                      borderRadius: "2px",
                      overflow: "hidden",
                      flexShrink: 0,
                    }}
                  >
                    <div
                      style={{
                        width: `${
                          (retryProgress.current / retryProgress.total) * 100
                        }%`,
                        height: "100%",
                        backgroundColor: "#ff6b6b",
                        transition: "width 0.3s ease",
                      }}
                    />
                  </div>
                )}
              </div>
              {/* 结果统计，与主信息同一行右侧显示 */}
              <div className={styles.retryStats}>
                {retryProgress.success > 0 && (
                  <span style={{ color: "#4CAF50", fontSize: "10px" }}>
                    ✓ {retryProgress.success}
                  </span>
                )}
                {retryProgress.failed > 0 && (
                  <span style={{ color: "#f44336", fontSize: "10px" }}>
                    ✗ {retryProgress.failed}
                  </span>
                )}
              </div>
            </div>
          ) : stats.total > 0 ? (
            <div className="window-header-sub-title">
              来自 {stats.sessionsWithPhotos} 个对话
              {downloadStats.total > 0 && (
                <span
                  style={{ marginLeft: "8px", fontSize: "11px", opacity: 0.7 }}
                >
                  • 完成 {downloadStats.complete}/{downloadStats.total}
                  {downloadStats.downloading > 0 &&
                    ` • 下载中 ${downloadStats.downloading}`}
                </span>
              )}
            </div>
          ) : null}
        </div>
        <div className="window-actions">
          {/* 智能重试按钮 - 只在有失败图片时显示 */}
          {downloadStats.failed > 0 && (
            <div className="window-action-button">
              <IconButton
                icon={
                  isRetrying ? (
                    <div className={styles.retryIconWrapper}>
                      <div className={styles.retryIcon} />
                    </div>
                  ) : (
                    <ReloadIcon />
                  )
                }
                onClick={handleSmartRetry}
                bordered
                title={
                  isRetrying
                    ? `重试中... (${retryProgress.current}/${retryProgress.total})`
                    : `智能重试 (${downloadStats.failed} 失败)`
                }
                disabled={isRetrying || isSmartCollecting}
                style={{
                  overflow: "visible", // 允许旋转图标不被裁剪
                  color: isRetrying ? "#999" : "#ff6b6b",
                  borderColor: isRetrying ? "#999" : "#ff6b6b",
                  opacity: isRetrying ? 0.7 : 1,
                }}
              />
            </div>
          )}

          <div className="window-action-button">
            <IconButton
              icon={<CloudSuccessIcon />}
              onClick={async () => {
                try {
                  setIsSmartCollecting(true);
                  console.log("开始智能图片收集...");

                  // 1. 确保队列加载已启用
                  if (!useQueue) {
                    setUseQueue(true);
                    console.log("已启用队列加载");
                  }

                  // 2. 执行优化的重新收集
                  await photoCollector.optimizedInitialize();

                  // 3. 刷新界面
                  await handleRefresh();

                  console.log("智能图片收集完成");
                } catch (error) {
                  console.error("智能收集失败:", error);

                  // 如果优化收集失败，尝试强制收集作为备选方案
                  try {
                    console.log("尝试备选方案：强制收集...");
                    await photoCollector.refresh();
                    await handleRefresh();
                    console.log("强制收集完成");
                  } catch (fallbackError) {
                    console.error("备选方案也失败:", fallbackError);
                  }
                } finally {
                  setIsSmartCollecting(false);
                }
              }}
              bordered
              title="智能收集 (🚀)"
              disabled={isSmartCollecting || isRetrying}
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

      {/* 将滚动容器 ref 挂在真正滚动的元素上 */}
      <div className={styles.library} ref={scrollContainerRef}>
        {isLoading && !isSmartCollecting ? (
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
          <>
            {/* 智能收集进度提示 */}
            {isSmartCollecting && (
              <div className={styles.smartCollectingState}>
                <div className={styles.loadingSpinner} />
                <div className={styles.loadingText}>正在智能收集照片...</div>
              </div>
            )}

            <MasonryLayout
              photos={photos}
              onImageClick={handleImageClick}
              // 仍然传入 onLoadMore 以兼容 MasonryLayout 的内部触发
              // 通过 loadingLockRef 和 isLoadingMore 防止重复加载
              onLoadMore={handleLoadMore}
              hasMore={hasMore}
              loading={isLoadingMore}
              className={styles.photoWall}
              columns={8}
              gap={6}
              useQueue={useQueue}
              scrollRoot={scrollContainerRef.current}
            />
            {/* 移除重复的 loading 提示，MasonryLayout 内部已经有 loading 指示器 */}
          </>
        )}
      </div>

      {viewerVisible && photos.length > 0 && (
        <ImageViewer
          images={photos.map((photo) => photo.url)}
          initialIndex={selectedImageIndex}
          visible={viewerVisible}
          onClose={closeViewer}
          useQueue={useQueue}
        />
      )}
    </div>
  );
}
