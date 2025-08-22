/**
 * 照片数据 IndexedDB 存储模块
 * 负责照片信息的持久化存储、查询和分页
 */

import { get, set, del, entries, keys } from "idb-keyval";

export interface PhotoInfo {
  id: string; // 唯一ID，由 url + sessionId + messageId 生成
  url: string;
  sessionId: string;
  sessionTitle: string;
  messageId: string;
  timestamp: number;
  isUser: boolean;
  width?: number; // 图片宽度
  height?: number; // 图片高度
  size?: number; // 文件大小
  type?: string; // MIME类型
  thumbnail?: string; // 缩略图 base64
  contentHash?: string; // 内容哈希，用于去重
  originalUrls?: string[]; // 重复图片的所有URL
}

export interface PhotoQuery {
  sessionId?: string;
  isUser?: boolean;
  startTime?: number;
  endTime?: number;
  limit?: number;
  offset?: number;
  sortBy?: "timestamp" | "size";
  sortOrder?: "asc" | "desc";
}

class PhotoStorage {
  private readonly PHOTOS_PREFIX = "photos:";
  private readonly METADATA_PREFIX = "metadata:";
  private readonly INDEX_KEY = "photos_index";
  private readonly HASH_INDEX_KEY = "photos_hash_index";
  private isInitialized = false;

  /**
   * 初始化数据库
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    // idb-keyval 不需要显式初始化
    try {
      // 强制重建索引，确保包含所有照片
      await this.rebuildIndex();

      // 哈希索引可以延迟创建，避免阻塞初始化
      const hashIndex = await this.getHashIndex();
      if (!hashIndex) {
        await this.updateHashIndex({});
      }

      this.isInitialized = true;
    } catch (error) {
      console.error("[PhotoStorage] 初始化失败:", error);
      // 不要抛出错误，允许继续运行
      this.isInitialized = true; // 即使失败也标记为已初始化，避免重复尝试
    }
  }

  /**
   * 生成照片唯一ID
   */
  private generatePhotoId(
    url: string,
    sessionId: string,
    messageId: string,
  ): string {
    // 使用完整的 base64 而不是截取，避免冲突但保持兼容性
    try {
      const urlHash = btoa(encodeURIComponent(url)).replace(/[+/=]/g, "");
      return `${sessionId}-${messageId}-${urlHash}`;
    } catch {
      // 如果 btoa 失败，使用备用哈希方法
      const urlHash = this.simpleHash(url);
      return `${sessionId}-${messageId}-${urlHash}`;
    }
  }

  /**
   * 简单哈希函数，作为 base64 的备用方案
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // 转换为32位整数
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * 获取照片存储键
   */
  private getPhotoKey(id: string): string {
    return this.PHOTOS_PREFIX + id;
  }

  /**
   * 获取元数据存储键
   */
  private getMetadataKey(key: string): string {
    return this.METADATA_PREFIX + key;
  }

  /**
   * 获取照片索引
   */
  private async getPhotosIndex(): Promise<string[] | null> {
    try {
      return (await get(this.INDEX_KEY)) || null;
    } catch (error) {
      console.error("[PhotoStorage] 获取索引失败:", error);
      return null;
    }
  }

  /**
   * 更新照片索引
   */
  private async updatePhotosIndex(photoIds: string[]): Promise<void> {
    try {
      await set(this.INDEX_KEY, photoIds);
    } catch (error) {
      console.error("[PhotoStorage] 更新索引失败:", error);
    }
  }

  /**
   * 重建索引
   */
  private async rebuildIndex(): Promise<void> {
    try {
      const allKeys = await keys();
      const photoKeys = allKeys.filter(
        (key) => typeof key === "string" && key.startsWith(this.PHOTOS_PREFIX),
      );
      const photoIds = photoKeys.map((key) =>
        (key as string).substring(this.PHOTOS_PREFIX.length),
      );
      await this.updatePhotosIndex(photoIds);
    } catch (error) {
      console.error("[PhotoStorage] 重建索引失败:", error);
    }
  }

  /**
   * 获取哈希索引
   */
  private async getHashIndex(): Promise<Record<string, string[]> | null> {
    try {
      return (await get(this.HASH_INDEX_KEY)) || null;
    } catch (error) {
      console.error("[PhotoStorage] 获取哈希索引失败:", error);
      return null;
    }
  }

