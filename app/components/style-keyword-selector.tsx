"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import styles from "./style-keyword-selector.module.scss";
import PaletteIcon from "../icons/palette.svg";
import clsx from "clsx";
import { STYLE_KEYWORDS, StyleKeywordGroup } from "../config/style-keywords";

export type StyleKeywordSelectorProps = {
  data?: StyleKeywordGroup[];
  value?: string[];
  onChange?: (keywords: string[]) => void;
  className?: string;
};

export function StyleKeywordSelector(props: StyleKeywordSelectorProps) {
  const groups = useMemo(() => props.data ?? STYLE_KEYWORDS, [props.data]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [selected, setSelected] = useState<string[]>(props.value ?? []);
  const scrollRef = useRef<HTMLDivElement>(null);

  const active = groups[activeIndex];
  const activeNames = useMemo(
    () => Array.from(new Set(active?.styleName ?? [])),
    // 依赖 activeIndex 保证切换时完全重算，避免残留
    [activeIndex, groups],
  );

  const toggle = (kw: string) => {
    const exists = selected.includes(kw);
    const next = exists ? selected.filter((s) => s !== kw) : [...selected, kw];
    setSelected(next);
    props.onChange?.(next);
  };

  // 触摸拖动增强：阻止垂直滚动干扰
  const touchState = useRef({ x: 0, y: 0, scrolling: false });

  const onTouchStart: React.TouchEventHandler<HTMLDivElement> = (e) => {
    const t = e.touches[0];
    touchState.current = { x: t.clientX, y: t.clientY, scrolling: false };
  };
  const onTouchMove: React.TouchEventHandler<HTMLDivElement> = (e) => {
    const dx = e.touches[0].clientX - touchState.current.x;
    const dy = e.touches[0].clientY - touchState.current.y;
    if (!touchState.current.scrolling && Math.abs(dx) > Math.abs(dy)) {
      touchState.current.scrolling = true;
      e.preventDefault();
    }
    if (touchState.current.scrolling && scrollRef.current) {
      scrollRef.current.scrollLeft -= dx;
      touchState.current.x = e.touches[0].clientX;
    }
  };

  return (
    <div className={clsx(styles.container, props.className)}>
      <div
        className={styles.tabs}
        ref={scrollRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
      >
        {groups.map((g, idx) => (
          <button
            key={g.styleType}
            className={clsx(
              styles.tabItem,
              idx === activeIndex && styles.active,
            )}
            onClick={() => setActiveIndex(idx)}
            aria-label={`style-${g.styleType}`}
          >
            <PaletteIcon className={styles.tabIcon} />
            <span>{g.styleType}</span>
            <span className={styles.tabCount}>{g.styleName.length}</span>
          </button>
        ))}
      </div>

      {active && (
        <div
          key={activeIndex}
          className={styles.chips}
          role="listbox"
          aria-label="style-keywords"
        >
          {activeNames.map((name) => {
            const isAct = selected.includes(name);
            return (
              <div
                key={name}
                className={clsx(styles.chip, isAct && styles.chipActive)}
                onClick={() => toggle(name)}
                role="option"
                aria-selected={isAct}
              >
                {name}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
