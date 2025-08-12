#!/usr/bin/env bash

set -Eeuo pipefail

# A robust multi-image Docker build & push helper using buildx/BuildKit.
# - Supports multiple images via a JSON config file
# - Reuses existing Dockerfile(s)
# - Enables cache and multi-platform builds
# - Works in CI (non-interactive) and locally (macOS/Linux)

export DOCKER_BUILDKIT=${DOCKER_BUILDKIT:-1}

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

CONFIG_FILE=""
BUILDER_NAME="nextchat_builder"
DO_LOGIN=false
DRY_RUN=false
VERBOSE=false

usage() {
  cat <<'USAGE'
用法:
  scripts/docker-build-push.sh --config <path/to/docker.images.json> [选项]

必需参数:
  --config FILE             JSON 配置文件路径，定义多镜像矩阵

可选参数:
  --builder NAME            buildx builder 名称（默认: nextchat_builder）
  --login                   根据环境变量执行 docker login（见下）
  --dry-run                 仅打印将要执行的命令
  --verbose                 输出更详细日志
  -h, --help                显示帮助

认证环境变量（当使用 --login 时任一组合即可）:
  DOCKER_USERNAME           登录用户名（GHCR 也需要）
  DOCKER_PASSWORD           登录密码（或访问令牌）
  DOCKER_TOKEN              访问令牌（将优先作为密码使用）
  DOCKER_REGISTRY           注册表地址（默认 docker.io，可省略）

配置文件 schema（示例）:
{
  "images": [
    {
      "name": "nextchat",
      "context": ".",
      "dockerfile": "Dockerfile",
      "tags": ["your-dockerhub-username/nextchat:latest"],
      "platforms": ["linux/amd64", "linux/arm64"],
      "target": "runner",
      "buildArgs": {"NODE_ENV": "production"},
      "labels": {"org.opencontainers.image.source": "https://github.com/your-org/NextChat"},
      "cacheRef": "your-dockerhub-username/nextchat:buildcache",
      "useRemoteCache": true,
      "push": true,
      "load": false,
      "noCache": false,
      "provenance": false,
      "sbom": false
    }
  ]
}

注意:
- 多平台构建需要使用 --push；--load 仅支持单平台（本地加载）
- 若未显式提供 cacheRef，将默认使用首个 tag 并追加 "-buildcache"
 - 若将 useRemoteCache 设为 false，则不会添加 --cache-from/--cache-to，也不会默认生成 cacheRef
USAGE
}

log() {
  echo "[docker-build] $*"
}

logv() {
  if [[ "$VERBOSE" == true ]]; then
    echo "[docker-build][verbose] $*"
  fi
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "错误: 需要命令 '$1'，请先安装。" >&2
    exit 1
  fi
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --config)
        CONFIG_FILE="$2"; shift 2;;
      --builder)
        BUILDER_NAME="$2"; shift 2;;
      --login)
        DO_LOGIN=true; shift;;
      --dry-run)
        DRY_RUN=true; shift;;
      --verbose)
        VERBOSE=true; shift;;
      -h|--help)
        usage; exit 0;;
      *)
        echo "未知参数: $1" >&2
        usage
        exit 1;;
    esac
  done

  if [[ -z "$CONFIG_FILE" ]]; then
    echo "错误: 必须提供 --config 配置文件路径" >&2
    usage
    exit 1
  fi
}

ensure_buildx() {
  require_cmd docker
  if ! docker buildx version >/dev/null 2>&1; then
    echo "错误: 需要 Docker Buildx 支持，请升级 Docker 或启用 buildx 插件。" >&2
    exit 1
  fi

  # 创建或使用指定 builder
  if ! docker buildx inspect "$BUILDER_NAME" >/dev/null 2>&1; then
    log "创建 buildx builder: $BUILDER_NAME"
    run_cmd docker buildx create --name "$BUILDER_NAME" --use
  else
    run_cmd docker buildx use "$BUILDER_NAME"
  fi

  # 确保可用
  run_cmd docker buildx inspect --bootstrap "$BUILDER_NAME"
}

docker_login() {
  # 登录仅在 --login 指定时执行
  if [[ "$DO_LOGIN" != true ]]; then
    return 0
  fi

  local REGISTRY="${DOCKER_REGISTRY:-}"
  local USERNAME="${DOCKER_USERNAME:-}"
  local PASSWORD="${DOCKER_TOKEN:-${DOCKER_PASSWORD:-}}"

  if [[ -z "$USERNAME" || -z "$PASSWORD" ]]; then
    echo "警告: --login 需要 DOCKER_USERNAME 和 DOCKER_PASSWORD/DOCKER_TOKEN 环境变量。跳过登录。" >&2
    return 0
  fi

  if [[ -z "$REGISTRY" ]]; then REGISTRY="docker.io"; fi

  log "登录注册表: $REGISTRY (用户: $USERNAME)"
  if [[ "$DRY_RUN" == true ]]; then
    echo "docker login $REGISTRY -u $USERNAME --password-stdin <<< *****"
  else
    printf '%s' "$PASSWORD" | docker login "$REGISTRY" -u "$USERNAME" --password-stdin
  fi
}

run_cmd() {
  if [[ "$DRY_RUN" == true ]]; then
    echo "$*"
  else
    if [[ "$VERBOSE" == true ]]; then
      echo "+ $*"
    fi
    "$@"
  fi
}

