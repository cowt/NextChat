/**
 * 照片瀑布流相关的 React Hook
 * 提供图片尺寸检测、预加载和优化功能
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { PhotoInfo } from "./photo-storage";

export interface UsePhotoMasonryOptions {
  preloadCount?: number; // 预加载图片数量
  enableLazyLoad?: boolean; // 是否启用懒加载
  enableOptimization?: boolean; // 是否启用图片优化
}

export interface PhotoWithDimensions extends PhotoInfo {
  loaded: boolean;
  loading: boolean;
  error: boolean;
  naturalWidth?: number;
  naturalHeight?: number;
  optimizedUrl?: string;
}

export function usePhotoMasonry(
  photos: PhotoInfo[],
  options: UsePhotoMasonryOptions = {},
) {
  const {
    preloadCount = 20,
    enableLazyLoad = true,
    enableOptimization = true,
  } = options;

  const [enhancedPhotos, setEnhancedPhotos] = useState<PhotoWithDimensions[]>(
    [],
  );
  const [loadingCount, setLoadingCount] = useState(0);
  const imageRefs = useRef<Map<string, HTMLImageElement>>(new Map());
  const intersectionObserver = useRef<IntersectionObserver | null>(null);

  // 获取图片尺寸
  const getImageDimensions = useCallback(
    (
      url: string,
    ): Promise<{
      width: number;
      height: number;
    }> => {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          resolve({
            width: img.naturalWidth,
            height: img.naturalHeight,
          });
        };
        img.onerror = reject;
        img.src = url;
      });
    },
    [],
  );

  // 创建优化的图片 URL
  const createOptimizedUrl = useCallback(
    (url: string, width: number, height: number): string => {
      if (!enableOptimization) return url;

      // 对于 base64 图片，直接返回原 URL
      if (url.startsWith("data:")) return url;

      // 这里可以添加图片压缩服务的逻辑
      // 例如：return `${CDN_URL}/${encodeURIComponent(url)}?w=${width}&h=${height}&q=80`;

      return url;
    },
    [enableOptimization],
  );

  // 预加载图片
  const preloadImage = useCallback(
    async (photo: PhotoInfo): Promise<PhotoWithDimensions> => {
      const initialPhoto: PhotoWithDimensions = {
        ...photo,
        loaded: false,
        loading: true,
        error: false,
      };

      try {
        let dimensions = { width: 0, height: 0 };

        // 首先尝试使用存储的尺寸信息
        if (photo.width && photo.height) {
          dimensions = { width: photo.width, height: photo.height };
        } else {
          // 获取实际图片尺寸
          dimensions = await getImageDimensions(photo.url);
        }

        const optimizedUrl = createOptimizedUrl(
          photo.url,
          dimensions.width,
          dimensions.height,
        );

        return {
          ...initialPhoto,
          naturalWidth: dimensions.width,
          naturalHeight: dimensions.height,
          optimizedUrl,
          loaded: true,
          loading: false,
        };
      } catch (error) {
        console.warn(`[usePhotoMasonry] 预加载图片失败: ${photo.url}`, error);
        return {
          ...initialPhoto,
          loaded: false,
          loading: false,
          error: true,
        };
      }
    },
    [getImageDimensions, createOptimizedUrl],
  );

  // 批量预加载图片
  const preloadBatch = useCallback(
    async (photos: PhotoInfo[], startIndex = 0) => {
      const batch = photos.slice(startIndex, startIndex + preloadCount);
      if (batch.length === 0) return;

      setLoadingCount((prev) => prev + batch.length);

      try {
        const promises = batch.map(preloadImage);
        const results = await Promise.allSettled(promises);

        const enhancedBatch = results.map((result, index) => {
          if (result.status === "fulfilled") {
            return result.value;
          } else {
            const photo = batch[index];
            return {
              ...photo,
              loaded: false,
              loading: false,
              error: true,
            } as PhotoWithDimensions;
          }
        });

        setEnhancedPhotos((prev) => {
          const newPhotos = [...prev];
          enhancedBatch.forEach((enhancedPhoto, index) => {
            const globalIndex = startIndex + index;
            newPhotos[globalIndex] = enhancedPhoto;
          });
          return newPhotos;
        });
      } finally {
        setLoadingCount((prev) => prev - batch.length);
      }
    },
    [preloadCount, preloadImage],
  );

  // 设置懒加载观察器
  useEffect(() => {
    if (!enableLazyLoad) return;

    intersectionObserver.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const index = parseInt(
              entry.target.getAttribute("data-index") || "0",
              10,
            );
            const photo = photos[index];
            const enhancedPhoto = enhancedPhotos[index];

            if (photo && !enhancedPhoto?.loaded && !enhancedPhoto?.loading) {
              preloadBatch(photos, index);
            }
          }
        });
      },
      {
        rootMargin: "50px",
        threshold: 0.1,
      },
    );

    return () => {
      intersectionObserver.current?.disconnect();
    };
  }, [enableLazyLoad, photos, enhancedPhotos, preloadBatch]);

  // 初始化增强照片数组
  useEffect(() => {
    if (photos.length === 0) {
      setEnhancedPhotos([]);
      return;
    }

    // 创建初始的增强照片数组
    const initialEnhanced = photos.map((photo) => ({
      ...photo,
      loaded: false,
      loading: false,
      error: false,
    }));

    setEnhancedPhotos(initialEnhanced);

    // 立即预加载前几张图片
    if (!enableLazyLoad) {
      preloadBatch(photos, 0);
    }
  }, [photos, enableLazyLoad, preloadBatch]);

  // 手动触发图片加载
  const loadPhoto = useCallback(
    (index: number) => {
      const photo = photos[index];
      const enhancedPhoto = enhancedPhotos[index];

      if (photo && !enhancedPhoto?.loaded && !enhancedPhoto?.loading) {
        preloadBatch(photos, index);
      }
    },
    [photos, enhancedPhotos, preloadBatch],
  );

  // 注册懒加载元素
  const registerElement = useCallback(
    (element: HTMLElement | null, index: number) => {
      if (!element || !enableLazyLoad || !intersectionObserver.current) return;

      element.setAttribute("data-index", index.toString());
      intersectionObserver.current.observe(element);

      return () => {
        if (intersectionObserver.current) {
          intersectionObserver.current.unobserve(element);
        }
      };
    },
    [enableLazyLoad],
  );

  // 计算已加载和总计数
  const stats = {
    totalCount: photos.length,
    loadedCount: enhancedPhotos.filter((p) => p.loaded).length,
    errorCount: enhancedPhotos.filter((p) => p.error).length,
    loadingCount,
  };

  return {
    enhancedPhotos,
    loadPhoto,
    registerElement,
    stats,
  };
}

// 图片优化工具函数
export function optimizeImageSize(
  originalWidth: number,
  originalHeight: number,
  maxWidth: number,
  maxHeight?: number,
): { width: number; height: number } {
  if (!maxHeight) maxHeight = maxWidth;

  const aspectRatio = originalWidth / originalHeight;

  let width = originalWidth;
  let height = originalHeight;

  // 如果宽度超限，按宽度缩放
  if (width > maxWidth) {
    width = maxWidth;
    height = width / aspectRatio;
  }

  // 如果高度仍然超限，按高度缩放
  if (height > maxHeight) {
    height = maxHeight;
    width = height * aspectRatio;
  }

  return {
    width: Math.round(width),
    height: Math.round(height),
  };
}

// 估算图片文件大小
export function estimateImageSize(
  width: number,
  height: number,
  format = "jpeg",
): number {
  const pixels = width * height;

  // 不同格式的大致压缩比
  const compressionRatios = {
    jpeg: 0.1, // JPEG 通常压缩到原始大小的 10%
    png: 0.3, // PNG 压缩比较低
    webp: 0.08, // WebP 压缩效果最好
  };

  const ratio =
    compressionRatios[format as keyof typeof compressionRatios] || 0.1;
  return Math.round(pixels * 3 * ratio); // 3 bytes per pixel (RGB)
}
