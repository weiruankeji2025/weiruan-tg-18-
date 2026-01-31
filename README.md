# TG Content Aggregator

Telegram 内容聚合下载工具 - 支持频道/群组内容搜索、分类、高速下载

## 功能特性

- **内容聚合**: 扫描 Telegram 频道/群组中的媒体内容
- **智能分类**:
  - 按媒体类型分类 (图片、视频、文档、音频等)
  - 按可下载性分类 (可下载、受限、过期、文件过大)
- **高速下载**:
  - 多线程并发下载
  - 断点续传支持
  - 自动重试机制
- **自定义文件名**: 支持模板变量自定义输出文件名
- **交互式界面**: 友好的命令行交互体验

## 安装

### 前置要求

- Node.js >= 18.0.0
- npm 或 yarn

### 安装步骤

```bash
# 克隆仓库
git clone <repository-url>
cd tg-content-aggregator

# 安装依赖
npm install

# 编译
npm run build

# 全局安装 (可选)
npm link
```

## 配置

### 获取 Telegram API 凭据

1. 访问 https://my.telegram.org/apps
2. 使用您的 Telegram 账号登录
3. 创建新应用
4. 记录 `API ID` 和 `API Hash`

### 初始配置

```bash
# 配置 API 凭据
tg-agg config

# 登录 Telegram
tg-agg login
```

## 使用方法

### 基本命令

```bash
# 查看帮助
tg-agg --help

# 查看登录状态
tg-agg status

# 列出已加入的频道/群组
tg-agg list

# 扫描频道内容
tg-agg scan @channel_name

# 扫描最近 1000 条消息
tg-agg scan @channel_name -l 1000

# 下载扫描到的所有文件
tg-agg download -a

# 使用自定义文件名下载
tg-agg download -n "my_custom_name"

# 配置下载选项
tg-agg download-config

# 进入交互模式
tg-agg i
```

### 交互模式

交互模式提供更友好的操作界面:

```bash
tg-agg i
```

在交互模式中可以:
- 登录/查看状态
- 列出频道
- 扫描频道内容
- 选择性下载文件
- 配置下载选项

### 下载配置

可配置的下载选项:

| 选项 | 说明 | 默认值 |
|------|------|--------|
| outputDir | 下载目录 | ~/TG-Downloads |
| concurrentDownloads | 并发下载数 | 3 |
| fileNameTemplate | 文件名模板 | {chatTitle}_{date}_{id}.{extension} |
| createSubfolders | 按类型创建子文件夹 | true |
| skipExisting | 跳过已存在文件 | true |
| resumeEnabled | 启用断点续传 | true |

### 文件名模板变量

| 变量 | 说明 |
|------|------|
| {id} | 文件ID |
| {chatTitle} | 频道/群组名称 |
| {chatId} | 频道/群组ID |
| {date} | 日期 (YYYY-MM-DD) |
| {time} | 时间 (HH-MM-SS) |
| {type} | 媒体类型 |
| {originalName} | 原始文件名 |
| {extension} | 扩展名 |
| {caption} | 消息描述 (前30字符) |
| {messageId} | 消息ID |

## 媒体分类

### 按类型分类

- 图片 (photo)
- 视频 (video)
- 文档 (document)
- 音频 (audio)
- 语音 (voice)
- 视频消息 (video_note)
- 动图 (animation)
- 贴纸 (sticker)

### 按可下载性分类

- **可下载** (downloadable): 可以正常下载
- **受限** (restricted): 需要订阅或权限
- **已过期** (expired): 内容已过期
- **文件过大** (too_large): 超过 2GB 限制
- **不支持** (unsupported): 不支持的媒体类型

## 项目结构

```
src/
├── index.ts              # 主入口文件
├── types/                # 类型定义
│   └── index.ts
├── core/                 # 核心模块
│   ├── client.ts        # Telegram 客户端
│   ├── aggregator.ts    # 内容聚合器
│   └── downloader.ts    # 下载管理器
├── commands/             # 命令处理
│   ├── login.ts         # 登录命令
│   ├── aggregate.ts     # 聚合命令
│   └── download.ts      # 下载命令
└── utils/                # 工具函数
    ├── helpers.ts       # 辅助函数
    └── config.ts        # 配置管理
```

## 注意事项

1. **合法使用**: 请仅下载您有权访问和保存的内容
2. **版权尊重**: 尊重内容创作者的版权
3. **隐私保护**: 不要下载和传播他人隐私内容
4. **服务条款**: 遵守 Telegram 的服务条款

## 技术栈

- TypeScript
- telegram (gramjs) - Telegram MTProto 客户端
- Commander - 命令行框架
- Inquirer - 交互式命令行
- Chalk - 终端颜色
- Ora - 加载动画
- cli-progress - 进度条

## License

MIT
