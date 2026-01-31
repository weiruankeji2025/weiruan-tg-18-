/**
 * 内容聚合模块
 * 负责从频道/群组中获取和分类媒体内容
 */

import { TelegramClient } from 'telegram';
import { Api } from 'telegram/tl';
import {
  MediaInfo,
  MediaType,
  DownloadableType,
  ChatInfo,
  SearchFilter,
  AggregationStats,
} from '../types';
import {
  formatFileSize,
  getExtension,
  generateId,
} from '../utils/helpers';
import { getClient } from './client';

// 最大文件大小限制（2GB）
const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024;

/**
 * 将Telegram消息的媒体转换为MediaInfo
 */
function extractMediaInfo(
  message: Api.Message,
  chatId: string,
  chatTitle: string
): MediaInfo | null {
  if (!message.media) return null;

  let type: MediaType = MediaType.UNKNOWN;
  let mimeType: string | undefined;
  let fileName: string | undefined;
  let fileSize = 0;
  let duration: number | undefined;
  let width: number | undefined;
  let height: number | undefined;

  const media = message.media;

  // 判断媒体类型
  if (media instanceof Api.MessageMediaPhoto) {
    type = MediaType.PHOTO;
    const photo = media.photo;
    if (photo instanceof Api.Photo) {
      // 获取最大尺寸
      const sizes = photo.sizes;
      const largest = sizes[sizes.length - 1];
      if (largest instanceof Api.PhotoSize) {
        fileSize = largest.size;
        width = largest.w;
        height = largest.h;
      }
    }
    mimeType = 'image/jpeg';
    fileName = `photo_${message.id}.jpg`;
  } else if (media instanceof Api.MessageMediaDocument) {
    const doc = media.document;
    if (doc instanceof Api.Document) {
      fileSize = Number(doc.size);
      mimeType = doc.mimeType;

      // 检查文档属性
      for (const attr of doc.attributes) {
        if (attr instanceof Api.DocumentAttributeFilename) {
          fileName = attr.fileName;
        }
        if (attr instanceof Api.DocumentAttributeVideo) {
          type = attr.roundMessage ? MediaType.VIDEO_NOTE : MediaType.VIDEO;
          duration = attr.duration;
          width = attr.w;
          height = attr.h;
        }
        if (attr instanceof Api.DocumentAttributeAudio) {
          type = attr.voice ? MediaType.VOICE : MediaType.AUDIO;
          duration = attr.duration;
        }
        if (attr instanceof Api.DocumentAttributeAnimated) {
          type = MediaType.ANIMATION;
        }
        if (attr instanceof Api.DocumentAttributeSticker) {
          type = MediaType.STICKER;
        }
      }

      // 如果还是未知类型，设为文档
      if (type === MediaType.UNKNOWN) {
        type = MediaType.DOCUMENT;
      }

      if (!fileName) {
        const ext = getExtension('', mimeType);
        fileName = `file_${message.id}${ext}`;
      }
    }
  } else {
    // 不支持的媒体类型
    return null;
  }

  // 判断是否可下载
  let downloadable: DownloadableType = DownloadableType.DOWNLOADABLE;
  let downloadableReason: string | undefined;

  if (fileSize > MAX_FILE_SIZE) {
    downloadable = DownloadableType.TOO_LARGE;
    downloadableReason = `文件大小超过2GB限制 (${formatFileSize(fileSize)})`;
  }

  // 检查是否受限
  if (media instanceof Api.MessageMediaDocument && media.document instanceof Api.Document) {
    // 某些频道可能限制下载
    // 这里可以添加更多限制检测逻辑
  }

  return {
    id: generateId(),
    messageId: message.id,
    chatId,
    chatTitle,
    type,
    mimeType,
    fileName,
    fileSize,
    fileSizeFormatted: formatFileSize(fileSize),
    downloadable,
    downloadableReason,
    date: new Date(message.date * 1000),
    caption: message.message || undefined,
    duration,
    width,
    height,
  };
}

