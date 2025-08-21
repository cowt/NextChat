/**
 * 图片管理器监控面板
 * 用于查看和管理图片缓存状态
 */

import React, { useState, useEffect } from 'react';
import { imageManager } from '../utils/image-manager';
import styles from './image-manager-panel.module.scss';
import { IconButton } from './button';
import DeleteIcon from '../icons/delete.svg';
import RefreshIcon from '../icons/reload.svg';

interface ImageManagerPanelProps {
  visible: boolean;
  onClose: () => void;
}

export function ImageManagerPanel({ visible, onClose }: ImageManagerPanelProps) {
  const [stats, setStats] = useState({
    totalCount: 0,
    totalSize: 0,
    loadingCount: 0,
    errorCount: 0,
    maxCacheSize: 0,
  });

  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (visible) {
      const updateStats = () => {
        setStats(imageManager.getCacheStats());
      };

      updateStats();
      const interval = setInterval(updateStats, 1000);

      return () => clearInterval(interval);
    }
  }, [visible, refreshKey]);

  const handleClearCache = () => {
    imageManager.clearCache();
    setRefreshKey(prev => prev + 1);
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getUsagePercentage = () => {
    return stats.maxCacheSize > 0 ? (stats.totalCount / stats.maxCacheSize) * 100 : 0;
  };

  if (!visible) return null;

  return (
    <div className={styles.overlay}>
      <div className={styles.panel}>
        <div className={styles.header}>
          <h3>图片缓存管理</h3>
          <IconButton
            icon={<RefreshIcon />}
            onClick={() => setRefreshKey(prev => prev + 1)}
            title="刷新"
          />
        </div>

        <div className={styles.content}>
          <div className={styles.stats}>
            <div className={styles.statItem}>
              <span className={styles.label}>缓存总数</span>
              <span className={styles.value}>
                {stats.totalCount} / {stats.maxCacheSize}
              </span>
            </div>

            <div className={styles.statItem}>
              <span className={styles.label}>缓存大小</span>
              <span className={styles.value}>
                {formatBytes(stats.totalSize)}
              </span>
            </div>

            <div className={styles.statItem}>
              <span className={styles.label}>正在加载</span>
              <span className={styles.value}>
                {stats.loadingCount}
              </span>
            </div>

            <div className={styles.statItem}>
              <span className={styles.label}>加载失败</span>
              <span className={styles.value}>
                {stats.errorCount}
              </span>
            </div>
          </div>

          <div className={styles.usage}>
            <div className={styles.usageLabel}>
              缓存使用率: {getUsagePercentage().toFixed(1)}%
            </div>
            <div className={styles.usageBar}>
              <div 
                className={styles.usageProgress}
                style={{ width: `${getUsagePercentage()}%` }}
              />
            </div>
          </div>

          <div className={styles.actions}>
            <IconButton
              icon={<DeleteIcon />}
              text="清空缓存"
              onClick={handleClearCache}
              type="danger"
            />
          </div>

          <div className={styles.info}>
            <h4>说明</h4>
            <ul>
              <li>图片缓存会自动管理，无需手动干预</li>
              <li>缓存会在30分钟后自动过期</li>
              <li>相同图片不会重复加载</li>
              <li>大图片会自动压缩到256KB以下</li>
              <li>支持懒加载和预加载</li>
            </ul>
          </div>
        </div>

        <div className={styles.footer}>
          <button className={styles.closeButton} onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
