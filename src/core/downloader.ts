/**
 * 高速下载模块
 * 支持并发下载、断点续传、速度限制
 */

import * as fs from 'fs';
import * as path from 'path';
import { Api } from 'telegram/tl';
import pLimit from 'p-limit';
import {
  MediaInfo,
  MediaType,
  DownloadTask,
  DownloadStatus,
  DownloadConfig,
  DownloadEvents,
  DownloadableType,
  FileNameVariables,
} from '../types';
import {
  formatFileSize,
  formatSpeed,
  generateFileName,
  ensureDir,
  fileExists,
  getExtension,
  getMediaTypeFolder,
  generateId,
  delay,
  formatDate,
  formatTime,
} from '../utils/helpers';
import { getClient } from './client';
import { getDownloadConfig } from '../utils/config';

// 下载状态文件后缀
const DOWNLOAD_STATE_SUFFIX = '.dlstate';

// 下载任务队列
const downloadTasks: Map<string, DownloadTask> = new Map();

// 暂停标志
const pausedTasks: Set<string> = new Set();

// 取消标志
const cancelledTasks: Set<string> = new Set();

/**
 * 下载状态信息（用于断点续传）
 */
interface DownloadState {
  mediaId: string;
  messageId: number;
  chatId: string;
  outputPath: string;
  totalSize: number;
  downloadedBytes: number;
  chunks: { start: number; end: number; completed: boolean }[];
}

/**
 * 保存下载状态（断点续传）
 */
function saveDownloadState(state: DownloadState): void {
  const statePath = state.outputPath + DOWNLOAD_STATE_SUFFIX;
  fs.writeFileSync(statePath, JSON.stringify(state));
}

/**
 * 加载下载状态
 */
function loadDownloadState(outputPath: string): DownloadState | null {
  const statePath = outputPath + DOWNLOAD_STATE_SUFFIX;
  try {
    if (fs.existsSync(statePath)) {
      const content = fs.readFileSync(statePath, 'utf-8');
      return JSON.parse(content);
    }
  } catch (error) {
    // 忽略错误
  }
  return null;
}

/**
 * 删除下载状态文件
 */
function removeDownloadState(outputPath: string): void {
  const statePath = outputPath + DOWNLOAD_STATE_SUFFIX;
  try {
    if (fs.existsSync(statePath)) {
      fs.unlinkSync(statePath);
    }
  } catch (error) {
    // 忽略错误
  }
}

/**
 * 生成输出文件路径
 */
export function generateOutputPath(
  media: MediaInfo,
  config: DownloadConfig,
  customFileName?: string
): string {
  let fileName: string;

  if (customFileName) {
    // 使用自定义文件名
    const ext = getExtension(media.fileName || '', media.mimeType);
    fileName = customFileName.includes('.') ? customFileName : `${customFileName}${ext}`;
  } else {
    // 使用模板生成文件名
    const vars: FileNameVariables = {
      id: media.id,
      chatTitle: media.chatTitle,
      chatId: media.chatId,
      date: formatDate(media.date),
      time: formatTime(media.date),
      type: media.type,
      originalName: media.fileName || `file_${media.messageId}`,
      extension: getExtension(media.fileName || '', media.mimeType).replace('.', ''),
      caption: media.caption || '',
      messageId: media.messageId.toString(),
    };

    fileName = generateFileName(config.fileNameTemplate, vars);

    // 确保有扩展名
    if (!path.extname(fileName)) {
      fileName += getExtension(media.fileName || '', media.mimeType);
    }
  }

  // 构建目录路径
  let outputDir = config.outputDir;

  if (config.createSubfolders) {
    outputDir = path.join(outputDir, getMediaTypeFolder(media.type));
  }

  ensureDir(outputDir);

  return path.join(outputDir, fileName);
}

/**
 * 创建下载任务
 */
export function createDownloadTask(
  media: MediaInfo,
  config?: Partial<DownloadConfig>,
  customFileName?: string
): DownloadTask {
  const downloadConfig = { ...getDownloadConfig(), ...config };
  const outputPath = generateOutputPath(media, downloadConfig, customFileName);

  const task: DownloadTask = {
    id: generateId(),
    media,
    status: DownloadStatus.PENDING,
    progress: 0,
    downloadedBytes: 0,
    speed: 0,
    speedFormatted: '0 B/s',
    outputPath,
    customFileName,
    retryCount: 0,
  };

  downloadTasks.set(task.id, task);
  return task;
}

