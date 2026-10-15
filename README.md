# Portside

面向 Mac 开发者的极简桌面工作台。使用 Tauri 2、React、TypeScript、Vite、Paper Ink、Zustand 和 Less。

界面参考 macOS 活动监视器：顶部四个 Tab、单行工具栏、紧凑表格，设置弹窗按需打开。控件统一使用 Paper Ink，配色为纸白、墨黑与中性灰。

当前版本为静态界面与交互预览，使用假数据。不会扫描或结束真实进程、执行真实命令、建立 SSH/SFTP 连接。

## 启动

```bash
npm install
npm run tauri dev
```

桌面开发需要 Rust 和 macOS Xcode Command Line Tools。前端开发服务器固定使用 `127.0.0.1:1420`。

仅预览界面：

```bash
npm run dev
```

浏览器访问 <http://127.0.0.1:1420>。不要同时启动两套开发服务器；`tauri dev` 会自动启动 Vite。

## 检查与打包

```bash
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
npm run tauri build -- --debug --bundles app
```

本地调试应用输出到 `src-tauri/target/debug/bundle/macos/Portside.app`。这是本机预览构建，不是签名、公证后的正式发行版。

## 可以预览的交互

- 端口：即时搜索、范围筛选、进程详情、模拟结束、恢复演示数据。
- 进程：搜索、我的/全部进程筛选、指标排序、扩展列、详情、模拟结束。
- 终端：标签页、新建/关闭/双击重命名、预设指令、清屏、模拟任务停止。
- 快捷指令：固定终端右栏，支持新增、编辑、复制、收藏、删除、保存并模拟运行。
- SSH：左侧远程会话，固定右栏连接 / 文件 Tab；支持连接配置增删改、模拟连接与多会话。
- 文件：演示目录浏览、新建目录、重命名、删除、模拟上传、下载明确标记的演示文本。
- 设置：浅色/深色/跟随系统、自定义本地背景、透明度、模糊、终端配色。
- 快速操作：点击右上角入口或按 Cmd+K，搜索页面、连接和快捷指令。

终端支持 `help`、`pwd`、`ls`、`ls -la`、`whoami`、`date`、`git status`、`npm run dev`、`clear`、`exit` 等演示指令。Ctrl+C 停止演示任务，Ctrl+L 清屏，上下方向键浏览本次终端页面的输入历史。

快捷指令、普通连接配置、外观偏好存储在当前 WebView/浏览器的 localStorage 中；桌面和浏览器的存储相互独立。密码和密钥路径表单仅用于展示，不保存。会话和文件操作只在内存中模拟，重启或刷新后重新初始化。

## 文档

- [产品规划](doc/产品规划.md)
- [界面与交互设计](doc/界面与交互设计.md)
- [静态预览说明](doc/静态预览说明.md)

## 源码结构

```text
src/
  components/       共享界面和演示终端
  data/             演示数据与类型
  store/            工作空间与配置状态
  views/            端口、进程、终端、SSH、设置
  App.tsx           主题、导航、Hash 路由与快速操作
  global.less       界面样式与响应式规则
src-tauri/          原生窗口、权限边界、应用图标
doc/                规划、设计与预览说明
```

后续将真实系统能力接入 Rust，前端继续通过统一服务边界消费数据；本轮没有注册系统操作命令。
