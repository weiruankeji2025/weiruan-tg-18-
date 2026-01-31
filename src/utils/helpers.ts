/**
 * 工具函数
 */

import * as fs from 'fs';
import * as path from 'path';
import { FileNameVariables, MediaType } from '../types';

/**
 * 格式化文件大小
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${units[i]}`;
}

/**
 * 格式化速度
 */
export function formatSpeed(bytesPerSecond: number): string {
  return `${formatFileSize(bytesPerSecond)}/s`;
}

/**
 * 格式化时间（秒转为可读格式）
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}秒`;
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}分${secs}秒`;
  }
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}小时${mins}分`;
}

/**
 * 格式化日期
 */
export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * 格式化时间
 */
export function formatTime(date: Date): string {
  return date.toTimeString().split(' ')[0].replace(/:/g, '-');
}

/**
 * 清理文件名（移除非法字符）
 */
export function sanitizeFileName(name: string): string {
  // 移除Windows和Unix非法字符
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 200); // 限制长度
}

/**
 * 根据模板生成文件名
 *
 * 支持的变量:
 * {id} - 文件ID
 * {chatTitle} - 频道/群组名称
 * {chatId} - 频道/群组ID
 * {date} - 日期 (YYYY-MM-DD)
 * {time} - 时间 (HH-MM-SS)
 * {type} - 媒体类型
 * {originalName} - 原始文件名
 * {extension} - 扩展名
 * {caption} - 消息标题（前30字符）
 * {messageId} - 消息ID
 */
export function generateFileName(template: string, vars: FileNameVariables): string {
  let result = template;

  result = result.replace(/\{id\}/g, vars.id);
  result = result.replace(/\{chatTitle\}/g, sanitizeFileName(vars.chatTitle));
  result = result.replace(/\{chatId\}/g, vars.chatId);
  result = result.replace(/\{date\}/g, vars.date);
  result = result.replace(/\{time\}/g, vars.time);
  result = result.replace(/\{type\}/g, vars.type);
  result = result.replace(/\{originalName\}/g, sanitizeFileName(vars.originalName));
  result = result.replace(/\{extension\}/g, vars.extension);
  result = result.replace(/\{caption\}/g, sanitizeFileName(vars.caption.slice(0, 30)));
  result = result.replace(/\{messageId\}/g, vars.messageId);

  return sanitizeFileName(result);
}

/**
 * 确保目录存在
 */
export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * 检查文件是否存在
 */
export function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

/**
 * 获取文件扩展名
 */
export function getExtension(fileName: string, mimeType?: string): string {
  // 首先尝试从文件名获取
  const extFromName = path.extname(fileName).toLowerCase();
  if (extFromName) return extFromName;

  // 否则从MIME类型推断
  const mimeToExt: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'video/mp4': '.mp4',
    'video/quicktime': '.mov',
    'video/x-matroska': '.mkv',
    'video/webm': '.webm',
    'audio/mpeg': '.mp3',
    'audio/ogg': '.ogg',
    'audio/wav': '.wav',
    'audio/flac': '.flac',
    'application/pdf': '.pdf',
    'application/zip': '.zip',
    'application/x-rar-compressed': '.rar',
    'application/x-7z-compressed': '.7z',
    'text/plain': '.txt',
  };

  if (mimeType && mimeToExt[mimeType]) {
    return mimeToExt[mimeType];
  }

  return '';
}

/**
 * 根据MIME类型判断媒体类型
 */
export function getMediaTypeFromMime(mimeType: string): MediaType {
  if (mimeType.startsWith('image/')) {
    if (mimeType === 'image/gif') return MediaType.ANIMATION;
    return MediaType.PHOTO;
  }
  if (mimeType.startsWith('video/')) return MediaType.VIDEO;
  if (mimeType.startsWith('audio/')) return MediaType.AUDIO;
  return MediaType.DOCUMENT;
}

/**
 * 生成唯一ID
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 延迟函数
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 重试执行函数
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  delayMs: number,
  backoff: boolean = true
): Promise<T> {
  let lastError: Error | undefined;

  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (i < maxRetries) {
        const waitTime = backoff ? delayMs * Math.pow(2, i) : delayMs;
        await delay(waitTime);
      }
    }
  }

  throw lastError;
}

/**
 * 分批处理数组
 */
export function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * 获取媒体类型的子文件夹名称
 */
export function getMediaTypeFolder(type: MediaType): string {
  const folders: Record<MediaType, string> = {
    [MediaType.PHOTO]: 'photos',
    [MediaType.VIDEO]: 'videos',
    [MediaType.DOCUMENT]: 'documents',
    [MediaType.AUDIO]: 'audio',
    [MediaType.VOICE]: 'voice',
    [MediaType.VIDEO_NOTE]: 'video_notes',
    [MediaType.ANIMATION]: 'animations',
    [MediaType.STICKER]: 'stickers',
    [MediaType.UNKNOWN]: 'other',
  };
  return folders[type];
}

/**
 * 计算百分比
 */
export function calculatePercentage(current: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((current / total) * 100);
}

/**
 * 创建进度条字符串
 */
export function createProgressBar(percentage: number, width: number = 30): string {
  const filled = Math.round((percentage / 100) * width);
  const empty = width - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${percentage}%`;
}
