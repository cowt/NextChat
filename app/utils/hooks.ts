import { useMemo } from "react";
import { useAccessStore, useAppConfig } from "../store";
import { collectModelsWithDefaultModel, getModelProvider } from "./model";

export function useAllModels() {
  const accessStore = useAccessStore();
  const configStore = useAppConfig();
  const models = useMemo(() => {
    return collectModelsWithDefaultModel(
      configStore.models,
      [configStore.customModels, accessStore.customModels].join(","),
      accessStore.defaultModel,
    );
  }, [
    accessStore.customModels,
    accessStore.defaultModel,
    configStore.customModels,
    configStore.models,
  ]);

  return models;
}

/**
 * 独立的摘要模型列表（与对话模型解耦）
 */
export function useSummaryModels() {
  const accessStore = useAccessStore();
  const configStore = useAppConfig();
  const models = useMemo(() => {
    const summaryCustom = accessStore.summaryCustomModels || "";
    const baseModels = (configStore.summaryModels as any) || configStore.models;

    // 先按 SUMMARY_CUSTOM_MODELS 生成可用性与重命名
    let allModels = collectModelsWithDefaultModel(
      baseModels,
      summaryCustom,
      accessStore.defaultModel,
    );

    // 如果 SUMMARY_CUSTOM_MODELS 显式给出正向列表（不含 all / '-'），则严格按该列表白名单过滤
    const tokens = summaryCustom
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const hasAll = tokens.some((t) => t.toLowerCase() === "all");
    const hasMinus = tokens.some((t) => t.startsWith("-"));
    const positiveItems = tokens
      .filter(
        (t) =>
          !t.startsWith("-") && !t.includes("=") && t.toLowerCase() !== "all",
      )
      .map((t) => (t.startsWith("+") ? t.slice(1) : t));

    if (summaryCustom && positiveItems.length > 0 && !hasAll && !hasMinus) {
      const allowedModelPairs: Array<{ model: string; provider?: string }> =
        positiveItems.map((name) => {
          const [modelName, providerName] = getModelProvider(name);
          return {
            model: modelName.toLowerCase(),
            provider: providerName?.toLowerCase(),
          };
        });
      const allowedModelNames = new Set(
        allowedModelPairs.filter((p) => !p.provider).map((p) => p.model),
      );
      const allowedFullKeys = new Set(
        allowedModelPairs
          .filter((p) => !!p.provider)
          .map((p) => `${p.model}@${p.provider}`),
      );

      allModels = allModels.filter((m) => {
        const modelName = (m.name || "").toLowerCase();
        const providerName = (m?.provider?.providerName || "").toLowerCase();
        const fullKey = `${modelName}@${providerName}`;
        // match either specific provider or any-provider if provider not specified
        return allowedFullKeys.has(fullKey) || allowedModelNames.has(modelName);
      });
    }

    return allModels;
  }, [
    accessStore.summaryCustomModels,
    accessStore.defaultModel,
    configStore.summaryModels,
    configStore.models,
  ]);

  return models;
}
