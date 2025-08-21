import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './library.module.scss';
import { IconButton } from './button';
import { Path } from '../constant';
import { photoCollector } from '../utils/photo-collector';
import { ImageViewer } from './image-viewer';

// Icons
import CloseIcon from '../icons/close.svg';
import ImageIcon from '../icons/image.svg';
import ReloadIcon from '../icons/reload.svg';

export function Library() {
  const navigate = useNavigate();
  const [images, setImages] = useState<string[]>([]);
  const [selectedImageIndex, setSelectedImageIndex] = useState<number>(0);
  const [viewerVisible, setViewerVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [stats, setStats] = useState({
    totalPhotos: 0,
    userPhotos: 0,
    botPhotos: 0,
    sessionsWithPhotos: 0,
    initialized: false,
  });

  // 初始化照片收集器并定期更新
  useEffect(() => {
    const initializeAndUpdate = async () => {
      setIsLoading(true);
      
      // 初始化照片收集器
      await photoCollector.initialize();
      
      // 更新图片列表和统计信息
      const updateData = () => {
        const photoUrls = photoCollector.getAllPhotoUrls();
        const stats = photoCollector.getStats();
        setImages(photoUrls);
        setStats(stats);
      };
      
      updateData();
      setIsLoading(false);
      
      // 定期更新（较少频率，因为现在是主动收集）
      const interval = setInterval(updateData, 5000);
      
      return () => clearInterval(interval);
    };

    initializeAndUpdate();
  }, []);

  // 手动刷新
  const handleRefresh = async () => {
    setIsLoading(true);
    await photoCollector.refresh();
    const photoUrls = photoCollector.getAllPhotoUrls();
    setImages(photoUrls);
    setStats(photoCollector.getStats());
    setIsLoading(false);
  };

  const handleImageClick = (index: number) => {
    setSelectedImageIndex(index);
    setViewerVisible(true);
  };

  const closeViewer = () => {
    setViewerVisible(false);
    setSelectedImageIndex(0);
  };

  return (
    <div className={styles.libraryContainer}>
      <div className="window-header" data-tauri-drag-region>
        <div className="window-header-title">
          <div className="window-header-main-title">
            <ImageIcon className={styles.titleIcon} />
            照片 {stats.initialized && `(${stats.totalPhotos})`}
          </div>
          {stats.initialized && (
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
          <div className={styles.loadingState}>
            <div className={styles.loadingSpinner} />
            <div className={styles.loadingText}>正在收集照片...</div>
          </div>
        ) : (
          <div className={styles.photoWall}>
            {images.map((imageUrl, index) => (
              <div 
                key={`${imageUrl}-${index}`}
                className={styles.photoItem}
                onClick={() => handleImageClick(index)}
              >
                <img 
                  src={imageUrl} 
                  alt=""
                  className={styles.photo}
                  loading="lazy"
                />
              </div>
            ))}
            {images.length === 0 && !isLoading && (
              <div className={styles.emptyState}>
                <ImageIcon className={styles.emptyIcon} />
                <div className={styles.emptyText}>暂无照片</div>
                <div className={styles.emptySubText}>
                  {stats.initialized ? '当前对话中没有图片' : '正在初始化...'}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {viewerVisible && images.length > 0 && (
        <ImageViewer
          images={images}
          initialIndex={selectedImageIndex}
          visible={viewerVisible}
          onClose={closeViewer}
        />
      )}
    </div>
  );
}
