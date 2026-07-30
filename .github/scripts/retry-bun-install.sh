#!/usr/bin/env bash

set -uo pipefail

readonly MAX_ATTEMPTS=3

for attempt in $(seq 1 "${MAX_ATTEMPTS}"); do
  echo "开始执行 bun install（第 ${attempt}/${MAX_ATTEMPTS} 次）"

  if bun install --frozen-lockfile; then
    echo "✅ bun install 成功"
    exit 0
  fi

  if [ "${attempt}" -eq "${MAX_ATTEMPTS}" ]; then
    echo "ERROR: bun install 连续 ${MAX_ATTEMPTS} 次失败"
    exit 1
  fi

  wait_seconds=$((attempt * 10))
  echo "WARN: bun install 失败，清理不完整依赖和下载缓存，${wait_seconds} 秒后重试"
  rm -rf node_modules
  rm -rf "${BUN_INSTALL_CACHE_DIR:-${HOME}/.bun/install/cache}"
  sleep "${wait_seconds}"
done
