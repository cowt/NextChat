#!/usr/bin/env bash

set -Eeuo pipefail

# Minimal multi-image build & push helper (buildx/BuildKit)
# - Only does: docker buildx build ... --push
# - Reads a simple JSON config: images[].{context,dockerfile,tags[],platforms[],target}

export DOCKER_BUILDKIT=${DOCKER_BUILDKIT:-1}

CONFIG_FILE=""
BUILDER_NAME="nextchat_builder"
VERBOSE=false

log() { echo "[lite] $*"; }
logv() { [[ "$VERBOSE" == true ]] && echo "[lite][v] $*" || true; }

usage() {
  cat <<'USAGE'
用法:
  scripts/docker-build-push-lite.sh --config scripts/docker.images.json [--builder NAME] [--verbose]

配置文件示例:
{
  "images": [
    {
      "context": ".",
      "dockerfile": "Dockerfile",
      "tags": ["yourname/nextchat:latest"],
      "platforms": ["linux/amd64", "linux/arm64"],
      "target": "runner"
    }
  ]
}
USAGE
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "错误: 需要命令 '$1'" >&2
    exit 1
  fi
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --config) CONFIG_FILE="$2"; shift 2;;
      --builder) BUILDER_NAME="$2"; shift 2;;
      --verbose) VERBOSE=true; shift;;
      -h|--help) usage; exit 0;;
      *) echo "未知参数: $1"; usage; exit 1;;
    esac
  done
  if [[ -z "$CONFIG_FILE" ]]; then
    echo "错误: 需要 --config"
    usage
    exit 1
  fi
}

ensure_buildx() {
  require_cmd docker
  require_cmd jq
  if ! docker buildx version >/dev/null 2>&1; then
    echo "错误: 需要 Docker Buildx" >&2; exit 1
  fi
  if ! docker buildx inspect "$BUILDER_NAME" >/dev/null 2>&1; then
    log "创建 buildx builder: $BUILDER_NAME"
    docker buildx create --name "$BUILDER_NAME" --use >/dev/null
  else
    log "使用已有 builder: $BUILDER_NAME"
    docker buildx use "$BUILDER_NAME" >/dev/null
  fi
  docker buildx inspect --bootstrap "$BUILDER_NAME" >/dev/null
}

build_one() {
  local idx="$1"
  local CONTEXT DOCKERFILE TARGET
  CONTEXT=$(jq -r ".images[$idx].context // \".\"" "$CONFIG_FILE")
  DOCKERFILE=$(jq -r ".images[$idx].dockerfile // \"Dockerfile\"" "$CONFIG_FILE")
  TARGET=$(jq -r ".images[$idx].target // empty" "$CONFIG_FILE")

  local IFS_BAK="$IFS"; IFS=$'\n'
  local TAGS=($(jq -r ".images[$idx].tags[]?" "$CONFIG_FILE"))
  local PLATFORMS=($(jq -r ".images[$idx].platforms[]?" "$CONFIG_FILE"))
  IFS="$IFS_BAK"

  if [[ ${#TAGS[@]} -eq 0 ]]; then
    echo "错误: 镜像 $idx 未设置 tags" >&2; exit 1
  fi

  local cmd=(docker buildx build "$CONTEXT" -f "$DOCKERFILE" --pull)
  for t in "${TAGS[@]}"; do cmd+=( -t "$t" ); done
  if [[ ${#PLATFORMS[@]} -gt 0 ]]; then
    local csv; csv=$(IFS=,; echo "${PLATFORMS[*]}")
    cmd+=( --platform "$csv" )
  fi
  [[ -n "$TARGET" ]] && cmd+=( --target "$TARGET" )
  cmd+=( --push )

  log "开始构建: index=$idx context=$CONTEXT dockerfile=$DOCKERFILE target=${TARGET:-none}"
  log "标签: ${TAGS[*]} 平台: ${PLATFORMS[*]:-default}"
  logv "命令: ${cmd[*]}"
  "${cmd[@]}"
  log "完成: ${TAGS[*]}"
}

main() {
  parse_args "$@"
  if [[ "$VERBOSE" == true ]]; then
    # 将 xtrace 输出到 stdout，便于 CI/终端可见
    export BASH_XTRACEFD=1
    set -x
  fi
  log "启动: config=${CONFIG_FILE} verbose=${VERBOSE} builder=${BUILDER_NAME}"
  ensure_buildx
  if [[ ! -f "${CONFIG_FILE}" ]]; then
    echo "错误: 配置不存在: ${CONFIG_FILE}" >&2
    exit 1
  fi
  local count
  count=$(jq -r '.images | length' "${CONFIG_FILE}")
  if ! [[ "${count}" =~ ^[0-9]+$ ]] || [[ "${count}" -le 0 ]]; then
    echo "错误: images 为空" >&2
    exit 1
  fi
  log "配置: ${CONFIG_FILE}，共 ${count} 个镜像"
  for ((i=0; i<count; i++)); do build_one "${i}"; done
}

main "$@"

