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

// 检测内容中是否包含媒体选项
function detectMediaOptions(content: string): MediaOption[] {
  const lines = content.split("\n");
  const options: MediaOption[] = [];

  console.log("🔍 检测媒体选项，内容行数:", lines.length);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // 检测markdown复选框格式：- [ ] 内容
    const checkboxMatch = line.match(/^-\s*\[\s*\]\s*(.+)/);

    // 调试：打印包含复选框的行
    if (line.includes("- [ ]")) {
      console.log("🔍 检查复选框行:", line);
      console.log("🔍 复选框匹配结果:", checkboxMatch);
    }

    if (checkboxMatch) {
      console.log("✅ 找到复选框格式:", line);
      const checkboxContent = checkboxMatch[1].trim();

      // 提取媒体URL
      const urlMatch = checkboxContent.match(/(https?:\/\/[^\s]+)/);
      if (urlMatch) {
        const url = urlMatch[1];
        console.log("🔗 找到URL:", url);

        const isMediaUrl =
          /\.(jpg|jpeg|png|gif|webp|svg|mp4|mp3|wav|ogg|pdf|doc|docx)$/i.test(
            url,
          ) ||
          url.includes("agent_images") ||
          url.includes("image") ||
          url.includes("media") ||
          url.includes("assets") ||
          url.includes("upload");

        console.log(
          "📷 是否为媒体URL:",
          isMediaUrl,
          "包含agent_images:",
          url.includes("agent_images"),
        );

        if (isMediaUrl) {
          // 尝试从后续行获取描述
          let description = "";
          let j = i + 1;
          while (
            j < lines.length &&
            lines[j].trim() &&
            !lines[j].trim().match(/^-\s*\[\s*\]/)
          ) {
            description += lines[j].trim() + " ";
            j++;
          }

          // 从复选框内容中提取标题
          let title = checkboxContent;
          if (checkboxContent.includes("**")) {
            // 提取粗体文本作为标题
            const titleMatch = checkboxContent.match(/\*\*(.+?)\*\*/);
            if (titleMatch) {
              title = titleMatch[1];
            }
          }

          const option = {
            id: `option-${i + 1}`,
            title: title.length > 30 ? title.substring(0, 30) + "..." : title,
            description: description.trim() || "媒体选项",
            imageUrl: url,
            originalText: line,
          };

          console.log("🎯 创建选项:", option);
          options.push(option);
        }
      }
    }
  }

  console.log("📋 最终检测到的选项数量:", options.length);
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

  console.log("🎨 MediaOptionSelector 渲染，选项数量:", mediaOptions.length);
  console.log("📝 内容预览:", content.substring(0, 200) + "...");

  // 如果没有检测到媒体选项，返回null
  if (mediaOptions.length === 0) {
    console.log("❌ 没有检测到媒体选项，返回null");
    return null;
  }

  const handleSelection = (option: MediaOption) => {
    // 使用纯URL作为选择键，避免格式干扰
    const isSelected = selectedOptions.has(option.imageUrl);
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
            const isSelected = selectedOptions.has(option.imageUrl);

            return (
              <div
                key={option.id}
                className={clsx(
                  styles["option-card"],
                  isSelected ? styles.selected : "",
                )}
                onClick={() => handleSelection(option)}
              >
                {/* 图片容器 */}
                <div className={styles["image-container"]}>
                  <img
                    src={option.imageUrl}
                    alt={option.title}
                    className={styles["option-image"]}
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      // 图片加载失败时显示占位符
                      const target = e.target as HTMLImageElement;
                      target.style.display = "none";
                      target.nextElementSibling?.classList.remove(
                        styles.hidden,
                      );
                    }}
                  />

                  {/* 图片加载失败时的占位符 */}
                  <div
                    className={clsx(styles["image-placeholder"], styles.hidden)}
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

                {/* 文字信息 */}
                <div className={styles["text-content"]}>
                  <h3 className={styles["option-title"]}>{option.title}</h3>
                  <p className={styles["option-description"]}>
                    {option.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
