/**
 * 照片墙主动收集器
 * 负责从所有对话中主动收集图片并预加载到照片墙
 * 使用 IndexedDB 进行持久化存储
 */

import { useChatStore } from "../store/chat";
import { getMessageImages } from "../utils";
import { imageManager } from "./image-manager";
import { photoStorage, PhotoInfo, PhotoQuery } from "./photo-storage";

class PhotoCollector {
  private photos = new Map<string, PhotoInfo>();
  private initialized = false;
  private collectingInProgress = false;
  private currentPage = 0;
  private readonly PAGE_SIZE = 50;

  /**
   * 初始化 - 首次主动检索全部对话列表的图片
   */
  async initialize(): Promise<void> {
    if (this.initialized || this.collectingInProgress) return;

    this.collectingInProgress = true;

    try {
      // 初始化存储
      await photoStorage.initialize();

      // 尝试从现有数据库加载
      const existingPhotos = await photoStorage.getPhotos({
        limit: 1,
        offset: 0,
      });

      if (existingPhotos.length > 0) {
        // 如果有现有数据，直接加载
        await this.loadPage(0);
        this.initialized = true;
        return;
      }

      // 如果没有照片，尝试修复索引
      await photoStorage.repairIndex();

      // 再次检查修复后的结果
      const repairedPhotos = await photoStorage.getPhotos({
        limit: 1,
        offset: 0,
      });

      if (repairedPhotos.length > 0) {
        await this.loadPage(0);
        this.initialized = true;
        return;
      }

      // 如果没有现有数据，尝试收集
      try {
        const chatStore = useChatStore.getState();
        const allSessions = chatStore.sessions || [];

        if (allSessions.length === 0) {
          this.initialized = true;
          return;
        }

        // 批量收集所有会话的图片
        const allPhotos: Omit<PhotoInfo, "id">[] = [];

        for (const session of allSessions) {
          try {
            const sessionImages = this.collectSessionImages(session);
            allPhotos.push(...sessionImages);
          } catch (sessionError) {
            console.warn(
              "[PhotoCollector] 处理会话失败:",
              session.id,
              sessionError,
            );
          }
        }

        // 批量保存到 IndexedDB
        if (allPhotos.length > 0) {
          await photoStorage.addPhotos(allPhotos);
        }

        // 记录收集时间
        await photoStorage.setMetadata("lastCollectionTime", Date.now());

        // 加载第一页数据到内存
        await this.loadPage(0);
      } catch (chatStoreError) {
        console.error("[PhotoCollector] 获取会话数据失败:", chatStoreError);
        // 即使获取会话失败，也标记为已初始化，避免无限加载
      }

      this.initialized = true;
    } catch (error) {
      console.error("[PhotoCollector] 初始化失败:", error);
      this.initialized = true; // 即使失败也标记为已初始化，避免无限重试
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
    if (typeof message.content === "string") {
      // 检查字符串中的图片URL
      const urlMatches = message.content.match(
        /(https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp|bmp|svg))/gi,
      );
      if (urlMatches) {
        urls.push(...urlMatches);
      }

      // 检查data URL
      const dataUrlMatches = message.content.match(
        /data:image\/[^;]+;base64,[^"\s]+/gi,
      );
      if (dataUrlMatches) {
        urls.push(...dataUrlMatches);
      }
    }

    // 检查附件中的图片
    if (message.attachImages && Array.isArray(message.attachImages)) {
      urls.push(...message.attachImages);
    }

    // 去重并过滤空值
    return [...new Set(urls)].filter((url) => url && url.trim());
  }

  /**
   * 收集单个会话中的图片
   */
  private collectSessionImages(session: any): Omit<PhotoInfo, "id">[] {
    const photos: Omit<PhotoInfo, "id">[] = [];

    session.messages.forEach((message: any) => {
      const imageUrls = this.extractMessageImages(message);

      imageUrls.forEach((url) => {
        if (url && url.trim()) {
          const photo: Omit<PhotoInfo, "id"> = {
            url: url.trim(),
            sessionId: session.id,
            sessionTitle: session.topic || "未命名对话",
            messageId: message.id,
            timestamp: new Date(message.date).getTime(),
            isUser: message.role === "user",
          };
          photos.push(photo);
        }
      });
    });

    return photos;
  }

  /**
   * 加载指定页的数据到内存
   */
  private async loadPage(page: number): Promise<void> {
    try {
      const photos = await photoStorage.getPhotos({
        limit: this.PAGE_SIZE,
        offset: page * this.PAGE_SIZE,
        sortBy: "timestamp",
        sortOrder: "desc",
      });

      // 更新内存中的照片信息
      photos.forEach((photo) => {
        this.photos.set(photo.url, photo);
      });

      // 预加载这批图片
      await this.preloadBatch(photos.map((p) => p.url));
    } catch (error) {
      console.error("[PhotoCollector] 加载页面失败:", error);
    }
  }

  /**
   * 批量预加载图片
   */
  private async preloadBatch(imageUrls: string[]): Promise<void> {
    if (imageUrls.length === 0) return;

    // 大幅减少预加载数量，避免网络压力
    const maxPreload = 5; // 最多预加载5张
    const urlsToPreload = imageUrls.slice(0, maxPreload);

    // 批量预加载，每批2张图片，减少网络压力
    const batchSize = 2;
    for (let i = 0; i < urlsToPreload.length; i += batchSize) {
      const batch = urlsToPreload.slice(i, i + batchSize);

      const batchPromises = batch.map(async (url) => {
        try {
          await imageManager.loadImage(url, { compress: true });
        } catch (error) {
          // 忽略预加载失败
        }
      });

      await Promise.allSettled(batchPromises);

      // 增加延迟时间，避免网络拥塞
      if (i + batchSize < urlsToPreload.length) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
  }

  /**
   * 新对话有新照片时主动加入
   */
  async onNewMessage(message: any, session: any): Promise<void> {
    if (!this.initialized) return;

    const imageUrls = this.extractMessageImages(message);

    if (imageUrls.length === 0) return;

    const newPhotos: Omit<PhotoInfo, "id">[] = [];

    for (const url of imageUrls) {
      if (url && url.trim()) {
        const trimmedUrl = url.trim();
        const existingPhoto = await photoStorage.getPhotoById(
          `${session.id}-${message.id}-${btoa(trimmedUrl).slice(0, 8)}`,
        );

        if (!existingPhoto) {
          const photo: Omit<PhotoInfo, "id"> = {
            url: trimmedUrl,
            sessionId: session.id,
            sessionTitle: session.topic || "未命名对话",
            messageId: message.id,
            timestamp: new Date(message.date).getTime(),
            isUser: message.role === "user",
          };

          newPhotos.push(photo);
        }
      }
    }

    if (newPhotos.length > 0) {
      // 保存到 IndexedDB
      const savedPhotos = await photoStorage.addPhotos(newPhotos);

      // 更新内存
      savedPhotos.forEach((photo) => {
        this.photos.set(photo.url, photo);
      });

      // 预加载新图片
      await this.preloadBatch(savedPhotos.map((p) => p.url));

      // 通知前端有新照片（用于库页面即时更新）
      try {
        if (typeof window !== "undefined") {
          const event = new CustomEvent("photoCollector:newPhotos", {
            detail: savedPhotos,
          });
          window.dispatchEvent(event);
        }
      } catch {}
    }
  }

  /**
   * 获取分页照片数据
   */
  async getPhotos(query: PhotoQuery = {}): Promise<PhotoInfo[]> {
    try {
      const photos = await photoStorage.getPhotos(query);
      return photos;
    } catch (error) {
      console.error("[PhotoCollector] getPhotos 失败:", error);
      // 回退到内存中的照片
      const memoryPhotos = Array.from(this.photos.values())
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(query.offset || 0, (query.offset || 0) + (query.limit || 50));
      return memoryPhotos;
    }
  }

  /**
   * 获取所有收集到的图片信息（内存中的）
   */
  getAllPhotos(): PhotoInfo[] {
    return Array.from(this.photos.values()).sort(
      (a, b) => b.timestamp - a.timestamp,
    ); // 按时间倒序
  }

  /**
   * 获取所有图片URL（用于照片墙显示）
   */
  getAllPhotoUrls(): string[] {
    return this.getAllPhotos().map((photo) => photo.url);
  }

  /**
   * 根据会话筛选图片
   */
  async getPhotosBySession(sessionId: string): Promise<PhotoInfo[]> {
    await this.initialize();
    return await photoStorage.getPhotos({ sessionId });
  }

  /**
   * 获取统计信息
   */
  async getStats() {
    try {
      await this.initialize();
      const stats = await photoStorage.getStats();
      return stats;
    } catch (error) {
      console.error("[PhotoCollector] getStats 失败:", error);
      // 回退到内存统计
      const memoryPhotos = Array.from(this.photos.values());
      const userPhotos = memoryPhotos.filter((p) => p.isUser).length;
      const sessions = new Set(memoryPhotos.map((p) => p.sessionId));
      return {
        total: memoryPhotos.length,
        userPhotos,
        botPhotos: memoryPhotos.length - userPhotos,
        sessionsWithPhotos: sessions.size,
        lastUpdated: Date.now(),
      };
    }
  }

  /**
   * 紧急回退模式：直接从会话中提取图片
   */
  async getPhotosFromSessions(): Promise<PhotoInfo[]> {
    try {
      const chatStore = useChatStore.getState();
      const allSessions = chatStore.sessions || [];

      const allPhotos: PhotoInfo[] = [];

      for (const session of allSessions.slice(0, 10)) {
        // 只处理前10个会话
        try {
          const sessionImages = this.collectSessionImages(session);
          sessionImages.forEach((photo, index) => {
            const photoInfo: PhotoInfo = {
              ...photo,
              id: `emergency-${session.id}-${index}`,
            };
            allPhotos.push(photoInfo);
          });
        } catch (sessionError) {
          console.warn("[PhotoCollector] 紧急模式处理会话失败:", session.id);
        }
      }

      return allPhotos.slice(0, 50); // 最多返回50张
    } catch (error) {
      console.error("[PhotoCollector] 紧急回退模式失败:", error);
      return [];
    }
  }

  /**
   * 加载更多照片（分页）
   */
  async loadMore(): Promise<PhotoInfo[]> {
    this.currentPage += 1;

    const photos = await photoStorage.getPhotos({
      limit: this.PAGE_SIZE,
      offset: this.currentPage * this.PAGE_SIZE,
      sortBy: "timestamp",
      sortOrder: "desc",
    });

    // 更新内存中的照片信息
    photos.forEach((photo) => {
      this.photos.set(photo.url, photo);
    });

    // 检查网络状态，只在网络良好时预加载
    if (
      navigator.onLine &&
      (navigator as any).connection?.effectiveType === "4g"
    ) {
      // 暂时禁用预加载，避免网络压力
      // this.preloadBatch(photos.map((p) => p.url)).catch((error) => {
      //   console.warn("[PhotoCollector] 预加载失败:", error);
      // });
    }

    return photos; // 立即返回当前页的新照片
  }

  /**
   * 重置分页
   */
  resetPagination(): void {
    this.currentPage = 0;
    this.photos.clear();
  }

  /**
   * 强制重新收集所有图片
   */
  async refresh(): Promise<void> {
    this.initialized = false;
    this.photos.clear();
    this.currentPage = 0;
    await photoStorage.setMetadata("lastCollectionTime", 0); // 强制重新收集
    await this.initialize();
  }
}

// 全局单例
export const photoCollector = new PhotoCollector();
