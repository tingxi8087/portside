# Portside

面向 macOS 开发者的极简桌面工作台，基于 Tauri 2、React、TypeScript、Paper Ink、Zustand 和 xterm.js。

顶部顺序为终端、SSH、端口、进程，默认进入终端。桌面版已接入真实系统功能；普通浏览器仅可预览界面和管理配置，无法访问本机进程、PTY 或 SSH。

## 开发与打包

```sh
npm install
npm run tauri dev
```

需要 Rust、Xcode Command Line Tools。Vite 使用 `127.0.0.1:1420`，不要重复启动开发服务器。

```sh
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
node scripts/verify-config-storage.mjs
node scripts/verify-system-snapshot.mjs
# 可选：需要 Docker；创建隔离 Linux fixtures 并在完成后清理
node scripts/ssh-fixture.mjs test
npm run tauri -- build --debug --bundles app
```

调试应用位于 `src-tauri/target/debug/bundle/macos/Portside.app`。当前为本机调试构建，尚未签名、公证或发布安装器。SSH 的 OpenSSL 随构建静态编译，无需目标机器安装 Homebrew OpenSSL。

## 已接入功能

- **终端**：真实登录 Shell、PTY、全 VT 终端交互、多标签、停止任务、复制粘贴、清屏、输出搜索、切页保留与退出清理。
- **快捷指令**：指定目录执行、单标签筛选、复制命令、创建副本、多选删除和批量设置标签。SSH 与本地共用指令库，运行目标由当前页面决定。
- **SSH**：密码、私钥与口令、SSH Agent，连接测试与真实远程终端；首次连接确认指纹，变化时展示新旧指纹并再次确认。
- **文件**：SFTP 目录、输入路径、上传下载、拖放上传、进度与取消、新建目录、重命名、删除、在当前目录打开终端。同名文件覆盖须确认；目录只删除空目录。
- **端口**：真实 TCP 监听 / UDP 绑定端口、PID 对应、搜索与筛选、详情和结束进程。结束前复核进程身份，先 TERM，未退出再确认 KILL。
- **进程**：真实 CPU、内存、磁盘与网络采样、排序、搜索、暂停和详情。权限不足或缺少首个差分样本显示 `—`，不伪造零值。
- **外观**：浅色、深色、跟随系统、独立终端配色、图片背景、透明度与模糊。

CPU 单核满载为 100%，内存为 RSS MiB，磁盘与网络为采样间隔内 KiB/s。普通用户权限不能读取所有系统进程的详细数据，端口/进程统计以实际可访问数据为准。

## 配置与凭据

桌面版普通配置原子写入 macOS 应用配置目录 `~/Library/Application Support/com.portside.desktop/workspace.json`，权限为 `0600`；首次升级兼容旧 WebView 配置。快捷指令、连接资料和外观在重启后保留，终端进程与传输状态不跨重启恢复。

密码和私钥口令仅在当前内存或用户勾选后的系统钥匙串保存，不进入普通配置。主机指纹独立保存。浏览器预览配置仍使用其独立 localStorage。已有预览版示例连接会保留，首次全新安装不生成假服务器。

## 验证记录

- [整体真实功能验收](doc/真实功能验收.md)
- [系统能力自测](doc/系统能力自测.md)
- [终端能力自测](doc/终端能力自测.md)
- [SSH 能力自测](doc/SSH能力自测.md)
- [产品规划](doc/产品规划.md)
- [界面与交互设计](doc/界面与交互设计.md)
- [历史静态预览说明](doc/静态预览说明.md)
