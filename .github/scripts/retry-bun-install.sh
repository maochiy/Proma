#!/usr/bin/env bash

set -uo pipefail

readonly MAX_ATTEMPTS=5
readonly NETWORK_CONCURRENCY="${BUN_INSTALL_NETWORK_CONCURRENCY:-2}"
readonly CONCURRENT_SCRIPTS="${BUN_INSTALL_CONCURRENT_SCRIPTS:-1}"
readonly INSTALL_ROOT="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/proma-bun-install-${GITHUB_JOB:-local}-$$"

# GitHub Hosted Runner 偶发收到截断或串包的 tarball。关闭 streaming，
# 并让每次尝试使用独立缓存，避免失败缓存污染后续重试。
export BUN_FEATURE_FLAG_DISABLE_STREAMING_INSTALL=1

mkdir -p "${INSTALL_ROOT}"

cleanup_install_root() {
  rm -rf "${INSTALL_ROOT}" 2>/dev/null || true
}
trap cleanup_install_root EXIT

isolate_failed_node_modules() {
  local attempt="$1"
  local failed_modules

  [ -d node_modules ] || return 0

  failed_modules="${INSTALL_ROOT}/node_modules-failed-${attempt}"

  # Bun 的 lifecycle 子进程偶尔会在 bun install 退出后短暂继续写文件。
  # 先改名隔离，确保下一次安装永远从一个全新的 node_modules 开始；
  # 失败目录放到 Runner 临时目录，工作区不会再次扫描到它。
  if mv node_modules "${failed_modules}" 2>/dev/null; then
    rm -rf "${failed_modules}" 2>/dev/null || true
    return 0
  fi

  echo "WARN: 无法隔离 node_modules，等待残留进程退出后再次清理"
  sleep 2
  rm -rf node_modules 2>/dev/null || true

  if [ -d node_modules ]; then
    echo "ERROR: node_modules 清理失败，为避免污染后续重试，停止安装"
    return 1
  fi
}

for attempt in $(seq 1 "${MAX_ATTEMPTS}"); do
  attempt_cache="${INSTALL_ROOT}/cache-${attempt}"
  mkdir -p "${attempt_cache}"

  echo "开始执行 bun install（第 ${attempt}/${MAX_ATTEMPTS} 次）"

  if bun install \
    --frozen-lockfile \
    --backend=copyfile \
    --cache-dir="${attempt_cache}" \
    --registry=https://registry.npmjs.org \
    --concurrent-scripts="${CONCURRENT_SCRIPTS}" \
    --network-concurrency="${NETWORK_CONCURRENCY}" \
    --no-progress; then
    echo "✅ bun install 成功"
    exit 0
  fi

  if [ "${attempt}" -eq "${MAX_ATTEMPTS}" ]; then
    echo "ERROR: bun install 连续 ${MAX_ATTEMPTS} 次失败"
    exit 1
  fi

  wait_seconds=$((attempt * 10))
  echo "WARN: bun install 失败，隔离不完整依赖和本次下载缓存，${wait_seconds} 秒后重试"
  isolate_failed_node_modules "${attempt}" || exit 1
  rm -rf "${attempt_cache}" 2>/dev/null || true
  sleep "${wait_seconds}"
done
