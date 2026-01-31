/**
 * Telegram内容聚合工具 - 类型定义
 */

// 媒体文件类型枚举
export enum MediaType {
  PHOTO = 'photo',
  VIDEO = 'video',
  DOCUMENT = 'document',
  AUDIO = 'audio',
  VOICE = 'voice',
  VIDEO_NOTE = 'video_note',
  ANIMATION = 'animation',
  STICKER = 'sticker',
  UNKNOWN = 'unknown'
}

// 下载状态枚举
export enum DownloadStatus {
  PENDING = 'pending',
  DOWNLOADING = 'downloading',
  COMPLETED = 'completed',
  FAILED = 'failed',
  PAUSED = 'paused',
  CANCELLED = 'cancelled'
}

// 文件可下载性分类
export enum DownloadableType {
  DOWNLOADABLE = 'downloadable',       // 可下载
  RESTRICTED = 'restricted',           // 受限（需要订阅等）
  EXPIRED = 'expired',                 // 已过期
  TOO_LARGE = 'too_large',            // 文件过大
  UNSUPPORTED = 'unsupported'         // 不支持的类型
}

// API配置
export interface TelegramConfig {
  apiId: number;
  apiHash: string;
  sessionString?: string;
  phoneNumber?: string;
}

// 媒体文件信息
export interface MediaInfo {
  id: string;
  messageId: number;
  chatId: string;
  chatTitle: string;
  type: MediaType;
  mimeType?: string;
  fileName?: string;
  fileSize: number;           // 字节
  fileSizeFormatted: string;  // 格式化后的大小
  downloadable: DownloadableType;
  downloadableReason?: string;
  date: Date;
  caption?: string;
  thumbnailPath?: string;
  duration?: number;          // 视频/音频时长（秒）
  width?: number;
  height?: number;
}

// 频道/群组信息
export interface ChatInfo {
  id: string;
  title: string;
  username?: string;
  type: 'channel' | 'group' | 'supergroup' | 'private';
  memberCount?: number;
  description?: string;
  isPublic: boolean;
  accessHash?: string;
}

// 搜索过滤器
export interface SearchFilter {
  mediaTypes?: MediaType[];
  minSize?: number;           // 最小文件大小（字节）
  maxSize?: number;           // 最大文件大小（字节）
  startDate?: Date;
  endDate?: Date;
  keyword?: string;
  downloadableOnly?: boolean;
}

// 下载任务
export interface DownloadTask {
  id: string;
  media: MediaInfo;
  status: DownloadStatus;
  progress: number;           // 0-100
  downloadedBytes: number;
  speed: number;              // 字节/秒
  speedFormatted: string;
  eta?: number;               // 预计剩余时间（秒）
  outputPath: string;
  customFileName?: string;
  error?: string;
  retryCount: number;
  startTime?: Date;
  endTime?: Date;
}

// 下载配置
export interface DownloadConfig {
  outputDir: string;
  concurrentDownloads: number;   // 并发下载数
  chunkSize: number;             // 分块大小
  maxRetries: number;            // 最大重试次数
  retryDelay: number;            // 重试延迟（毫秒）
  resumeEnabled: boolean;        // 是否启用断点续传
  speedLimit?: number;           // 速度限制（字节/秒）
  fileNameTemplate: string;      // 文件名模板
  createSubfolders: boolean;     // 是否按类型创建子文件夹
  skipExisting: boolean;         // 跳过已存在文件
}

// 文件名模板变量
export interface FileNameVariables {
  id: string;
  chatTitle: string;
  chatId: string;
  date: string;
  time: string;
  type: string;
  originalName: string;
  extension: string;
  caption: string;
  messageId: string;
}

// 聚合结果统计
export interface AggregationStats {
  totalMessages: number;
  totalMedia: number;
  totalSize: number;
  totalSizeFormatted: string;
  byType: Record<MediaType, { count: number; size: number }>;
  byDownloadable: Record<DownloadableType, number>;
  dateRange: { start: Date; end: Date };
}

// 下载进度回调
export type ProgressCallback = (task: DownloadTask) => void;

// 事件类型
export interface DownloadEvents {
  onStart: (task: DownloadTask) => void;
  onProgress: (task: DownloadTask) => void;
  onComplete: (task: DownloadTask) => void;
  onError: (task: DownloadTask, error: Error) => void;
  onPause: (task: DownloadTask) => void;
  onResume: (task: DownloadTask) => void;
}
