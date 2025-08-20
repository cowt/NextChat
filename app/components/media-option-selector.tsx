import { useState, useMemo, useEffect } from "react";
import clsx from "clsx";
import styles from "./media-option-selector.module.scss";

interface MediaOption {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  originalText: string;
}

interface MediaOptionSelectorProps {
  content: string;
  onOptionSelect?: (option: MediaOption, selected: boolean) => void;
  selectedOptions?: Set<string>;
}

// 检测内容中是否包含媒体/文字选项
function detectMediaOptions(content: string): MediaOption[] {
  const lines = content.split("\n");
  const options: MediaOption[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // 检测markdown复选框格式：- [ ] 内容
    const checkboxMatch = line.match(/^\s*-\s*\[\s*\]\s*(.+)/);

    // 调试：打印包含复选框的行
    if (line.includes("- [ ]")) {
    }

    if (checkboxMatch) {
      const checkboxContent = checkboxMatch[1].trim();

      // 提取媒体URL（若存在）
      const urlMatch = checkboxContent.match(/(https?:\/\/[^\s]+)/);
      const url = urlMatch ? urlMatch[1] : "";
      const isMediaUrl = url
        ? /\.(jpg|jpeg|png|gif|webp|svg|mp4|mp3|wav|ogg|pdf|doc|docx)$/i.test(
            url,
          ) ||
          url.includes("agent_images") ||
          url.includes("image") ||
          url.includes("media") ||
          url.includes("assets") ||
          url.includes("upload")
        : false;

      // 尝试从后续行获取描述
      let description = "";
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j].trim();
        // 终止条件：空行 / 新的复选项 / 纯标签（如 </tools> 等）
        const isNextOption = /^\s*-\s*\[\s*\]/.test(next);
        const isPureTag = /^(?:<\/?[\w:-]+(?:\s+[^>]*)?>\s*)+$/.test(next);
        if (!next || isNextOption || isPureTag) break;
        description += next + " ";
        j++;
      }

      // 计算显示编号（仅统计有效选项）
      const displayIndex = options.length + 1;

      // 同行内的文字描述（如：**Option 1**：后面的部分）
      let inlineDesc = "";
      const colonIndex = checkboxContent.indexOf("：");
      if (colonIndex >= 0) {
        inlineDesc = checkboxContent.slice(colonIndex + 1).trim();
      }

      // 标题优先级：加粗文本 > 冒号左侧 > 占位“选项 N”
      const boldTitle = checkboxContent.match(/\*\*(.+?)\*\*/)?.[1];
      const title = boldTitle
        ? boldTitle
        : colonIndex >= 0
        ? checkboxContent.slice(0, colonIndex).trim()
        : `选项 ${displayIndex}`;

      // 描述优先级：
      // - 媒体：后续行描述，否则“媒体选项”
      // - 文本：同行冒号右侧 > 后续行描述 > 当前整行文本
      const computedDesc = isMediaUrl
        ? description || "媒体选项"
        : inlineDesc || description || checkboxContent;

      const option: MediaOption = {
        id: `option-${i + 1}`,
        title,
        description: computedDesc.trim(),
        imageUrl: isMediaUrl ? url : "",
        originalText: checkboxContent,
      };

      options.push(option);
    }
  }

  return options;
}

export function MediaOptionSelector({
  content,
  onOptionSelect,
  selectedOptions = new Set(),
}: MediaOptionSelectorProps) {
  const mediaOptions = useMemo(() => detectMediaOptions(content), [content]);

  // 根据选项数量与视口宽度，动态设置列数
  const [gridCols, setGridCols] = useState<number>(2);

  useEffect(() => {
    const computeCols = () => {
      const isDesktop =
        typeof window !== "undefined" ? window.innerWidth >= 768 : false;
      const maxCols = isDesktop ? 5 : 3;
      const cols = Math.min(Math.max(mediaOptions.length, 1), maxCols);
      setGridCols(cols);
    };
    computeCols();
    if (typeof window !== "undefined") {
      window.addEventListener("resize", computeCols);
      return () => window.removeEventListener("resize", computeCols);
    }
  }, [mediaOptions.length]);

  // 如果没有检测到媒体选项，返回null
  if (mediaOptions.length === 0) {
    return null;
  }

  const handleSelection = (option: MediaOption) => {
    // 使用图片URL或原始文本作为选择键，文本选项也可复用
    const key = option.imageUrl || option.originalText;
    const isSelected = selectedOptions.has(key);
    onOptionSelect?.(option, !isSelected);
  };

  return (
    <div className={styles["media-option-selector"]}>
      <div className={styles["selector-container"]}>
        <h2 className={styles["selector-title"]}>请选择您偏好的选项：</h2>

        <div
          className={styles["options-grid"]}
          data-cols={gridCols}
          style={{ ["--media-grid-cols" as any]: String(gridCols) }}
        >
          {mediaOptions.map((option) => {
            const key = option.imageUrl || option.originalText;
            const isSelected = selectedOptions.has(key);

            return (
              <div
                key={option.id}
                className={clsx(
                  styles["option-card"],
                  isSelected ? styles.selected : "",
                )}
                onClick={() => handleSelection(option)}
              >
                {option.imageUrl ? (
                  // 图片卡片：只显示图片
                  <div className={styles["image-container"]}>
                    <img
                      src={option.imageUrl}
                      alt={option.title}
                      className={styles["option-image"]}
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                      data-no-preview
                      onError={(e) => {
                        // 图片加载失败时显示占位符
                        const target = e.target as HTMLImageElement;
                        target.style.display = "none";
                        (
                          target.nextElementSibling as HTMLElement
                        )?.classList.remove(styles.hidden);
                      }}
                    />

                    {/* 图片加载失败时的占位符 */}
                    <div
                      className={clsx(
                        styles["image-placeholder"],
                        styles.hidden,
                      )}
                    >
                      <div className={styles["placeholder-content"]}>
                        <div className={styles["placeholder-icon"]}>🖼️</div>
                        <div className={styles["placeholder-text"]}>
                          图片加载失败
                        </div>
                      </div>
                    </div>

                    {/* 选中状态覆盖层 */}
                    <div
                      className={clsx(
                        styles["selection-overlay"],
                        isSelected ? styles.selected : styles.unselected,
                      )}
                    />

                    {/* 选中状态指示 */}
                    <div
                      className={clsx(
                        styles.checkbox,
                        isSelected ? styles.selected : styles.unselected,
                      )}
                    ></div>
                  </div>
                ) : (
                  // 文字卡片：主次分明（标题 2 行 + 描述 3 行）
                  <div className={styles["text-container"]}>
                    <div className={styles["text-only"]}>
                      <div className={styles["text-only-title"]}>
                        {option.title}
                      </div>
                      <div className={styles["text-only-desc"]}>
                        {option.description}
                      </div>
                    </div>

                    {/* 选中态复用 */}
                    <div
                      className={clsx(
                        styles["selection-overlay"],
                        isSelected ? styles.selected : styles.unselected,
                      )}
                    />
                    <div
                      className={clsx(
                        styles.checkbox,
                        isSelected ? styles.selected : styles.unselected,
                      )}
                    ></div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
