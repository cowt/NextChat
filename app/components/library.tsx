import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { useNavigate } from "react-router-dom";
import styles from "./library.module.scss";
import "./library-mobile.scss"; // 导入移动端全局样式
import { IconButton } from "./button";
import { Path } from "../constant";
import { photoCollector } from "../utils/photo-collector";
import { PhotoInfo } from "../utils/photo-storage";
import { ImageViewer } from "./image-viewer";
import { MasonryLayout } from "./masonry-layout";
import { usePhotosInfinite } from "../utils/use-photos-infinite";
import { photoService } from "../utils/photo-service";

// Icons
import CloseIcon from "../icons/close.svg";
import CloudSuccessIcon from "../icons/cloud-success.svg";
import ReloadIcon from "../icons/reload.svg";

export function Library() {
  const navigate = useNavigate();
  const [photos, setPhotos] = useState<PhotoInfo[]>([]);
  const [selectedImageIndex, setSelectedImageIndex] = useState<number>(0);
  const [viewerVisible, setViewerVisible] = useState(false);
  const { data, fetchNextPage, hasNextPage, isFetching, isFetchingNextPage } =
    usePhotosInfinite();
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

  // 聚合分页数据
  const mergedPhotos = useMemo(
    () => (data?.pages.flat() || []) as PhotoInfo[],
    [data],
  );
  useEffect(() => {
    setPhotos(mergedPhotos);
  }, [mergedPhotos]);

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
  }, []);

  // 智能重试失败图片
  const handleSmartRetry = useCallback(async () => {
    if (isRetrying || downloadStats.failed === 0) return;

    setIsRetrying(true);
    setRetryProgress({ current: 0, total: 0, success: 0, failed: 0 });

    try {
      console.log("[Library] 开始智能重试失败图片...");
      const { stage1, stage2 } = await photoService.runSmartRetry((p) =>
        setRetryProgress(p),
      );
      console.log(
        `[Library] 智能重试完成: 阶段1 成功 ${stage1.success}, 失败 ${stage1.failed}; 阶段2 成功 ${stage2.success}, 失败 ${stage2.failed}`,
      );

      // 显示结果通知
      const totalRecovered = (stage1.success || 0) + (stage2.success || 0);
      if (totalRecovered > 0) {
        console.log(`✅ 成功恢复 ${totalRecovered} 张图片/缩略图！`);
      }
      const totalFailed = (stage1.failed || 0) + (stage2.failed || 0);
      if (totalFailed > 0) {
        console.warn(`⚠️ ${totalFailed} 张仍存在问题（包含图片或缩略图）`);
      }
      if (stage1.skipped && stage1.skipped > 0) {
        console.log(`⏭️ 跳过 ${stage1.skipped} 张不适合重试的图片`);
      }
    } catch (error) {
      console.error("[Library] 智能重试失败:", error);
    } finally {
      setIsRetrying(false);
      setRetryProgress({ current: 0, total: 0, success: 0, failed: 0 });
    }
  }, [isRetrying, downloadStats.failed]);

  // 批量重试失败图片
  const handleBatchRetry = useCallback(async () => {
    if (isRetrying || downloadStats.failed === 0) return;

    setIsRetrying(true);
    setRetryProgress({ current: 0, total: 0, success: 0, failed: 0 });

    try {
      console.log("[Library] 开始批量重试失败图片...");
      const result = await photoService.runBatchRetry(2, 2, (p) =>
        setRetryProgress(p),
      );

      console.log(
        `[Library] 批量重试完成: 成功 ${result.success}, 失败 ${result.failed}`,
      );

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
  }, [isRetrying, downloadStats.failed]);

  // 加载更多照片（带防抖锁）
  const handleLoadMore = useCallback(async () => {
    if (loadingLockRef.current) return;
    if (isFetching || isFetchingNextPage || !hasNextPage) return;

    loadingLockRef.current = true;
    await fetchNextPage();
    loadingLockRef.current = false;
  }, [isFetching, isFetchingNextPage, hasNextPage, fetchNextPage]);

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
        {isFetching && photos.length === 0 && !isSmartCollecting ? (
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
              hasMore={!!hasNextPage}
              loading={isFetchingNextPage}
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
