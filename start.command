#!/bin/bash
cd "$(dirname "$0")"

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║     News Alert  新闻聚合推送系统     ║"
echo "  ╚══════════════════════════════════════╝"
echo ""

# ── Step 1: Find Node.js ──
if ! command -v node &> /dev/null; then
    echo "  [!] 未检测到 Node.js"
    echo ""
    echo "  请先安装 Node.js:"
    echo "  https://nodejs.org/"
    echo ""
    echo "  macOS 推荐用 Homebrew 安装:"
    echo "  brew install node"
    echo ""
    echo "  安装完成后重新双击本文件。"
    echo ""
    read -p "  按回车键退出..." dummy
    exit 1
fi

echo "  [✓] Node.js $(node -v)"

# ── Step 2: Install dependencies ──
if [ ! -d "app/node_modules" ]; then
    echo ""
    echo "  [*] 首次运行，正在安装依赖（约 30 秒）..."
    echo ""
    cd app
    npm install --no-audit --no-fund
    if [ $? -ne 0 ]; then
        echo ""
        echo "  [!] 依赖安装失败，请检查网络连接后重试。"
        read -p "  按回车键退出..." dummy
        exit 1
    fi
    cd ..
    echo ""
    echo "  [✓] 依赖安装完成"
fi

# ── Step 3: Start server + open browser ──
echo ""
echo "  [*] 正在启动服务..."
echo "  [*] 浏览器将自动打开控制面板"
echo ""
echo "  提示: 按 Ctrl+C 停止服务"
echo "  ─────────────────────────────────────────"
echo ""

cd app

# Open browser after a short delay
(sleep 2 && open http://localhost:3201) &

node server.js
