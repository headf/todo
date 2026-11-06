# 📝 待办清单（Todo Widget）

桌面待办事项小组件，基于 Electron 开发，支持置顶悬浮与 PWA 使用。

## 功能特性

- ✅ 待办事项增删改、标记完成
- 📌 桌面置顶悬浮小组件
- 🪟 无边框 / 透明窗口（基于 koffi 原生调用）
- 📱 支持 PWA（manifest + Service Worker）

## 技术栈

- Electron
- 原生 HTML / CSS / JavaScript
- koffi（原生能力调用）

## 快速开始

```bash
npm install
npm start          # 开发运行
npm run build      # 打包为 Windows 便携版
```

## 目录结构

```
index.html        界面
main.js           Electron 主进程
preload.js        预加载脚本
manifest.json     PWA 清单
sw.js             Service Worker
assets/           图标等资源
```