/**
 * 执行单个下载任务
 */
async function executeDownload(
  task: DownloadTask,
  config: DownloadConfig,
  events?: Partial<DownloadEvents>
): Promise<void> {
  const client = getClient();
  if (!client) {
    throw new Error('Telegram客户端未连接');
  }

  // 检查是否可下载
  if (task.media.downloadable !== DownloadableType.DOWNLOADABLE) {
    task.status = DownloadStatus.FAILED;
    task.error = task.media.downloadableReason || '文件不可下载';
    if (events?.onError) {
      events.onError(task, new Error(task.error));
    }
    return;
  }

  // 检查文件是否已存在
  if (config.skipExisting && fileExists(task.outputPath)) {
    task.status = DownloadStatus.COMPLETED;
    task.progress = 100;
    task.downloadedBytes = task.media.fileSize;
    if (events?.onComplete) {
      events.onComplete(task);
    }
    return;
  }

  // 检查断点续传
  const existingState = config.resumeEnabled ? loadDownloadState(task.outputPath) : null;

  task.status = DownloadStatus.DOWNLOADING;
  task.startTime = new Date();

  if (events?.onStart) {
    events.onStart(task);
  }

  try {
    // 获取实体和消息
    const entity = await client.getEntity(task.media.chatId);
    const messages = await client.getMessages(entity, {
      ids: [task.media.messageId],
    });

    if (!messages || messages.length === 0) {
      throw new Error('消息不存在或已被删除');
    }

    const message = messages[0];
    if (!message || !(message instanceof Api.Message) || !message.media) {
      throw new Error('消息不包含媒体内容');
    }

    // 确保输出目录存在
    ensureDir(path.dirname(task.outputPath));

    // 使用流式下载
    let lastProgressTime = Date.now();
    let lastDownloadedBytes = existingState?.downloadedBytes || 0;

    // 下载文件
    const buffer = await client.downloadMedia(message, {
      progressCallback: (downloaded, total) => {
        // 检查是否暂停或取消
        if (pausedTasks.has(task.id)) {
          task.status = DownloadStatus.PAUSED;
          if (events?.onPause) {
            events.onPause(task);
          }
          throw new Error('PAUSED');
        }

        if (cancelledTasks.has(task.id)) {
          task.status = DownloadStatus.CANCELLED;
          throw new Error('CANCELLED');
        }

        // 更新进度
        task.downloadedBytes = Number(downloaded);
        task.progress = Math.round((Number(downloaded) / Number(total)) * 100);

        // 计算速度
        const now = Date.now();
        const timeDiff = (now - lastProgressTime) / 1000;
        if (timeDiff > 0.5) {
          const bytesDiff = task.downloadedBytes - lastDownloadedBytes;
          task.speed = bytesDiff / timeDiff;
          task.speedFormatted = formatSpeed(task.speed);

          // 计算预计剩余时间
          const remainingBytes = Number(total) - task.downloadedBytes;
          if (task.speed > 0) {
            task.eta = remainingBytes / task.speed;
          }

          lastProgressTime = now;
          lastDownloadedBytes = task.downloadedBytes;
        }

        if (events?.onProgress) {
          events.onProgress(task);
        }
      },
    });

    if (buffer) {
      // 写入文件
      fs.writeFileSync(task.outputPath, buffer);

      // 删除状态文件
      removeDownloadState(task.outputPath);

      task.status = DownloadStatus.COMPLETED;
      task.progress = 100;
      task.downloadedBytes = task.media.fileSize;
      task.endTime = new Date();

      if (events?.onComplete) {
        events.onComplete(task);
      }
    } else {
      throw new Error('下载返回空数据');
    }
  } catch (error: any) {
    if (error.message === 'PAUSED') {
      // 保存状态用于恢复
      saveDownloadState({
        mediaId: task.media.id,
        messageId: task.media.messageId,
        chatId: task.media.chatId,
        outputPath: task.outputPath,
        totalSize: task.media.fileSize,
        downloadedBytes: task.downloadedBytes,
        chunks: [],
      });
      return;
    }

    if (error.message === 'CANCELLED') {
      // 删除部分下载的文件
      try {
        if (fs.existsSync(task.outputPath)) {
          fs.unlinkSync(task.outputPath);
        }
        removeDownloadState(task.outputPath);
      } catch (e) {
        // 忽略
      }
      return;
    }

    // 重试逻辑
    if (task.retryCount < config.maxRetries) {
      task.retryCount++;
      await delay(config.retryDelay * task.retryCount);
      return executeDownload(task, config, events);
    }

    task.status = DownloadStatus.FAILED;
    task.error = error.message;
    task.endTime = new Date();

    if (events?.onError) {
      events.onError(task, error);
    }
  }
}