build_image_by_index() {
  local idx="$1"

  local NAME CONTEXT DOCKERFILE TARGET NOCACHE PUSH LOAD PROVENANCE SBOM
  NAME=$(jq -r ".images[$idx].name // \"image-$idx\"" "$CONFIG_FILE")
  CONTEXT=$(jq -r ".images[$idx].context // \".\"" "$CONFIG_FILE")
  DOCKERFILE=$(jq -r ".images[$idx].dockerfile // \"Dockerfile\"" "$CONFIG_FILE")
  TARGET=$(jq -r ".images[$idx].target // empty" "$CONFIG_FILE")
  NOCACHE=$(jq -r ".images[$idx].noCache // false" "$CONFIG_FILE")
  PUSH=$(jq -r ".images[$idx].push // true" "$CONFIG_FILE")
  LOAD=$(jq -r ".images[$idx].load // false" "$CONFIG_FILE")
  PROVENANCE=$(jq -r ".images[$idx].provenance // false" "$CONFIG_FILE")
  SBOM=$(jq -r ".images[$idx].sbom // false" "$CONFIG_FILE")
  local USE_REMOTE_CACHE
  USE_REMOTE_CACHE=$(jq -r ".images[$idx].useRemoteCache // true" "$CONFIG_FILE")

  # 兼容 macOS bash 3.2：不使用 mapfile
  local IFS_BAK="$IFS"
  IFS=$'\n'
  TAGS=($(jq -r ".images[$idx].tags[]?" "$CONFIG_FILE"))
  PLATFORMS=($(jq -r ".images[$idx].platforms[]?" "$CONFIG_FILE"))
  BUILD_ARGS_KEYS=($(jq -r ".images[$idx].buildArgs | keys[]?" "$CONFIG_FILE"))
  LABEL_KEYS=($(jq -r ".images[$idx].labels | keys[]?" "$CONFIG_FILE"))
  IFS="$IFS_BAK"

  local CACHE_REF
  CACHE_REF=$(jq -r ".images[$idx].cacheRef // empty" "$CONFIG_FILE")
  if [[ "$USE_REMOTE_CACHE" == true ]]; then
    if [[ -z "$CACHE_REF" && ${#TAGS[@]} -ge 1 ]]; then
      CACHE_REF="${TAGS[0]}-buildcache"
    fi
  else
    CACHE_REF=""
  fi

  if [[ ${#PLATFORMS[@]} -gt 1 && "$LOAD" == true ]]; then
    echo "错误: 多平台构建不支持 --load，请将 'load': false 或仅指定单平台。镜像: $NAME" >&2
    exit 1
  fi

  log "开始构建: $NAME"

  # 组装 docker buildx build 命令
  local cmd
  cmd=(docker buildx build "$CONTEXT" -f "$DOCKERFILE" --pull)

  # tags
  if [[ ${#TAGS[@]} -eq 0 ]]; then
    echo "错误: 镜像 '$NAME' 未指定 tags" >&2
    exit 1
  fi
  for t in "${TAGS[@]}"; do
    cmd+=( -t "$t" )
  done

  # platforms
  if [[ ${#PLATFORMS[@]} -gt 0 ]]; then
    local platform_csv
    platform_csv=$(IFS=,; echo "${PLATFORMS[*]}")
    cmd+=( --platform "$platform_csv" )
  fi

  # build-args
  for k in "${BUILD_ARGS_KEYS[@]:-}"; do
    local v
    v=$(jq -r ".images[$idx].buildArgs[\"$k\"]" "$CONFIG_FILE")
    cmd+=( --build-arg "$k=$v" )
  done

  # labels
  for lk in "${LABEL_KEYS[@]:-}"; do
    local lv
    lv=$(jq -r ".images[$idx].labels[\"$lk\"]" "$CONFIG_FILE")
    cmd+=( --label "$lk=$lv" )
  done

  # target
  if [[ -n "$TARGET" ]]; then
    cmd+=( --target "$TARGET" )
  fi

  # cache
  if [[ -n "$CACHE_REF" ]]; then
    cmd+=( --cache-from "type=registry,ref=$CACHE_REF" --cache-to "type=registry,ref=$CACHE_REF,mode=max" )
  fi

  # provenance / sbom
  if [[ "$PROVENANCE" == false ]]; then
    cmd+=( --provenance=false )
  fi
  if [[ "$SBOM" == true ]]; then
    cmd+=( --sbom=true )
  fi

  # no-cache
  if [[ "$NOCACHE" == true ]]; then
    cmd+=( --no-cache )
  fi

  # push / load
  if [[ "$PUSH" == true ]]; then
    cmd+=( --push )
  elif [[ "$LOAD" == true ]]; then
    cmd+=( --load )
  fi

  logv "构建命令: ${cmd[*]}"
  run_cmd "${cmd[@]}"

  log "完成: $NAME"
}

main() {
  parse_args "$@"
  require_cmd jq
  ensure_buildx
  docker_login

  if [[ ! -f "$CONFIG_FILE" ]]; then
    echo "错误: 找不到配置文件: $CONFIG_FILE" >&2
    exit 1
  fi

  local count
  count=$(jq -r '.images | length' "$CONFIG_FILE")
  if [[ "$count" == "0" ]]; then
    echo "错误: 配置文件中未找到任何镜像定义 (.images 为空)" >&2
    exit 1
  fi

  log "共 ${count} 个镜像待处理"
  for (( i=0; i < count; i++ )); do
    build_image_by_index "$i"
  done
}

main "$@"

