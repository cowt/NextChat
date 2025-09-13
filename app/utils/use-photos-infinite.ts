"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { photoCollector } from "./photo-collector";
import type { PhotoInfo } from "./photo-storage";

const FIRST_PAGE_SIZE = 12;
const PAGE_SIZE = 20;

export function usePhotosInfinite() {
  return useInfiniteQuery({
    queryKey: ["photos"] as const,
    initialPageParam: 0,
    queryFn: async ({ pageParam }: { pageParam: number }) => {
      // pageParam 表示第几页
      const page = pageParam ?? 0;
      if (page === 0) {
        await photoCollector.initialize();
        try {
          return await photoCollector.getPhotos({
            limit: FIRST_PAGE_SIZE,
            offset: 0,
          });
        } catch {
          return await photoCollector.getPhotosFromSessions();
        }
      }
      const offset = FIRST_PAGE_SIZE + (page - 1) * PAGE_SIZE;
      return await photoCollector.getPhotos({ limit: PAGE_SIZE, offset });
    },
    getNextPageParam: (lastPage: PhotoInfo[], allPages: PhotoInfo[][]) => {
      const size = allPages.length;
      const expected = size === 1 ? FIRST_PAGE_SIZE : PAGE_SIZE;
      return lastPage.length > 0 && lastPage.length >= expected
        ? size
        : undefined;
    },
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });
}