  /**
   * 更新哈希索引
   */
  private async updateHashIndex(
    hashIndex: Record<string, string[]>,
  ): Promise<void> {
    try {
      await set(this.HASH_INDEX_KEY, hashIndex);
    } catch (error) {
      console.error("[PhotoStorage] 更新哈希索引失败:", error);
    }
  }

  /**
   * 重建哈希索引（不依赖 getPhotos 方法，避免循环依赖）
   */
  private async rebuildHashIndex(): Promise<void> {
    try {
      const photoIds = (await this.getPhotosIndex()) || [];
      const hashIndex: Record<string, string[]> = {};

      for (const id of photoIds) {
        try {
          const photo = (await get(this.getPhotoKey(id))) as
            | PhotoInfo
            | undefined;
          if (photo && photo.contentHash) {
            if (!hashIndex[photo.contentHash]) {
              hashIndex[photo.contentHash] = [];
            }
            hashIndex[photo.contentHash].push(photo.id);
          }
        } catch (error) {
          console.warn("[PhotoStorage] 处理照片哈希失败:", id, error);
        }
      }

      await this.updateHashIndex(hashIndex);
    } catch (error) {
      console.error("[PhotoStorage] 重建哈希索引失败:", error);
    }
  }

  /**
   * 获取图片尺寸信息
   */
  private async getImageDimensions(
    url: string,
  ): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      };
      img.onerror = () => {
        reject(new Error("Failed to load image"));
      };
      img.src = url;
    });
  }

  /**
   * 生成缩略图
   */
  private async generateThumbnail(url: string, maxSize = 200): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas context not available"));
          return;
        }

        // 计算缩放比例
        const scale = Math.min(maxSize / img.width, maxSize / img.height);
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;

        // 绘制缩略图
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        // 转换为base64
        const thumbnail = canvas.toDataURL("image/jpeg", 0.8); // 提高质量到80%
        resolve(thumbnail);
      };
      img.onerror = () => {
        reject(new Error("Failed to load image for thumbnail"));
      };
      img.crossOrigin = "anonymous";
      img.src = url;
    });
  }

  /**
   * 计算图片内容哈希
   */
  private async calculateImageHash(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            reject(new Error("Canvas context not available"));
            return;
          }

          // 创建小尺寸灰度图片用于计算哈希
          const hashSize = 8;
          canvas.width = hashSize;
          canvas.height = hashSize;

          // 绘制并转换为灰度
          ctx.drawImage(img, 0, 0, hashSize, hashSize);
          const imageData = ctx.getImageData(0, 0, hashSize, hashSize);
          const data = imageData.data;

          // 计算平均灰度值
          let sum = 0;
          const pixels = [];
          for (let i = 0; i < data.length; i += 4) {
            const gray = Math.round(
              0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2],
            );
            pixels.push(gray);
            sum += gray;
          }
          const average = sum / pixels.length;

          // 生成哈希
          let hash = "";
          for (let i = 0; i < pixels.length; i++) {
            hash += pixels[i] >= average ? "1" : "0";
          }

          resolve(hash);
        } catch (error) {
          reject(error);
        }
      };
      img.onerror = () => {
        reject(new Error("Failed to load image for hash calculation"));
      };
      img.crossOrigin = "anonymous";
      img.src = url;
    });
  }

  /**
   * 添加照片信息（包含去重）
   */
  async addPhoto(photo: Omit<PhotoInfo, "id">): Promise<PhotoInfo> {
    await this.initialize();

    const id = this.generatePhotoId(
      photo.url,
      photo.sessionId,
      photo.messageId,
    );

    try {
      // 检查是否已存在
      const existingPhoto = await this.getPhotoById(id);
      if (existingPhoto) {
        return existingPhoto;
      }

      // 计算图片哈希用于去重
      let contentHash: string | undefined;
      try {
        contentHash = await this.calculateImageHash(photo.url);

        // 检查是否有相同内容的图片
        const duplicatePhoto = await this.findDuplicateByHash(contentHash);
        if (duplicatePhoto) {
          // 更新重复图片信息
          const updatedPhoto = await this.mergeDuplicatePhoto(
            duplicatePhoto,
            photo,
          );
          return updatedPhoto;
        }
      } catch (error) {
        console.warn("[PhotoStorage] 计算图片哈希失败:", error);
      }

      const enhancedPhoto: PhotoInfo = {
        ...photo,
        id,
        contentHash,
        originalUrls: [photo.url],
      };

      // 保存照片信息
      await set(this.getPhotoKey(id), enhancedPhoto);

      // 更新索引
      const currentIndex = (await this.getPhotosIndex()) || [];
      if (!currentIndex.includes(id)) {
        await this.updatePhotosIndex([...currentIndex, id]);
      }

      // 更新哈希索引
      if (contentHash) {
        const hashIndex = (await this.getHashIndex()) || {};
        if (!hashIndex[contentHash]) {
          hashIndex[contentHash] = [];
        }
        hashIndex[contentHash].push(id);
        await this.updateHashIndex(hashIndex);
      }

      // 异步获取图片信息
      this.enhancePhotoInfo(enhancedPhoto).catch((error) => {
        console.warn("[PhotoStorage] 获取图片信息失败:", error);
      });

      return enhancedPhoto;
    } catch (error) {
      console.error("[PhotoStorage] 添加照片失败:", error);
      throw error;
    }
  }

  /**
   * 查找重复的图片
   */
  private async findDuplicateByHash(
    contentHash: string,
  ): Promise<PhotoInfo | null> {
    try {
      const hashIndex = (await this.getHashIndex()) || {};
      const duplicateIds = hashIndex[contentHash];

      if (duplicateIds && duplicateIds.length > 0) {
        // 返回第一个重复图片
        const photoId = duplicateIds[0];
        return (await this.getPhotoById(photoId)) || null;
      }

      return null;
    } catch (error) {
      console.error("[PhotoStorage] 查找重复图片失败:", error);
      return null;
    }
  }

  /**
   * 合并重复图片信息
   */
  private async mergeDuplicatePhoto(
    existingPhoto: PhotoInfo,
    newPhoto: Omit<PhotoInfo, "id">,
  ): Promise<PhotoInfo> {
    try {
      // 更新现有照片的信息
      const updatedPhoto: PhotoInfo = {
        ...existingPhoto,
        originalUrls: [
          ...(existingPhoto.originalUrls || [existingPhoto.url]),
          newPhoto.url,
        ].filter((url, index, arr) => arr.indexOf(url) === index), // 去重
        // 保持最新的时间戳
        timestamp: Math.max(existingPhoto.timestamp, newPhoto.timestamp),
      };

      // 保存更新后的照片信息
      await set(this.getPhotoKey(existingPhoto.id), updatedPhoto);

      return updatedPhoto;
    } catch (error) {
      console.error("[PhotoStorage] 合并重复图片失败:", error);
      throw error;
    }
  }

  /**
   * 异步增强照片信息
   */
  private async enhancePhotoInfo(photo: PhotoInfo): Promise<void> {
    try {
      const [dimensions, thumbnail] = await Promise.allSettled([
        this.getImageDimensions(photo.url),
        this.generateThumbnail(photo.url),
      ]);

      const updates: Partial<PhotoInfo> = {};

      if (dimensions.status === "fulfilled") {
        updates.width = dimensions.value.width;
        updates.height = dimensions.value.height;
      }

      if (thumbnail.status === "fulfilled") {
        updates.thumbnail = thumbnail.value;
      }

      if (Object.keys(updates).length > 0) {
        const updatedPhoto = { ...photo, ...updates };
        await set(this.getPhotoKey(photo.id), updatedPhoto);
      }
    } catch (error) {
      console.warn("[PhotoStorage] 增强照片信息失败:", error);
    }
  }

  /**
   * 批量添加照片
   */
  async addPhotos(photos: Omit<PhotoInfo, "id">[]): Promise<PhotoInfo[]> {
    await this.initialize();

    const results: PhotoInfo[] = [];
    const currentIndex = (await this.getPhotosIndex()) || [];
    const newIds: string[] = [];

    try {
      for (const photo of photos) {
        const id = this.generatePhotoId(
          photo.url,
          photo.sessionId,
          photo.messageId,
        );

        // 检查是否已存在，避免重复添加
        const existingPhoto = await this.getPhotoById(id);
        if (existingPhoto) {
          results.push(existingPhoto);
          continue;
        }

        const enhancedPhoto: PhotoInfo = { ...photo, id };

        await set(this.getPhotoKey(id), enhancedPhoto);
        results.push(enhancedPhoto);

        if (!currentIndex.includes(id)) {
          newIds.push(id);
        }

        // 异步增强照片信息
        this.enhancePhotoInfo(enhancedPhoto).catch((error) => {
          console.warn("[PhotoStorage] 增强照片信息失败:", error);
        });
      }

      // 批量更新索引
      if (newIds.length > 0) {
        await this.updatePhotosIndex([...currentIndex, ...newIds]);
      }

      return results;
    } catch (error) {
      console.error("[PhotoStorage] 批量添加照片失败:", error);
      throw error;
    }
  }

  /**
   * 查询照片
   */
  async getPhotos(query: PhotoQuery = {}): Promise<PhotoInfo[]> {
    await this.initialize();

    const {
      sessionId,
      isUser,
      startTime,
      endTime,
      limit = 50,
      offset = 0,
      sortBy = "timestamp",
      sortOrder = "desc",
    } = query;

    try {
      // 获取所有照片ID
      const photoIds = (await this.getPhotosIndex()) || [];

      // 批量获取照片数据
      const photoPromises = photoIds.map(async (id) => {
        try {
          return (await get(this.getPhotoKey(id))) as PhotoInfo | undefined;
        } catch {
          return undefined;
        }
      });

      const photos = (await Promise.all(photoPromises)).filter(
        (photo): photo is PhotoInfo => photo !== undefined,
      );

      // 去重：确保没有重复的 ID
      const uniquePhotos = photos.filter(
        (photo, index, self) =>
          index === self.findIndex((p) => p.id === photo.id),
      );

      let results = uniquePhotos;

      // 筛选会话
      if (sessionId) {
        results = results.filter((photo) => photo.sessionId === sessionId);
      }

      // 筛选用户类型
      if (typeof isUser === "boolean") {
        results = results.filter((photo) => photo.isUser === isUser);
      }

      // 筛选时间范围
      if (startTime || endTime) {
        results = results.filter((photo) => {
          const timestamp = photo.timestamp;
          if (startTime && timestamp < startTime) return false;
          if (endTime && timestamp > endTime) return false;
          return true;
        });
      }

      // 排序
      results.sort((a, b) => {
        const aValue = sortBy === "timestamp" ? a.timestamp : a.size || 0;
        const bValue = sortBy === "timestamp" ? b.timestamp : b.size || 0;
        return sortOrder === "desc" ? bValue - aValue : aValue - bValue;
      });

      // 分页
      return results.slice(offset, offset + limit);
    } catch (error) {
      console.error("[PhotoStorage] 查询照片失败:", error);
      throw error;
    }
  }

  /**
   * 获取照片总数
   */
  async getPhotoCount(
    query: Omit<PhotoQuery, "limit" | "offset"> = {},
  ): Promise<number> {
    await this.initialize();

    try {
      const photos = await this.getPhotos({
        ...query,
        limit: Number.MAX_SAFE_INTEGER,
        offset: 0,
      });
      return photos.length;
    } catch (error) {
      console.error("[PhotoStorage] 获取照片总数失败:", error);
      return 0;
    }
  }

  /**
   * 根据ID获取照片
   */
  async getPhotoById(id: string): Promise<PhotoInfo | undefined> {
    await this.initialize();

    try {
      let photo = (await get(this.getPhotoKey(id))) as PhotoInfo | undefined;

      // 如果没找到，尝试用旧的 ID 格式查找（兼容性处理）
      if (!photo && id.includes("-")) {
        const parts = id.split("-");
        if (parts.length >= 3) {
          const sessionId = parts[0];
          const messageId = parts[1];
          const urlHash = parts.slice(2).join("-");

          // 尝试旧的 8 字符格式
          if (urlHash.length > 8) {
            const oldId = `${sessionId}-${messageId}-${urlHash.slice(0, 8)}`;
            photo = (await get(this.getPhotoKey(oldId))) as
              | PhotoInfo
              | undefined;
          }
        }
      }

      return photo;
    } catch (error) {
      console.error("[PhotoStorage] 获取照片失败:", error);
      return undefined;
    }
  }

  /**
   * 删除照片
   */
  async deletePhoto(id: string): Promise<void> {
    await this.initialize();

    try {
      await del(this.getPhotoKey(id));

      // 更新索引
      const currentIndex = (await this.getPhotosIndex()) || [];
      const newIndex = currentIndex.filter((photoId) => photoId !== id);
      await this.updatePhotosIndex(newIndex);
    } catch (error) {
      console.error("[PhotoStorage] 删除照片失败:", error);
      throw error;
    }
  }

  /**
   * 删除会话的所有照片
   */
  async deletePhotosBySession(sessionId: string): Promise<void> {
    await this.initialize();

    try {
      const photos = await this.getPhotos({ sessionId });
      const idsToDelete = photos.map((photo) => photo.id);

      // 批量删除
      for (const id of idsToDelete) {
        await del(this.getPhotoKey(id));
      }

      // 更新索引
      const currentIndex = (await this.getPhotosIndex()) || [];
      const newIndex = currentIndex.filter((id) => !idsToDelete.includes(id));
      await this.updatePhotosIndex(newIndex);
    } catch (error) {
      console.error("[PhotoStorage] 删除会话照片失败:", error);
      throw error;
    }
  }

  /**
   * 清空所有照片
   */
  async clearPhotos(): Promise<void> {
    await this.initialize();

    try {
      const photoIds = (await this.getPhotosIndex()) || [];

      // 批量删除所有照片
      for (const id of photoIds) {
        await del(this.getPhotoKey(id));
      }

      // 清空索引
      await this.updatePhotosIndex([]);
    } catch (error) {
      console.error("[PhotoStorage] 清空照片失败:", error);
      throw error;
    }
  }

  /**
   * 获取统计信息
   */
  async getStats(): Promise<{
    total: number;
    userPhotos: number;
    botPhotos: number;
    sessionsWithPhotos: number;
    lastUpdated: number;
  }> {
    await this.initialize();

    try {
      const allPhotos = await this.getPhotos({
        limit: Number.MAX_SAFE_INTEGER,
        offset: 0,
      });
      const userPhotos = allPhotos.filter((p) => p.isUser).length;
      const sessionsWithPhotos = new Set(allPhotos.map((p) => p.sessionId))
        .size;

      return {
        total: allPhotos.length,
        userPhotos,
        botPhotos: allPhotos.length - userPhotos,
        sessionsWithPhotos,
        lastUpdated: Date.now(),
      };
    } catch (error) {
      console.error("[PhotoStorage] 获取统计信息失败:", error);
      return {
        total: 0,
        userPhotos: 0,
        botPhotos: 0,
        sessionsWithPhotos: 0,
        lastUpdated: Date.now(),
      };
    }
  }

  /**
   * 设置元数据
   */
  async setMetadata(key: string, value: any): Promise<void> {
    await this.initialize();

    try {
      await set(this.getMetadataKey(key), {
        key,
        value,
        updatedAt: Date.now(),
      });
    } catch (error) {
      console.error("[PhotoStorage] 设置元数据失败:", error);
      throw error;
    }
  }

  /**
   * 获取元数据
   */
  async getMetadata(key: string): Promise<any> {
    await this.initialize();

    try {
      const record = (await get(this.getMetadataKey(key))) as
        | { value: any }
        | undefined;
      return record?.value;
    } catch (error) {
      console.error("[PhotoStorage] 获取元数据失败:", error);
      return null;
    }
  }

  /**
   * 手动修复索引 - 重新扫描所有存储的照片
   */
  async repairIndex(): Promise<void> {
    // 重置初始化状态，强制重新初始化
    this.isInitialized = false;
    await this.initialize();

    try {
      // 直接从存储中重建索引，确保不丢失任何照片
      await this.rebuildIndex();

      // 重建哈希索引
      await this.rebuildHashIndex();
    } catch (error) {
      console.error("[PhotoStorage] 修复索引失败:", error);
    }
  }

  /**
   * 重置存储状态 - 用于调试
   */
  resetInitialization(): void {
    this.isInitialized = false;
  }
}

// 全局单例
export const photoStorage = new PhotoStorage();

// 开发者调试工具 - 在浏览器控制台中可用
if (typeof window !== "undefined") {
  (window as any).debugPhotoStorage = {
    repairIndex: () => photoStorage.repairIndex(),
    resetAndRebuild: async () => {
      photoStorage.resetInitialization();
      await photoStorage.initialize();
      const stats = await photoStorage.getStats();
      return stats;
    },
    getStats: () => photoStorage.getStats(),
  };
}