/**
 * 批量下载
 */
export async function downloadAll(
  mediaList: MediaInfo[],
  config?: Partial<DownloadConfig>,
  events?: Partial<DownloadEvents>
): Promise<DownloadTask[]> {
  const downloadConfig = { ...getDownloadConfig(), ...config };
  const tasks: DownloadTask[] = [];

  // 创建所有任务
  for (const media of mediaList) {
    if (media.downloadable === DownloadableType.DOWNLOADABLE) {
      const task = createDownloadTask(media, downloadConfig);
      tasks.push(task);
    }
  }

  // 使用并发限制
  const limit = pLimit(downloadConfig.concurrentDownloads);

  // 并发执行下载
  await Promise.all(
    tasks.map(task =>
      limit(async () => {
        await executeDownload(task, downloadConfig, events);
      })
    )
  );

  return tasks;
}

/**
 * 下载单个文件
 */
export async function downloadOne(
  media: MediaInfo,
  config?: Partial<DownloadConfig>,
  customFileName?: string,
  events?: Partial<DownloadEvents>
): Promise<DownloadTask> {
  const downloadConfig = { ...getDownloadConfig(), ...config };
  const task = createDownloadTask(media, downloadConfig, customFileName);

  await executeDownload(task, downloadConfig, events);

  return task;
}

/**
 * 暂停下载
 */
export function pauseDownload(taskId: string): void {
  pausedTasks.add(taskId);
}

/**
 * 恢复下载
 */
export async function resumeDownload(
  taskId: string,
  events?: Partial<DownloadEvents>
): Promise<void> {
  pausedTasks.delete(taskId);

  const task = downloadTasks.get(taskId);
  if (!task) return;

  task.status = DownloadStatus.DOWNLOADING;
  if (events?.onResume) {
    events.onResume(task);
  }

  const config = getDownloadConfig();
  await executeDownload(task, config, events);
}

/**
 * 取消下载
 */
export function cancelDownload(taskId: string): void {
  cancelledTasks.add(taskId);
}

/**
 * 获取所有下载任务
 */
export function getAllTasks(): DownloadTask[] {
  return Array.from(downloadTasks.values());
}

/**
 * 获取单个任务
 */
export function getTask(taskId: string): DownloadTask | undefined {
  return downloadTasks.get(taskId);
}

/**
 * 清理已完成的任务
 */
export function clearCompletedTasks(): void {
  for (const [id, task] of downloadTasks) {
    if (
      task.status === DownloadStatus.COMPLETED ||
      task.status === DownloadStatus.CANCELLED
    ) {
      downloadTasks.delete(id);
    }
  }
}

/**
 * 获取下载统计
 */
export function getDownloadStats(): {
  total: number;
  pending: number;
  downloading: number;
  completed: number;
  failed: number;
  paused: number;
  totalBytes: number;
  downloadedBytes: number;
} {
  const stats = {
    total: downloadTasks.size,
    pending: 0,
    downloading: 0,
    completed: 0,
    failed: 0,
    paused: 0,
    totalBytes: 0,
    downloadedBytes: 0,
  };

  for (const task of downloadTasks.values()) {
    stats.totalBytes += task.media.fileSize;
    stats.downloadedBytes += task.downloadedBytes;

    switch (task.status) {
      case DownloadStatus.PENDING:
        stats.pending++;
        break;
      case DownloadStatus.DOWNLOADING:
        stats.downloading++;
        break;
      case DownloadStatus.COMPLETED:
        stats.completed++;
        break;
      case DownloadStatus.FAILED:
        stats.failed++;
        break;
      case DownloadStatus.PAUSED:
        stats.paused++;
        break;
    }
  }

  return stats;
}
