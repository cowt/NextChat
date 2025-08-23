/**
 * 照片墙主动收集器
 * 负责从所有对话中主动收集图片并预加载到照片墙
 * 使用 IndexedDB 进行持久化存储
 * 优化版本：首屏快速加载 + 异步统计 + 预览预加载
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
  private readonly FIRST_PAGE_SIZE = 12; // 首屏减少到12张，提升加载速度
  private readonly PAGE_SIZE = 20; // 后续页面20张
  private statsCache: any = null;
  private statsCacheTime = 0;
  private readonly STATS_CACHE_DURATION = 30000; // 30秒缓存

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
        // 如果有现有数据，直接加载首屏
        await this.loadPage(0, true);
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
        await this.loadPage(0, true);
        this.initialized = true;
        return;
      }

      // 如果修复后仍没有照片，尝试部分索引修复
      try {
        const chatStore = useChatStore.getState();
        const recentSessions = chatStore.sessions?.slice(0, 5) || [];

        for (const session of recentSessions) {
          await photoStorage.repairSessionIndex(session.id);
        }

        // 再次检查
        const partialRepairedPhotos = await photoStorage.getPhotos({
          limit: 1,
          offset: 0,
        });

        if (partialRepairedPhotos.length > 0) {
          await this.loadPage(0, true);
          this.initialized = true;
          return;
        }
      } catch (error) {
        console.warn("[PhotoCollector] 部分索引修复失败:", error);
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
        await this.loadPage(0, true);
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
  private async loadPage(
    page: number,
    isFirstPage: boolean = false,
  ): Promise<void> {
    try {
      const pageSize = isFirstPage ? this.FIRST_PAGE_SIZE : this.PAGE_SIZE;

      const photos = await photoStorage.getPhotos({
        limit: pageSize,
        offset: page * pageSize,
        sortBy: "timestamp",
        sortOrder: "desc",
      });

      // 更新内存中的照片信息
      photos.forEach((photo) => {
        this.photos.set(photo.url, photo);
      });

      // 首屏加载完成后，异步预加载邻近照片
      if (isFirstPage && photos.length > 0) {
        this.preloadNeighborPhotos(photos[0].id).catch((error) => {
          console.warn("[PhotoCollector] 首屏邻近预加载失败:", error);
        });
      }
    } catch (error) {
      console.error("[PhotoCollector] 加载页面失败:", error);
    }
  }

  /**
   * 预加载邻近照片
   */
  private async preloadNeighborPhotos(currentId: string): Promise<void> {
    try {
      const neighbors = await photoStorage.getNeighborPhotos(currentId, 3);

      // 异步预加载邻近照片的缩略图
      neighbors.forEach(async (photo) => {
        if (photo.thumbUrl) {
          const img = new Image();
          img.src = photo.thumbUrl;
        }
      });
    } catch (error) {
      console.warn("[PhotoCollector] 预加载邻近照片失败:", error);
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
   * 获取统计信息（异步优化版本）
   */
  async getStats() {
    try {
      await this.initialize();

      // 检查缓存
      const now = Date.now();
      if (
        this.statsCache &&
        now - this.statsCacheTime < this.STATS_CACHE_DURATION
      ) {
        return this.statsCache;
      }

      // 异步获取详细统计
      const statsPromise = photoStorage.getStats();

      // 先返回基础统计（快速响应）
      const basicStats = {
        total: 0,
        userPhotos: 0,
        botPhotos: 0,
        sessionsWithPhotos: 0,
        lastUpdated: now,
      };

      // 异步更新详细统计
      statsPromise
        .then((detailedStats) => {
          this.statsCache = detailedStats;
          this.statsCacheTime = now;

          // 通知前端统计更新
          try {
            if (typeof window !== "undefined") {
              const event = new CustomEvent("photoCollector:statsUpdated", {
                detail: detailedStats,
              });
              window.dispatchEvent(event);
            }
          } catch {}
        })
        .catch((error) => {
          console.warn("[PhotoCollector] 获取详细统计失败:", error);
        });

      return basicStats;
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
   * 获取详细统计信息（强制刷新）
   */
  async getDetailedStats() {
    try {
      await this.initialize();
      const stats = await photoStorage.getStats();
      this.statsCache = stats;
      this.statsCacheTime = Date.now();
      return stats;
    } catch (error) {
      console.error("[PhotoCollector] getDetailedStats 失败:", error);
      return null;
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

    return photos; // 立即返回当前页的新照片
  }

  /**
   * 重置分页
   */
  resetPagination(): void {
    this.currentPage = 0;
    this.photos.clear();
    this.statsCache = null;
    this.statsCacheTime = 0;
  }

  /**
   * 强制重新收集所有图片
   */
  async refresh(): Promise<void> {
    this.initialized = false;
    this.photos.clear();
    this.currentPage = 0;
    this.statsCache = null;
    this.statsCacheTime = 0;
    await photoStorage.setMetadata("lastCollectionTime", 0); // 强制重新收集
    await this.initialize();
  }

  /**
   * 优化的初始化方法（包含批量下载）
   */
  async optimizedInitialize(): Promise<void> {
    console.log("[PhotoCollector] 开始优化初始化...");

    try {
      // 先执行标准初始化
      await this.initialize();

      // 然后执行优化的批量下载
      console.log("[PhotoCollector] 开始优化批量下载...");
      const downloadResult = await (
        window as any
      ).debugPhotoStorage.optimizedBatchDownload(3, 300);

      console.log("[PhotoCollector] 优化初始化完成:", downloadResult);
    } catch (error) {
      console.error("[PhotoCollector] 优化初始化失败:", error);
    }
  }

  /**
   * 预加载指定照片的邻近照片（用于预览优化）
   */
  async preloadForPreview(photoId: string): Promise<void> {
    try {
      await photoStorage.preloadNeighborPhotos(photoId);
    } catch (error) {
      console.warn("[PhotoCollector] 预览预加载失败:", error);
    }
  }
}

// 全局单例
export const photoCollector = new PhotoCollector();