/**
 * 从频道/群组获取媒体列表
 */
export async function aggregateMedia(
  chatIdentifier: string,
  filter?: SearchFilter,
  limit: number = 1000,
  progressCallback?: (current: number, total: number) => void
): Promise<MediaInfo[]> {
  const client = getClient();
  if (!client) {
    throw new Error('Telegram客户端未连接');
  }

  const mediaList: MediaInfo[] = [];

  try {
    // 获取频道信息
    const entity = await client.getEntity(chatIdentifier);
    let chatId: string;
    let chatTitle: string;

    if (entity instanceof Api.Channel || entity instanceof Api.Chat) {
      chatId = entity.id.toString();
      chatTitle = entity.title;
    } else if (entity instanceof Api.User) {
      chatId = entity.id.toString();
      chatTitle = entity.firstName || entity.username || 'User';
    } else {
      chatId = 'unknown';
      chatTitle = 'Unknown';
    }

    // 构建搜索过滤器
    let messageFilter: Api.TypeMessagesFilter | undefined;
    if (filter?.mediaTypes?.length === 1) {
      const type = filter.mediaTypes[0];
      switch (type) {
        case MediaType.PHOTO:
          messageFilter = new Api.InputMessagesFilterPhotos();
          break;
        case MediaType.VIDEO:
          messageFilter = new Api.InputMessagesFilterVideo();
          break;
        case MediaType.DOCUMENT:
          messageFilter = new Api.InputMessagesFilterDocument();
          break;
        case MediaType.AUDIO:
          messageFilter = new Api.InputMessagesFilterMusic();
          break;
        case MediaType.VOICE:
          messageFilter = new Api.InputMessagesFilterVoice();
          break;
        case MediaType.ANIMATION:
          messageFilter = new Api.InputMessagesFilterGif();
          break;
      }
    }

    // 迭代获取消息
    let processed = 0;
    const searchOpts: any = {
      limit: Math.min(limit, 100),
      filter: messageFilter,
    };

    // 使用iter_messages进行分页
    for await (const message of client.iterMessages(entity, {
      limit,
      filter: messageFilter,
      search: filter?.keyword,
    })) {
      if (!(message instanceof Api.Message)) continue;

      processed++;
      if (progressCallback) {
        progressCallback(processed, limit);
      }

      const mediaInfo = extractMediaInfo(message, chatId, chatTitle);
      if (!mediaInfo) continue;

      // 应用过滤器
      if (filter) {
        // 媒体类型过滤
        if (filter.mediaTypes && !filter.mediaTypes.includes(mediaInfo.type)) {
          continue;
        }

        // 大小过滤
        if (filter.minSize && mediaInfo.fileSize < filter.minSize) {
          continue;
        }
        if (filter.maxSize && mediaInfo.fileSize > filter.maxSize) {
          continue;
        }

        // 日期过滤
        if (filter.startDate && mediaInfo.date < filter.startDate) {
          continue;
        }
        if (filter.endDate && mediaInfo.date > filter.endDate) {
          continue;
        }

        // 只保留可下载的
        if (filter.downloadableOnly && mediaInfo.downloadable !== DownloadableType.DOWNLOADABLE) {
          continue;
        }
      }

      mediaList.push(mediaInfo);
    }
  } catch (error) {
    console.error('聚合媒体失败:', error);
    throw error;
  }

  return mediaList;
}

/**
 * 获取频道/群组信息
 */
