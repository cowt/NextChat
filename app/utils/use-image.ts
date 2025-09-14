/**
 * React Hook for image loading with cache and deduplication
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { imageManager, ImageLoadResult } from "./image-manager";

export interface UseImageOptions {
  /** 是否启用加载 */
  enabled?: boolean;
  /** 是否强制重新加载 */
  forceReload?: boolean;
  /** 是否压缩图片 */
  compress?: boolean;
  /** 延迟加载（毫秒） */
  delay?: number;
  /** 图片加载完成的回调 */
  onLoad?: (result: ImageLoadResult) => void;
  /** 图片加载出错的回调 */
  onError?: (error: string) => void;
}

export interface UseImageReturn {
  /** 图片数据URL */
  dataUrl?: string;
  /** 原始Blob */
  blob?: Blob;
  /** 是否正在加载 */
  loading: boolean;
  /** 错误信息 */
  error?: string;
  /** 图片尺寸 */
  width?: number;
  height?: number;
  /** 重新加载 */
  reload: () => void;
  /** 清除当前图片缓存 */
  clearCache: () => void;
}

/**
 * 单个图片加载Hook
 */
export function useImage(
  url: string | undefined,
  options: UseImageOptions = {},
): UseImageReturn {
  const {
    enabled = true,
    forceReload = false,
    compress = true,
    delay = 0,
    onLoad,
    onError,
  } = options;

  const [state, setState] = useState<{
    dataUrl?: string;
    blob?: Blob;
    loading: boolean;
    error?: string;
    width?: number;
    height?: number;
  }>({
    loading: false,
  });

  const onLoadRef = useRef(onLoad);
  const onErrorRef = useRef(onError);
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastUrlRef = useRef<string | undefined>(url);

  // 更新回调引用
  useEffect(() => {
    onLoadRef.current = onLoad;
    onErrorRef.current = onError;
  }, [onLoad, onError]);

  const reload = useCallback(() => {
    if (!url) return;

    // 取消之前的请求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    setState((prev) => ({ ...prev, loading: true, error: undefined }));
    abortControllerRef.current = new AbortController();

    imageManager
      .loadImage(url, {
        forceReload: true,
        compress,
      })
      .then((result) => {
        if (!abortControllerRef.current?.signal.aborted) {
          setState({
            dataUrl: result.dataUrl,
            blob: result.blob,
            loading: false,
            error: result.error,
            width: result.width,
            height: result.height,
          });

          if (result.error) {
            onErrorRef.current?.(result.error);
          } else {
            onLoadRef.current?.(result);
          }
        }
      })
      .catch((error) => {
        if (!abortControllerRef.current?.signal.aborted) {
          const errorMsg =
            error instanceof Error ? error.message : "Unknown error";
          setState((prev) => ({
            ...prev,
            loading: false,
            error: errorMsg,
          }));
          onErrorRef.current?.(errorMsg);
        }
      });
  }, [url, compress]);

  const clearCache = useCallback(() => {
    if (url) {
      imageManager.clearCache(url);
    }
  }, [url]);

  useEffect(() => {
    if (!url || !enabled) {
      setState({ loading: false });
      return;
    }

    // 检查URL是否变化
    const urlChanged = lastUrlRef.current !== url;
    lastUrlRef.current = url;

    // 如果URL变化，取消之前的请求
    if (urlChanged && abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const loadImage = async () => {
      // 延迟加载
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        if (abortControllerRef.current?.signal.aborted) return;
      }

      try {
        // 创建新的AbortController
        abortControllerRef.current = new AbortController();

        const result = await imageManager.loadImage(url, {
          forceReload,
          compress,
        });

        if (!abortControllerRef.current?.signal.aborted) {
          setState({
            dataUrl: result.dataUrl,
            blob: result.blob,
            loading: false,
            error: result.error,
            width: result.width,
            height: result.height,
          });

          if (result.error) {
            onErrorRef.current?.(result.error);
          } else {
            onLoadRef.current?.(result);
          }
        }
      } catch (error) {
        if (!abortControllerRef.current?.signal.aborted) {
          const errorMsg =
            error instanceof Error ? error.message : "Unknown error";
          setState((prev) => ({
            ...prev,
            loading: false,
            error: errorMsg,
          }));
          onErrorRef.current?.(errorMsg);
        }
      }
    };

    // 先检查缓存状态
    const cached = imageManager.getCacheStatus(url);

    // 如果有完整的缓存且不强制重新加载，直接使用缓存
    if (cached && cached.dataUrl && !cached.error && !forceReload) {
      setState({
        dataUrl: cached.dataUrl,
        blob: cached.blob,
        loading: false,
        error: undefined,
        width: cached.width,
        height: cached.height,
      });
      onLoadRef.current?.(cached);
      return; // 直接返回，不进行任何加载
    }

    // 如果正在加载中，也进入统一的加载逻辑（会复用去重 Promise），
    if (cached && cached.loading) {
      setState((prev) => ({
        ...prev,
        loading: true,
        error: undefined,
      }));
      // 不 return，继续走下方统一的加载流程
    }

    // 设置加载状态并开始加载
    setState((prev) => ({ ...prev, loading: true, error: undefined }));
    loadImage();

    // 清理函数
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [url, enabled, forceReload, compress, delay]);

  return {
    dataUrl: state.dataUrl,
    blob: state.blob,
    loading: state.loading,
    error: state.error,
    width: state.width,
    height: state.height,
    reload,
    clearCache,
  };
}

/**
 * 多个图片加载Hook
 */
export function useImages(
  urls: string[],
  options: UseImageOptions = {},
): {
  images: Record<string, UseImageReturn>;
  allLoading: boolean;
  hasErrors: boolean;
  loadedCount: number;
  totalCount: number;
} {
  const [imageStates, setImageStates] = useState<
    Record<string, UseImageReturn>
  >({});

  const {
    enabled = true,
    forceReload = false,
    compress = true,
    delay = 0,
    onLoad,
    onError,
  } = options;

  useEffect(() => {
    if (!enabled || urls.length === 0) {
      setImageStates({});
      return;
    }

    const loadImages = async () => {
      const newStates: Record<string, UseImageReturn> = {};

      // 初始化状态
      urls.forEach((url) => {
        const cached = imageManager.getCacheStatus(url);
        newStates[url] = {
          dataUrl: cached?.dataUrl,
          blob: cached?.blob,
          loading: cached?.loading ?? true,
          error: cached?.error,
          width: cached?.width,
          height: cached?.height,
          reload: () => {},
          clearCache: () => imageManager.clearCache(url),
        };
      });

      setImageStates(newStates);

      // 批量加载
      const loadPromises = urls.map(async (url, index) => {
        try {
          // 交错延迟，避免同时发起大量请求
          if (delay > 0) {
            await new Promise((resolve) =>
              setTimeout(resolve, delay + index * 50),
            );
          }

          const result = await imageManager.loadImage(url, {
            forceReload,
            compress,
          });

          setImageStates((prev) => ({
            ...prev,
            [url]: {
              ...prev[url],
              dataUrl: result.dataUrl,
              blob: result.blob,
              loading: false,
              error: result.error,
              width: result.width,
              height: result.height,
            },
          }));

          if (result.error) {
            onError?.(result.error);
          } else {
            onLoad?.(result);
          }
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : "Unknown error";
          setImageStates((prev) => ({
            ...prev,
            [url]: {
              ...prev[url],
              loading: false,
              error: errorMsg,
            },
          }));
          onError?.(errorMsg);
        }
      });

      await Promise.allSettled(loadPromises);
    };

    loadImages();
  }, [urls, enabled, forceReload, compress, delay, onLoad, onError]);

  const allLoading = Object.values(imageStates).some((state) => state.loading);
  const hasErrors = Object.values(imageStates).some((state) => state.error);
  const loadedCount = Object.values(imageStates).filter(
    (state) => !state.loading && !state.error,
  ).length;

  return {
    images: imageStates,
    allLoading,
    hasErrors,
    loadedCount,
    totalCount: urls.length,
  };
}

/**
 * 图片预加载Hook
 */
export function useImagePreload(urls: string[], enabled = true) {
  const [preloaded, setPreloaded] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || urls.length === 0) {
      setPreloaded(false);
      setLoading(false);
      return;
    }

    let cancelled = false;

    const preload = async () => {
      setLoading(true);
      setPreloaded(false);

      try {
        await imageManager.preloadImages(urls);
        if (!cancelled) {
          setPreloaded(true);
        }
      } catch (error) {
        // 预加载失败，静默处理
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    preload();

    return () => {
      cancelled = true;
    };
  }, [urls, enabled]);

  return { preloaded, loading };
}
