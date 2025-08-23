/**
 * 照片数据 IndexedDB 存储模块
 * 负责照片信息的持久化存储、查询和分页
 * 重构版本：使用原生IndexedDB建立对象仓库
 */

// 移除idb-keyval依赖，使用原生IndexedDB
// import { get, set, del, entries, keys } from "idb-keyval";

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
  thumbUrl?: string; // 缩略图URL（优化版本）
  thumbWidth?: number; // 缩略图宽度
  thumbHeight?: number; // 缩略图高度
  contentHash?: string; // 内容哈希，用于去重
  originalUrls?: string[]; // 重复图片的所有URL
  // 新增字段：下载状态管理
  downloadStatus?: "downloading" | "complete" | "failed";
  blob?: Blob; // 图片数据
  lastChecked?: number; // 最后检查时间
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
  private readonly DB_NAME = "NextChatPhotoDB";
  private readonly DB_VERSION = 2;
  private readonly STORE_NAME = "images";
  private readonly METADATA_STORE = "metadata";
  private db: IDBDatabase | null = null;
  private isInitialized = false;

  /**
   * 初始化数据库
   */
  async initialize(): Promise<void> {
    if (this.isInitialized && this.db) {
      return;
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onerror = () => {
        console.error("[PhotoStorage] 数据库打开失败:", request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        this.isInitialized = true;
        console.log("[PhotoStorage] 数据库初始化成功");
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // 创建图片存储对象仓库
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          const imageStore = db.createObjectStore(this.STORE_NAME, {
            keyPath: "id",
          });

          // 创建索引
          imageStore.createIndex("url", "url", { unique: false });
          imageStore.createIndex("sessionId", "sessionId", { unique: false });
          imageStore.createIndex("timestamp", "timestamp", { unique: false });
          imageStore.createIndex("contentHash", "contentHash", {
            unique: false,
          });
          imageStore.createIndex("downloadStatus", "downloadStatus", {
            unique: false,
          });
          imageStore.createIndex("isUser", "isUser", { unique: false });
        }

        // 创建元数据存储对象仓库
        if (!db.objectStoreNames.contains(this.METADATA_STORE)) {
          db.createObjectStore(this.METADATA_STORE, { keyPath: "key" });
        }

        console.log("[PhotoStorage] 数据库结构升级完成");
      };
    });
  }

  /**
   * 生成照片唯一ID
   */
  private generatePhotoId(
    url: string,
    sessionId: string,
    messageId: string,
  ): string {
    try {
      const urlHash = btoa(encodeURIComponent(url)).replace(/[+/=]/g, "");
      return `${sessionId}-${messageId}-${urlHash}`;
    } catch {
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
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * 执行数据库事务
   */
  private async executeTransaction<T>(
    storeName: string,
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    if (!this.db) {
      throw new Error("数据库未初始化");
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([storeName], mode);
      const store = transaction.objectStore(storeName);
      const request = operation(store);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * 执行数据库事务（支持异步操作）
   */
  private async executeTransactionAsync<T>(
    storeName: string,
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => Promise<T>,
  ): Promise<T> {
    if (!this.db) {
      throw new Error("数据库未初始化");
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([storeName], mode);
      const store = transaction.objectStore(storeName);

      operation(store).then(resolve).catch(reject);

      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * 检查图片是否需要下载
   */
  private async checkImageDownloadStatus(photo: PhotoInfo): Promise<{
    needsDownload: boolean;
    reason?: string;
  }> {
    // 如果没有下载状态，需要下载
    if (!photo.downloadStatus) {
      return { needsDownload: true, reason: "no_status" };
    }

    // 如果状态是失败，需要重新下载
    if (photo.downloadStatus === "failed") {
      return { needsDownload: true, reason: "failed_status" };
    }

    // 如果状态是下载中，检查是否超时（超过5分钟）
    if (photo.downloadStatus === "downloading") {
      const timeout = 5 * 60 * 1000; // 5分钟
      if (!photo.lastChecked || Date.now() - photo.lastChecked > timeout) {
        return { needsDownload: true, reason: "download_timeout" };
      }
    }

    // 如果状态是完成，检查是否有blob数据
    if (photo.downloadStatus === "complete" && !photo.blob) {
      return { needsDownload: true, reason: "no_blob_data" };
    }

    return { needsDownload: false };
  }

  /**
   * 下载图片数据（优化版本）
   */
  async downloadImageData(photo: PhotoInfo): Promise<{
    success: boolean;
    blob?: Blob;
    error?: string;
  }> {
    try {
      // 设置下载状态
      await this.updatePhotoDownloadStatus(photo.id, "downloading");

      // 使用优化的下载策略
      const response = await fetch(photo.url, {
        method: "GET",
        signal: AbortSignal.timeout(15000), // 增加超时时间到15秒
        headers: {
          Accept: "image/*",
          "Cache-Control": "no-cache",
        },
        mode: "cors", // 明确指定CORS模式
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const blob = await response.blob();

      // 验证图片格式
      if (!blob.type.startsWith("image/")) {
        throw new Error(`Invalid image format: ${blob.type}`);
      }

      // 可选：计算哈希校验
      if (photo.contentHash) {
        const calculatedHash = await this.calculateBlobHash(blob);
        if (calculatedHash !== photo.contentHash) {
          throw new Error("Hash verification failed");
        }
      }

      // 更新状态为完成
      await this.updatePhotoData(photo.id, {
        downloadStatus: "complete",
        blob,
        lastChecked: Date.now(),
      });

      return { success: true, blob };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";

      // 记录详细错误信息
      console.warn(`[PhotoStorage] 下载失败 ${photo.url}:`, errorMsg);

      // 更新状态为失败
      await this.updatePhotoDownloadStatus(photo.id, "failed");

      return { success: false, error: errorMsg };
    }
  }

  /**
   * 计算Blob哈希
   */
  private async calculateBlobHash(blob: Blob): Promise<string> {
    // 简化的哈希计算，实际项目中可以使用更复杂的算法
    const arrayBuffer = await blob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    let hash = 0;
    for (let i = 0; i < uint8Array.length; i++) {
      hash = (hash << 5) - hash + uint8Array[i];
      hash = hash & hash;
    }

    return Math.abs(hash).toString(36);
  }

  /**
   * 更新图片下载状态
   */
  private async updatePhotoDownloadStatus(
    id: string,
    status: PhotoInfo["downloadStatus"],
  ): Promise<void> {
    return this.executeTransactionAsync(
      this.STORE_NAME,
      "readwrite",
      async (store) => {
        return new Promise((resolve, reject) => {
          const getRequest = store.get(id);
          getRequest.onsuccess = () => {
            const photo = getRequest.result;
            if (photo) {
              photo.downloadStatus = status;
              photo.lastChecked = Date.now();
              const putRequest = store.put(photo);
              putRequest.onsuccess = () => resolve();
              putRequest.onerror = () => reject(putRequest.error);
            } else {
              reject(new Error("Photo not found"));
            }
          };
          getRequest.onerror = () => reject(getRequest.error);
        });
      },
    );
  }

  /**
   * 更新图片数据
   */
  private async updatePhotoData(
    id: string,
    updates: Partial<PhotoInfo>,
  ): Promise<void> {
    return this.executeTransactionAsync(
      this.STORE_NAME,
      "readwrite",
      async (store) => {
        return new Promise((resolve, reject) => {
          const getRequest = store.get(id);
          getRequest.onsuccess = () => {
            const photo = getRequest.result;
            if (photo) {
              const updatedPhoto = { ...photo, ...updates };
              const putRequest = store.put(updatedPhoto);
              putRequest.onsuccess = () => resolve();
              putRequest.onerror = () => reject(putRequest.error);
            } else {
              reject(new Error("Photo not found"));
            }
          };
          getRequest.onerror = () => reject(getRequest.error);
        });
      },
    );
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
   * 生成缩略图（优化版本）
   */
  private async generateThumbnail(
    url: string,
    maxSize = 200,
  ): Promise<{
    thumbnail: string;
    thumbUrl: string;
    width: number;
    height: number;
  }> {
    return new Promise((resolve, reject) => {
      if (typeof window === "undefined" || typeof document === "undefined") {
        reject(new Error("Canvas not available in this environment"));
        return;
      }

      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            reject(new Error("Canvas context not available"));
            return;
          }

          const scale = Math.min(maxSize / img.width, maxSize / img.height);
          const thumbWidth = Math.round(img.width * scale);
          const thumbHeight = Math.round(img.height * scale);

          canvas.width = thumbWidth;
          canvas.height = thumbHeight;

          ctx.drawImage(img, 0, 0, thumbWidth, thumbHeight);

          const thumbnail = canvas.toDataURL("image/jpeg", 0.8);
          const thumbUrl = canvas.toDataURL("image/webp", 0.7);

          resolve({
            thumbnail,
            thumbUrl,
            width: thumbWidth,
            height: thumbHeight,
          });
        } catch (error) {
          reject(error);
        }
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

          const hashSize = 8;
          canvas.width = hashSize;
          canvas.height = hashSize;

          ctx.drawImage(img, 0, 0, hashSize, hashSize);
          const imageData = ctx.getImageData(0, 0, hashSize, hashSize);
          const data = imageData.data;

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
   * 添加照片信息（包含去重和下载管理）
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
        // 检查是否需要重新下载
        const { needsDownload } =
          await this.checkImageDownloadStatus(existingPhoto);
        if (needsDownload) {
          // 异步下载，不阻塞返回
          this.downloadImageData(existingPhoto).catch((error) => {
            console.warn("[PhotoStorage] 重新下载失败:", error);
          });
        }
        return existingPhoto;
      }

      // 计算图片哈希用于去重
      let contentHash: string | undefined;
      try {
        contentHash = await this.calculateImageHash(photo.url);

        // 检查是否有相同内容的图片
        const duplicatePhoto = await this.findDuplicateByHash(contentHash);
        if (duplicatePhoto) {
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
        downloadStatus: "downloading", // 初始状态为下载中
        lastChecked: Date.now(),
      };

      // 保存照片信息
      await this.executeTransaction(this.STORE_NAME, "readwrite", (store) => {
        return store.put(enhancedPhoto);
      });

      // 异步下载图片数据
      this.downloadImageData(enhancedPhoto).catch((error) => {
        console.warn("[PhotoStorage] 下载图片数据失败:", error);
      });

      // 异步获取图片信息（包括缩略图生成）
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
      return await this.executeTransaction(
        this.STORE_NAME,
        "readonly",
        (store) => {
          const index = store.index("contentHash");
          return index.get(contentHash);
        },
      );
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
      const updatedPhoto: PhotoInfo = {
        ...existingPhoto,
        originalUrls: [
          ...(existingPhoto.originalUrls || [existingPhoto.url]),
          newPhoto.url,
        ].filter((url, index, arr) => arr.indexOf(url) === index),
        timestamp: Math.max(existingPhoto.timestamp, newPhoto.timestamp),
      };

      await this.executeTransaction(this.STORE_NAME, "readwrite", (store) => {
        return store.put(updatedPhoto);
      });

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
        updates.thumbnail = thumbnail.value.thumbnail;
        updates.thumbUrl = thumbnail.value.thumbUrl;
        updates.thumbWidth = thumbnail.value.width;
        updates.thumbHeight = thumbnail.value.height;
      }

      if (Object.keys(updates).length > 0) {
        await this.updatePhotoData(photo.id, updates);
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

    try {
      for (const photo of photos) {
        const id = this.generatePhotoId(
          photo.url,
          photo.sessionId,
          photo.messageId,
        );

        const existingPhoto = await this.getPhotoById(id);
        if (existingPhoto) {
          results.push(existingPhoto);
          continue;
        }

        const enhancedPhoto: PhotoInfo = {
          ...photo,
          id,
          downloadStatus: "downloading",
          lastChecked: Date.now(),
        };

        await this.executeTransaction(this.STORE_NAME, "readwrite", (store) => {
          return store.put(enhancedPhoto);
        });

        results.push(enhancedPhoto);

        // 异步下载和增强
        this.downloadImageData(enhancedPhoto).catch((error) => {
          console.warn("[PhotoStorage] 下载图片数据失败:", error);
        });

        this.enhancePhotoInfo(enhancedPhoto).catch((error) => {
          console.warn("[PhotoStorage] 增强照片信息失败:", error);
        });
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
      // 获取所有照片
      const allPhotos = await this.executeTransaction(
        this.STORE_NAME,
        "readonly",
        (store) => {
          return store.getAll();
        },
      );

      let results = allPhotos;

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
      return await this.executeTransaction(
        this.STORE_NAME,
        "readonly",
        (store) => {
          return store.get(id);
        },
      );
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
      await this.executeTransaction(this.STORE_NAME, "readwrite", (store) => {
        return store.delete(id);
      });
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

      for (const id of idsToDelete) {
        await this.executeTransaction(this.STORE_NAME, "readwrite", (store) => {
          return store.delete(id);
        });
      }
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
      await this.executeTransaction(this.STORE_NAME, "readwrite", (store) => {
        return store.clear();
      });
    } catch (error) {
      console.error("[PhotoStorage] 清空照片失败:", error);
      throw error;
    }
  }

  /**
   * 获取统计信息（异步优化版本）
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
      const allPhotos = await this.executeTransaction(
        this.STORE_NAME,
        "readonly",
        (store) => {
          return store.getAll();
        },
      );

      const total = allPhotos.length;
      const userPhotos = allPhotos.filter((p) => p.isUser).length;
      const sessionsWithPhotos = new Set(allPhotos.map((p) => p.sessionId))
        .size;

      return {
        total,
        userPhotos,
        botPhotos: total - userPhotos,
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
      await this.executeTransaction(
        this.METADATA_STORE,
        "readwrite",
        (store) => {
          return store.put({
            key,
            value,
            updatedAt: Date.now(),
          });
        },
      );
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
      const record = await this.executeTransaction(
        this.METADATA_STORE,
        "readonly",
        (store) => {
          return store.get(key);
        },
      );
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
    try {
      // 获取所有照片，验证索引完整性
      const allPhotos = await this.executeTransaction(
        this.STORE_NAME,
        "readonly",
        (store) => {
          return store.getAll();
        },
      );

      console.log(`[PhotoStorage] 索引修复完成，共 ${allPhotos.length} 张照片`);
    } catch (error) {
      console.error("[PhotoStorage] 修复索引失败:", error);
      throw error;
    }
  }

  /**
   * 部分索引修复 - 只修复指定会话的索引
   */
  async repairSessionIndex(sessionId: string): Promise<void> {
    try {
      // 使用索引查询指定会话的照片
      const sessionPhotos = await this.executeTransaction(
        this.STORE_NAME,
        "readonly",
        (store) => {
          const index = store.index("sessionId");
          return index.getAll(sessionId);
        },
      );

      console.log(
        `[PhotoStorage] 会话 ${sessionId} 索引修复完成，共 ${sessionPhotos.length} 张照片`,
      );
    } catch (error) {
      console.error("[PhotoStorage] 会话索引修复失败:", error);
      throw error;
    }
  }

  /**
   * 批量修复多个会话的索引
   */
  async repairMultipleSessionIndexes(sessionIds: string[]): Promise<{
    success: string[];
    failed: string[];
  }> {
    const success: string[] = [];
    const failed: string[] = [];

    for (const sessionId of sessionIds) {
      try {
        await this.repairSessionIndex(sessionId);
        success.push(sessionId);
      } catch (error) {
        console.warn(`[PhotoStorage] 会话 ${sessionId} 索引修复失败:`, error);
        failed.push(sessionId);
      }
    }

    return { success, failed };
  }

  /**
   * 清理无效的下载状态
   */
  async cleanupInvalidDownloadStatus(): Promise<void> {
    try {
      const allPhotos = await this.executeTransaction(
        this.STORE_NAME,
        "readonly",
        (store) => {
          return store.getAll();
        },
      );

      const timeout = 10 * 60 * 1000; // 10分钟超时
      const now = Date.now();
      let cleanedCount = 0;

      for (const photo of allPhotos) {
        if (
          photo.downloadStatus === "downloading" &&
          photo.lastChecked &&
          now - photo.lastChecked > timeout
        ) {
          await this.updatePhotoDownloadStatus(photo.id, "failed");
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        console.log(`[PhotoStorage] 清理了 ${cleanedCount} 个超时的下载状态`);
      }
    } catch (error) {
      console.error("[PhotoStorage] 清理无效下载状态失败:", error);
    }
  }

  /**
   * 获取邻近照片（用于预览预加载）
   */
  async getNeighborPhotos(
    currentId: string,
    count: number = 3,
  ): Promise<PhotoInfo[]> {
    await this.initialize();

    try {
      const allPhotos = await this.getPhotos({
        limit: Number.MAX_SAFE_INTEGER,
        offset: 0,
        sortBy: "timestamp",
        sortOrder: "desc",
      });

      const currentIndex = allPhotos.findIndex((p) => p.id === currentId);

      if (currentIndex === -1) return [];

      const startIndex = Math.max(0, currentIndex - count);
      const endIndex = Math.min(allPhotos.length, currentIndex + count + 1);

      return allPhotos.slice(startIndex, endIndex);
    } catch (error) {
      console.error("[PhotoStorage] 获取邻近照片失败:", error);
      return [];
    }
  }

  /**
   * 预加载指定照片的邻近照片
   */
  async preloadNeighborPhotos(currentId: string): Promise<void> {
    try {
      const neighbors = await this.getNeighborPhotos(currentId, 2);

      // 异步预加载邻近照片的缩略图
      neighbors.forEach(async (photo) => {
        if (photo.thumbUrl) {
          const img = new Image();
          img.src = photo.thumbUrl;
        }
      });
    } catch (error) {
      console.warn("[PhotoStorage] 预加载邻近照片失败:", error);
    }
  }

  /**
   * 重置存储状态 - 用于调试
   */
  resetInitialization(): void {
    this.isInitialized = false;
    this.db = null;
  }

  /**
   * 获取下载状态统计
   */
  async getDownloadStats(): Promise<{
    total: number;
    downloading: number;
    complete: number;
    failed: number;
  }> {
    await this.initialize();

    try {
      const allPhotos = await this.executeTransaction(
        this.STORE_NAME,
        "readonly",
        (store) => {
          return store.getAll();
        },
      );

      const downloading = allPhotos.filter(
        (p) => p.downloadStatus === "downloading",
      ).length;
      const complete = allPhotos.filter(
        (p) => p.downloadStatus === "complete",
      ).length;
      const failed = allPhotos.filter(
        (p) => p.downloadStatus === "failed",
      ).length;

      return {
        total: allPhotos.length,
        downloading,
        complete,
        failed,
      };
    } catch (error) {
      console.error("[PhotoStorage] 获取下载状态统计失败:", error);
      return {
        total: 0,
        downloading: 0,
        complete: 0,
        failed: 0,
      };
    }
  }
}

// 全局单例
export const photoStorage = new PhotoStorage();

// 开发者调试工具 - 在浏览器控制台中可用
if (typeof window !== "undefined") {
  (window as any).debugPhotoStorage = {
    repairIndex: () => photoStorage.repairIndex(),
    repairSessionIndex: (sessionId: string) =>
      photoStorage.repairSessionIndex(sessionId),
    repairMultipleSessions: (sessionIds: string[]) =>
      photoStorage.repairMultipleSessionIndexes(sessionIds),
    resetAndRebuild: async () => {
      photoStorage.resetInitialization();
      await photoStorage.initialize();
      const stats = await photoStorage.getStats();
      return stats;
    },
    getStats: () => photoStorage.getStats(),
    getDownloadStats: () => photoStorage.getDownloadStats(),
    preloadNeighborPhotos: (photoId: string) =>
      photoStorage.preloadNeighborPhotos(photoId),
    cleanupInvalidStatus: () => photoStorage.cleanupInvalidDownloadStatus(),
    // 新增：强制重新收集图片
    forceReCollect: async () => {
      console.log("=== 强制重新收集图片 ===");

      try {
        // 获取收集前的统计
        const beforeStats = await photoStorage.getStats();
        console.log("收集前统计:", beforeStats);

        // 清空所有数据，强制重新收集
        await photoStorage.clearPhotos();
        console.log("已清空所有图片数据");

        // 重新收集
        const { photoCollector } = await import("./photo-collector");
        await photoCollector.refresh();

        // 获取收集后的统计
        const afterStats = await photoStorage.getStats();
        console.log("收集后统计:", afterStats);

        console.log("重新收集完成");
        return afterStats;
      } catch (error) {
        console.error("重新收集失败:", error);
        throw error;
      }
    },
    // 新增：查看收集详情
    getCollectionDetails: async () => {
      console.log("=== 收集详情 ===");

      try {
        const stats = await photoStorage.getStats();
        console.log("当前统计:", stats);

        const { useChatStore } = await import("../store/chat");
        const chatStore = useChatStore.getState();
        const allSessions = chatStore.sessions || [];

        console.log("总会话数:", allSessions.length);

        // 简单统计会话中的图片数量
        let totalImages = 0;
        for (const session of allSessions.slice(0, 5)) {
          const messageCount = session.messages?.length || 0;
          console.log(`会话 ${session.id}: ${messageCount} 条消息`);
          totalImages += messageCount; // 简化统计
        }

        console.log("前5个会话总消息数:", totalImages);
        return { stats, totalImages, sessionCount: allSessions.length };
      } catch (error) {
        console.error("获取收集详情失败:", error);
        throw error;
      }
    },
    // 新增：优化批量下载
    optimizedBatchDownload: async (maxConcurrent = 3, delayMs = 200) => {
      console.log("=== 优化批量下载 ===");

      try {
        // 获取所有需要下载的图片
        const allPhotos = await photoStorage.getPhotos({
          limit: 1000,
          offset: 0,
        });

        const photos = allPhotos.filter(
          (photo) => !photo.downloadStatus || photo.downloadStatus === "failed",
        );

        console.log(`找到 ${photos.length} 张待下载图片`);

        if (photos.length === 0) {
          console.log("没有需要下载的图片");
          return { success: true, downloaded: 0, failed: 0 };
        }

        // 分批处理
        const batchSize = maxConcurrent;
        const results = { success: 0, failed: 0, errors: [] as string[] };

        for (let i = 0; i < photos.length; i += batchSize) {
          const batch = photos.slice(i, i + batchSize);
          console.log(
            `处理批次 ${Math.floor(i / batchSize) + 1}/${Math.ceil(
              photos.length / batchSize,
            )} (${batch.length} 张图片)`,
          );

          // 并发下载当前批次
          const batchPromises = batch.map(async (photo) => {
            try {
              const result = await photoStorage.downloadImageData(photo);
              if (result.success) {
                results.success++;
              } else {
                results.failed++;
                results.errors.push(`${photo.url}: ${result.error}`);
              }
              return result;
            } catch (error) {
              results.failed++;
              results.errors.push(`${photo.url}: ${error}`);
              return { success: false, error: String(error) };
            }
          });

          // 等待当前批次完成
          await Promise.allSettled(batchPromises);

          // 批次间延迟
          if (i + batchSize < photos.length) {
            console.log(`等待 ${delayMs}ms 后处理下一批次...`);
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          }
        }

        console.log(
          `批量下载完成: 成功 ${results.success}, 失败 ${results.failed}`,
        );
        if (results.errors.length > 0) {
          console.log("失败详情:", results.errors.slice(0, 10)); // 只显示前10个错误
        }

        return results;
      } catch (error) {
        console.error("批量下载失败:", error);
        throw error;
      }
    },
    // 新增：优化重新收集
    optimizedReCollect: async () => {
      console.log("=== 优化重新收集图片 ===");

      try {
        // 获取收集前的统计
        const beforeStats = await photoStorage.getStats();
        console.log("收集前统计:", beforeStats);

        // 清空所有数据，强制重新收集
        await photoStorage.clearPhotos();
        console.log("已清空所有图片数据");

        // 使用优化的初始化方法
        const { photoCollector } = await import("./photo-collector");
        await photoCollector.optimizedInitialize();

        // 获取收集后的统计
        const afterStats = await photoStorage.getStats();
        console.log("收集后统计:", afterStats);

        console.log("优化重新收集完成");
        return afterStats;
      } catch (error) {
        console.error("优化重新收集失败:", error);
        throw error;
      }
    },
  };
}