export async function getChatInfo(identifier: string): Promise<ChatInfo | null> {
  const client = getClient();
  if (!client) return null;

  try {
    const entity = await client.getEntity(identifier);

    if (entity instanceof Api.Channel) {
      return {
        id: entity.id.toString(),
        title: entity.title,
        username: entity.username || undefined,
        type: entity.megagroup ? 'supergroup' : 'channel',
        memberCount: entity.participantsCount || undefined,
        isPublic: !entity.restricted && !!entity.username,
        accessHash: entity.accessHash?.toString(),
      };
    }

    if (entity instanceof Api.Chat) {
      return {
        id: entity.id.toString(),
        title: entity.title,
        type: 'group',
        memberCount: entity.participantsCount,
        isPublic: false,
      };
    }

    if (entity instanceof Api.User) {
      return {
        id: entity.id.toString(),
        title: entity.firstName || entity.username || 'User',
        username: entity.username || undefined,
        type: 'private',
        isPublic: false,
      };
    }

    return null;
  } catch (error) {
    console.error('获取频道信息失败:', error);
    return null;
  }
}

/**
 * 生成聚合统计
 */
export function generateStats(mediaList: MediaInfo[]): AggregationStats {
  const stats: AggregationStats = {
    totalMessages: mediaList.length,
    totalMedia: mediaList.length,
    totalSize: 0,
    totalSizeFormatted: '',
    byType: {} as Record<MediaType, { count: number; size: number }>,
    byDownloadable: {} as Record<DownloadableType, number>,
    dateRange: {
      start: new Date(),
      end: new Date(0),
    },
  };

  // 初始化类型统计
  for (const type of Object.values(MediaType)) {
    stats.byType[type] = { count: 0, size: 0 };
  }

  // 初始化可下载性统计
  for (const type of Object.values(DownloadableType)) {
    stats.byDownloadable[type] = 0;
  }

  // 统计
  for (const media of mediaList) {
    stats.totalSize += media.fileSize;

    stats.byType[media.type].count++;
    stats.byType[media.type].size += media.fileSize;

    stats.byDownloadable[media.downloadable]++;

    if (media.date < stats.dateRange.start) {
      stats.dateRange.start = media.date;
    }
    if (media.date > stats.dateRange.end) {
      stats.dateRange.end = media.date;
    }
  }

  stats.totalSizeFormatted = formatFileSize(stats.totalSize);

  return stats;
}

/**
 * 按类型分组媒体
 */
export function groupByType(mediaList: MediaInfo[]): Map<MediaType, MediaInfo[]> {
  const groups = new Map<MediaType, MediaInfo[]>();

  for (const media of mediaList) {
    if (!groups.has(media.type)) {
      groups.set(media.type, []);
    }
    groups.get(media.type)!.push(media);
  }

  return groups;
}

/**
 * 按可下载性分组媒体
 */
export function groupByDownloadable(mediaList: MediaInfo[]): Map<DownloadableType, MediaInfo[]> {
  const groups = new Map<DownloadableType, MediaInfo[]>();

  for (const media of mediaList) {
    if (!groups.has(media.downloadable)) {
      groups.set(media.downloadable, []);
    }
    groups.get(media.downloadable)!.push(media);
  }

  return groups;
}

/**
 * 搜索已加入的频道/群组
 */
export async function searchJoinedChats(keyword: string): Promise<ChatInfo[]> {
  const client = getClient();
  if (!client) return [];

  const results: ChatInfo[] = [];

  try {
    const dialogs = await client.getDialogs({ limit: 500 });

    for (const dialog of dialogs) {
      const entity = dialog.entity;
      let chatInfo: ChatInfo | null = null;

      if (entity instanceof Api.Channel) {
        chatInfo = {
          id: entity.id.toString(),
          title: entity.title,
          username: entity.username || undefined,
          type: entity.megagroup ? 'supergroup' : 'channel',
          isPublic: !!entity.username,
        };
      } else if (entity instanceof Api.Chat) {
        chatInfo = {
          id: entity.id.toString(),
          title: entity.title,
          type: 'group',
          isPublic: false,
        };
      }

      if (chatInfo) {
        const searchLower = keyword.toLowerCase();
        if (
          chatInfo.title.toLowerCase().includes(searchLower) ||
          (chatInfo.username && chatInfo.username.toLowerCase().includes(searchLower))
        ) {
          results.push(chatInfo);
        }
      }
    }
  } catch (error) {
    console.error('搜索频道失败:', error);
  }

  return results;
}
