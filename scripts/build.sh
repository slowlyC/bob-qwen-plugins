#!/bin/bash
# Bob Qwen Plugins - 构建脚本
# 用法: ./scripts/build.sh [tts|ocr|all]

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="$REPO_ROOT/dist"

build_plugin() {
    local name=$1
    local plugin_dir="$REPO_ROOT/plugins/$name"
    local src_dir="$plugin_dir/src"
    local output="$DIST_DIR/qwen3-${name}.bobplugin"

    if [ ! -d "$src_dir" ]; then
        echo "Error: $src_dir not found"
        exit 1
    fi

    echo "Building $name plugin..."

    # 打包
    rm -f "$output"
    cd "$src_dir"
    zip -r "$output" . -x '.*'
    cd "$REPO_ROOT"

    # 计算 SHA256
    local sha256
    sha256=$(shasum -a 256 "$output" | awk '{print $1}')
    echo "  Output: $output"
    echo "  SHA256: $sha256"
    echo ""
}

# 创建输出目录
mkdir -p "$DIST_DIR"

case "${1:-all}" in
    tts)
        build_plugin tts
        ;;
    ocr)
        build_plugin ocr
        ;;
    all)
        build_plugin tts
        build_plugin ocr
        echo "All plugins built successfully!"
        ;;
    *)
        echo "Usage: $0 [tts|ocr|all]"
        exit 1
        ;;
esac
