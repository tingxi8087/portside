# 当前凭据方案提示

2026-10-15 用户已选择本机明文保存，系统钥匙串调用已移除。本文件钥匙串实测仅保留为历史；当前行为与本轮新增测试见 [本地凭据存储](./本地凭据存储.md)。

# SSH 与 SFTP 真实能力自测

实现保留已验收的终端和右侧连接 / 文件 / 快捷指令布局。浏览器预览不模拟连接成功，真实功能只在 Tauri 桌面端使用。

## 实现边界

- SSH 使用 libssh2，支持密码、OpenSSH 私钥（含私钥口令）和 SSH Agent。
- 密码与私钥口令只在当前会话内存中使用；用户勾选保存时存入 macOS 系统钥匙串。普通配置只保存主机、用户、端口、认证方式与私钥路径。
- 首次连接必须确认 SHA256 主机指纹；指纹变化暂停连接，展示旧 / 新指纹并经过两次明确确认后才允许替换。后端在替换时重新握手，核对实际指纹与旧记录，防止检查与连接之间被替换。
- 真实交互终端支持输入、UTF-8、终端尺寸变化、Ctrl+C、退出、关闭。SSH 终端独立连接，SFTP 不会被等待终端输出阻塞。输出以 256 KB 窗口等待渲染确认，输入队列有上限。
- 快捷指令发送至当前远程终端，先切换到配置的远程目录再执行；目录失败时不执行命令。
- SFTP 支持真实目录导航、刷新、目录创建、文件 / 空目录删除、重命名、文件上传下载及取消。非空目录拒绝删除，不会递归删除。
- 上传下载先写相邻临时文件，成功后重命名；取消与失败清理临时文件。覆盖同名文件需要明确确认。
- 关闭最后一个服务器会话会释放 SFTP 连接；应用退出会关闭终端与传输。

## 可控测试环境

仅使用本机 Docker 容器 `portside-ssh-fixture-20261015`，端口 `127.0.0.1:22291`。镜像构建文件在 `src-tauri/tests/ssh-fixture/Dockerfile`。所有文件操作都在容器内专门创建的测试目录与本机临时测试目录完成；不访问用户保存的真实服务器。

测试账号与私钥属于临时 fixture，不随应用配置分发。测试用 SSH Agent 独立套接字 `/tmp/portside-ssh-fixture/agent.sock`，不使用用户日常 Agent。

## 已运行验证

2026-10-15：`npx tsc --noEmit`、`cargo check --manifest-path src-tauri/Cargo.toml` 通过。

`PORTSIDE_SSH_FIXTURE_PORT=22291 cargo test --manifest-path src-tauri/Cargo.toml ssh::live_tests::ssh_fixture_end_to_end -- --ignored --nocapture` 通过（0.97 秒）：

- 密码认证、私钥认证成功；错误密码与不存在的私钥真实失败。
- 读取主机 SHA256 指纹；未信任与不匹配的指纹校验拒绝，匹配才通过。
- 远程 PTY 输出中文，尺寸修改后 `stty size` 返回 `40 100`。
- 在专用目录启动 Shell，`pwd` 返回该目录；Ctrl+C 中断 `sleep 30` 后可继续执行；`exit 7` 返回退出码 7 并释放终端注册记录。
- SFTP 创建、列出、重命名、删除中文目录。
- 512 KB 二进制文件上传、下载后逐字节一致。
- 未明确授权的覆盖被拒绝；原内容保留。
- 8 MB 上传在首批进度后取消，目标文件未出现且 `.part` 文件清理。
- 非空目录删除失败，非法名称 `../escape` 被拒绝。

额外测试结果如下；原生 UI 验收由主智能体补记。

扩展实测已通过（2.68 秒）：

- 加密私钥正确口令成功，错误口令失败。
- 指定隔离 `SSH_AUTH_SOCK`，SSH Agent 认证成功。
- `/root` 权限拒绝、不存在目录、不存在上传源真实报错。
- 下载中取消后本地目标文件不存在，临时文件清理。
- 明确授权覆盖后读取远程文件，内容为新内容。
- 终端连续输出 1 MB 时，未确认渲染前输出停在 256–288 KB；补发 ACK 后完整继续并退出。

macOS 系统钥匙串真实往返测试通过（0.13 秒），只创建并删除 `portside-selftest-<PID>` 专用项目，测试后确认项目不存在。

### 发现并修正的兼容问题

OpenSSH 的 SFTP v3 不接受已有目标上的普通覆盖 rename。上传覆盖改为：完整上传临时文件 → 将原文件移到唯一备份 → 将新文件移到目标 → 删除旧备份。提交失败时恢复旧文件；如网络中断导致恢复失败，会报告备份所在路径，不静默丢弃原内容。这个兼容流程不承诺覆盖操作瞬间的原子性。下载在未授权覆盖时使用本机硬链接提交，避免检查后目标突然出现而被覆盖。

### 复跑命令

```sh
SSH_AUTH_SOCK=/tmp/portside-ssh-fixture/agent.sock \
PORTSIDE_SSH_FIXTURE_PORT=22291 \
cargo test --manifest-path src-tauri/Cargo.toml --lib ssh:: -- --include-ignored --nocapture
```

fixture 测试显式标为 ignored，正常单元测试不依赖 Docker 或接触钥匙串。上述专门命令会启用 fixture 与钥匙串实测。加密私钥、Agent 套接字和容器均为自测临时资源，发布包不包含这些材料。

## 原生 UI 验收与剩余项目

