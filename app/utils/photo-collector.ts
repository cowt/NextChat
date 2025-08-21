/**
 * 照片墙主动收集器
 * 负责从所有对话中主动收集图片并预加载到照片墙
 */

import { useChatStore } from '../store/chat';
import { getMessageImages } from '../utils';
import { imageManager } from './image-manager';

export interface PhotoInfo {
  url: string;
  sessionId: string;
  sessionTitle: string;
  messageId: string;
  timestamp: number;
  isUser: boolean; // 是否为用户消息
}

class PhotoCollector {
  private photos = new Map<string, PhotoInfo>();
  private initialized = false;
  private collectingInProgress = false;

  /**
   * 初始化 - 首次主动检索全部对话列表的图片
   */
  async initialize(): Promise<void> {
    if (this.initialized || this.collectingInProgress) return;
    
    this.collectingInProgress = true;

    try {
      const chatStore = useChatStore.getState();
      const allSessions = chatStore.sessions;
      
      // 遍历所有会话
      for (const session of allSessions) {
        const sessionImages = this.collectSessionImages(session);
        
        // 将图片添加到收集器
        sessionImages.forEach(photo => {
          if (!this.photos.has(photo.url)) {
            this.photos.set(photo.url, photo);
          }
        });
      }
      
      // 开始预加载图片
      await this.preloadImages();
      
      this.initialized = true;
    } catch (error) {
      console.error('[PhotoCollector] 初始化失败:', error);
    } finally {
      this.collectingInProgress = false;
    }
  }

  /**
   * 增强的图片提取函数
   */
  private extractMessageImages(message: any): string[] {
    const urls: string[] = [];
    
    // 使用原始的getMessageImages函数
    const standardUrls = getMessageImages(message);
    urls.push(...standardUrls);
    
    // 额外检查消息内容中可能存在的图片URL模式
    if (typeof message.content === 'string') {
      // 检查字符串中的图片URL
      const urlMatches = message.content.match(/(https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp|bmp|svg))/gi);
      if (urlMatches) {
        urls.push(...urlMatches);
      }
      
      // 检查data URL
      const dataUrlMatches = message.content.match(/data:image\/[^;]+;base64,[^"\s]+/gi);
      if (dataUrlMatches) {
        urls.push(...dataUrlMatches);
      }
    }
    
    // 检查附件中的图片
    if (message.attachImages && Array.isArray(message.attachImages)) {
      urls.push(...message.attachImages);
    }
    
    // 去重并过滤空值
    return [...new Set(urls)].filter(url => url && url.trim());
  }

  /**
   * 收集单个会话中的图片
   */
  private collectSessionImages(session: any): PhotoInfo[] {
    const photos: PhotoInfo[] = [];
    
    session.messages.forEach((message: any) => {
      const imageUrls = this.extractMessageImages(message);
      
      imageUrls.forEach(url => {
        if (url && url.trim()) {
          const photo = {
            url: url.trim(),
            sessionId: session.id,
            sessionTitle: session.topic || '未命名对话',
            messageId: message.id,
            timestamp: new Date(message.date).getTime(),
            isUser: message.role === 'user',
          };
          photos.push(photo);
        }
      });
    });

    return photos;
  }

  /**
   * 预加载所有收集到的图片
   */
  private async preloadImages(): Promise<void> {
    const imageUrls = Array.from(this.photos.keys());
    
    if (imageUrls.length === 0) return;
    
    // 批量预加载，每批10张图片
    const batchSize = 10;
    for (let i = 0; i < imageUrls.length; i += batchSize) {
      const batch = imageUrls.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async url => {
        try {
          await imageManager.loadImage(url, { compress: true });
        } catch (error) {
          // 忽略预加载失败
        }
      });
      
      await Promise.allSettled(batchPromises);
      
      // 每批之间稍微延迟，避免过度占用资源
      if (i + batchSize < imageUrls.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  }

  /**
   * 新对话有新照片时主动加入
   */
  onNewMessage(message: any, session: any): void {
    if (!this.initialized) return;
    
    const imageUrls = this.extractMessageImages(message);
    
    if (imageUrls.length === 0) return;
    
    imageUrls.forEach(url => {
      if (url && url.trim() && !this.photos.has(url.trim())) {
        const photo: PhotoInfo = {
          url: url.trim(),
          sessionId: session.id,
          sessionTitle: session.topic || '未命名对话',
          messageId: message.id,
          timestamp: new Date(message.date).getTime(),
          isUser: message.role === 'user',
        };
        
        this.photos.set(photo.url, photo);
        
        // 立即预加载新图片
        this.preloadSingleImage(photo.url);
      }
    });
  }

  /**
   * 预加载单张图片
   */
  private async preloadSingleImage(url: string): Promise<void> {
    try {
      await imageManager.loadImage(url, { compress: true });
    } catch (error) {
      // 忽略预加载失败
    }
  }

  /**
   * 获取所有收集到的图片信息
   */
  getAllPhotos(): PhotoInfo[] {
    return Array.from(this.photos.values())
      .sort((a, b) => b.timestamp - a.timestamp); // 按时间倒序
  }

  /**
   * 获取所有图片URL（用于照片墙显示）
   */
  getAllPhotoUrls(): string[] {
    return this.getAllPhotos().map(photo => photo.url);
  }

  /**
   * 根据会话筛选图片
   */
  getPhotosBySession(sessionId: string): PhotoInfo[] {
    return this.getAllPhotos().filter(photo => photo.sessionId === sessionId);
  }

  /**
   * 获取统计信息
   */
  getStats() {
    const allPhotos = this.getAllPhotos();
    const userPhotos = allPhotos.filter(p => p.isUser);
    const botPhotos = allPhotos.filter(p => !p.isUser);
    const sessions = new Set(allPhotos.map(p => p.sessionId));
    
    return {
      totalPhotos: allPhotos.length,
      userPhotos: userPhotos.length,
      botPhotos: botPhotos.length,
      sessionsWithPhotos: sessions.size,
      initialized: this.initialized,
    };
  }

  /**
   * 强制重新收集所有图片
   */
  async refresh(): Promise<void> {
    this.initialized = false;
    this.photos.clear();
    await this.initialize();
  }
}

// 全局单例
export const photoCollector = new PhotoCollector();
