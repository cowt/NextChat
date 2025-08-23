/**
 * 队列状态监控组件
 * 显示图片加载队列的实时状态和统计信息
 */

import React, { useState, useEffect } from "react";
import { imageQueueManager } from "../utils/image-queue-manager";
import styles from "./queue-status-monitor.module.scss";

interface QueueStatusMonitorProps {
  visible?: boolean;
  className?: string;
  showDetails?: boolean;
  autoHide?: boolean;
  autoHideDelay?: number;
}

export function QueueStatusMonitor({
  visible = true,
  className,
  showDetails = false,
  autoHide = true,
  autoHideDelay = 3000,
}: QueueStatusMonitorProps) {
  const [stats, setStats] = useState(imageQueueManager.getStats());
  const [isVisible, setIsVisible] = useState(visible);

  useEffect(() => {
    if (!visible) {
      setIsVisible(false);
      return;
    }

    setIsVisible(true);

    // 更新统计信息
    const updateStats = () => {
      setStats(imageQueueManager.getStats());
    };

    // 初始更新
    updateStats();

    // 定期更新统计信息
    const interval = setInterval(updateStats, 500);

    // 自动隐藏逻辑
    let hideTimer: NodeJS.Timeout | null = null;
    if (autoHide && stats.queueLength === 0 && stats.currentlyLoading === 0) {
      hideTimer = setTimeout(() => {
        setIsVisible(false);
      }, autoHideDelay);
    }

    return () => {
      clearInterval(interval);
      if (hideTimer) {
        clearTimeout(hideTimer);
      }
    };
  }, [
    visible,
    autoHide,
    autoHideDelay,
    stats.queueLength,
    stats.currentlyLoading,
  ]);

  if (!isVisible) return null;

  const hasActivity = stats.queueLength > 0 || stats.currentlyLoading > 0;
  const progress =
    stats.totalQueued > 0
      ? Math.round((stats.totalLoaded / stats.totalQueued) * 100)
      : 0;

  return (
    <div className={`${styles.monitor} ${className || ""}`}>
      <div className={styles.header}>
        <div className={styles.title}>
          <div className={styles.icon}>{hasActivity ? "🔄" : "✅"}</div>
          <span>图片加载队列</span>
        </div>
        {hasActivity && (
          <div className={styles.progress}>
            <div className={styles.progressBar}>
              <div
                className={styles.progressFill}
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className={styles.progressText}>{progress}%</span>
          </div>
        )}
      </div>

      {showDetails && (
        <div className={styles.details}>
          <div className={styles.statRow}>
            <span className={styles.statLabel}>队列中:</span>
            <span className={styles.statValue}>{stats.queueLength}</span>
          </div>
          <div className={styles.statRow}>
            <span className={styles.statLabel}>加载中:</span>
            <span className={styles.statValue}>{stats.currentlyLoading}</span>
          </div>
          <div className={styles.statRow}>
            <span className={styles.statLabel}>已完成:</span>
            <span className={styles.statValue}>{stats.totalLoaded}</span>
          </div>
          <div className={styles.statRow}>
            <span className={styles.statLabel}>失败:</span>
            <span className={styles.statValue}>{stats.totalFailed}</span>
          </div>
          {stats.averageLoadTime > 0 && (
            <div className={styles.statRow}>
              <span className={styles.statLabel}>平均耗时:</span>
              <span className={styles.statValue}>
                {stats.averageLoadTime}ms
              </span>
            </div>
          )}
        </div>
      )}

      {hasActivity && (
        <div className={styles.status}>
          {stats.currentlyLoading > 0 && (
            <span className={styles.loading}>
              正在加载 {stats.currentlyLoading} 张图片...
            </span>
          )}
          {stats.queueLength > 0 && (
            <span className={styles.queued}>
              队列中还有 {stats.queueLength} 张图片
            </span>
          )}
        </div>
      )}

      {!hasActivity && stats.totalLoaded > 0 && (
        <div className={styles.completed}>
          已完成 {stats.totalLoaded} 张图片的加载
        </div>
      )}
    </div>
  );
}

export default QueueStatusMonitor;