已在原生打包 App 验证首次主机指纹确认（与隔离服务器 ssh-keygen 逐一核对）、测试连接、密码连接、真实 Linux 终端、目录创建、文件选择及保存对话框、上传下载逐字节一致、重命名、删除和在当前文件目录打开终端；具体证据见 [真实功能验收](./真实功能验收.md)。拖放入口已有 Tauri 原生事件实现，尚无实际 Finder 拖放操作证据，上传核心链路通过原生文件对话框验证。

保存资料和外观在重启后恢复；保存的凭据再次读取时触发 macOS 系统钥匙串授权。用户已在系统窗口允许，最终包未重新输入密码即建立真实 SSH 会话，返回 PORTSIDE_KEYCHAIN_RESTORED_OK / Linux / /home/tester，文件列表也恢复成功。自测连接与凭据随后通过原生界面删除，系统查询确认专用钥匙串条目不存在。未使用用户生产服务器做测试；特定服务器认证限制、SFTP 禁用或权限限制显示真实错误。

## 仅 SSH、禁用 SFTP 的服务器兼容

认证成功即允许建立 SSH 连接，SFTP 探测独立返回能力状态。`ssh_connect` 返回 `{ home, sftpAvailable }`：SFTP 禁用时 `home` 回退为 `~`，终端直接使用服务器默认起始目录；文件面板进入后显示真实 SFTP 错误。测试连接文案不会将这种情况声称为 SFTP 验证成功。

第二个隔离 Docker 容器 `portside-ssh-nosftp-20261015` 在 `127.0.0.1:22292` 启动同样的 SSH 服务，但配置中完全不启用 SFTP Subsystem。实际测试 `ssh::no_sftp_live_tests::authenticated_shell_survives_disabled_sftp` 通过（0.25 秒）：

- 正确密码认证成功，返回 `home: "~"`、`sftpAvailable: false`。
- 真实交互 PTY 执行 `printf`、`pwd` 并成功退出，输出 `/home/tester`。
- 文件列表请求仍返回真实错误。
- 错误密码仍返回认证失败，未被兼容处理吞掉。
- 同时连接正常的 22291 端口返回 `/home/tester`、`sftpAvailable: true`，无正常能力回归。

复跑此用例需要上述第二容器，命令：

```sh
cargo test --manifest-path src-tauri/Cargo.toml --lib ssh::no_sftp_live_tests -- --ignored --nocapture
```

## 输入压力、控制通道与凭据授权顺序

最终审查发现旧实现把输入和 Ctrl+C / 关闭 / ACK 放在同一个有界消息队列中。虽不会同步阻塞 IPC，但大粘贴可能占满队列，控制请求排在输入之后。现已改为：

- 待发送输入总量最多 1 MB，另有至多 16 KB 的当前 nonblocking SSH 写入分片。
- 超限立即返回错误，不保留额外输入；不会把输入拥塞升级成终端永久错误状态。
- Ctrl+C 独立标记并清空尚未发送的粘贴，关闭与 ACK 走独立原子状态，尺寸变化合并为最新值。
- libssh2 返回 EAGAIN 时保留当前写入缓冲重试，不替换正在提交的 SSH 包；关闭可直接结束 worker。

隔离 Linux fixture 真实执行 `stty -echo -icanon ...; sleep 30`，使进程不读取 PTY 输入，持续粘贴直到 SSH 发送窗口实际返回 EAGAIN。实测输入队列始终有界、85 次立即拒绝，最慢写入 IPC 约 491 微秒；Ctrl+C 请求立即清空待发输入；关闭请求至 worker 退出约 1.33 毫秒。普通可通信的 Shell 另有 Ctrl+C 中断任务用例。SSH 传输的远端接收窗口为零时，控制字符本身仍受网络协议流控约束；优先级保证本机不被积压输入卡住，并保留随时关闭会话的能力。

凭据访问顺序也已修正：先等待系统钥匙串返回凭据，再新建 TCP / SSH 握手、核验该实际连接的主机指纹并认证，避免用户在系统授权弹窗停留时消耗服务器登录超时。远程终端新建连接从当前连接的内存凭据读取，不会重新等待钥匙串。新增本机 loopback 监听测试，模拟凭据授权等待与取消，确认期间没有打开任何远程 TCP 连接。

## 一键初始化与清理 fixture

```sh
# 创建全新、随机命名与动态 localhost 端口的两套服务器，并自动测试、清理。
node scripts/ssh-fixture.mjs test

# 留存用于原生 UI 验收，输出 state.json 路径与端口。
node scripts/ssh-fixture.mjs start

# 只清理该次创建的资源，需传上一条输出的实际路径。
node scripts/ssh-fixture.mjs stop /实际临时目录/portside-ssh-fixture-xxxx/state.json
```

脚本使用专属临时目录、UUID 容器名与所有权标签，只绑定 `127.0.0.1`。清理前同时核对容器 ID、名称、UUID 标签；SSH Agent PID 与专属套接字匹配后才终止。镜像也有该次 UUID 标签。不会查找或删除用户其他容器、Agent、钥匙串项目或目录。测试服务单独关闭 OpenSSH PerSourcePenalties，避免大量错误认证测试导致同源互相惩罚；应用本身不修改服务器配置。

最终一键回归：`node scripts/ssh-fixture.mjs test` **9/9 通过**（2.73 秒），包含凭据等待顺序和实际非读取远端输入压力测试。该轮最慢写入 IPC 528 微秒、关闭至 worker 退出 6.96 毫秒。结束后按 UUID 标签检查无本轮容器残留、专用临时目录已删除；原供原生 UI 验收的 22291 / 22292 两容器 ID 保持不变。最新 TypeScript 检查通过。

最终 UI 自测完成后，旧 22291/22292 隔离容器、独立 Agent、测试镜像与临时材料均已按所有权核对后清理。后续复跑统一使用 `node scripts/ssh-fixture.mjs test` 自动创建动态端口环境。
