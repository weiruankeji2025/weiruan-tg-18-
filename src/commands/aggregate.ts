/**
 * 聚合命令 - 搜索和列出频道内容
 */

import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import {
  aggregateMedia,
  getChatInfo,
  generateStats,
  groupByType,
  groupByDownloadable,
  searchJoinedChats,
} from '../core/aggregator';
import { connectWithSession } from '../core/client';
import { getTelegramConfig, isLoggedIn } from '../utils/config';
import {
  MediaInfo,
  MediaType,
  DownloadableType,
  SearchFilter,
  AggregationStats,
} from '../types';
import { formatFileSize, formatDate, createProgressBar } from '../utils/helpers';

// 媒体类型显示名称
const mediaTypeNames: Record<MediaType, string> = {
  [MediaType.PHOTO]: '图片',
  [MediaType.VIDEO]: '视频',
  [MediaType.DOCUMENT]: '文档',
  [MediaType.AUDIO]: '音频',
  [MediaType.VOICE]: '语音',
  [MediaType.VIDEO_NOTE]: '视频消息',
  [MediaType.ANIMATION]: '动图',
  [MediaType.STICKER]: '贴纸',
  [MediaType.UNKNOWN]: '未知',
};

// 可下载性显示名称
const downloadableTypeNames: Record<DownloadableType, string> = {
  [DownloadableType.DOWNLOADABLE]: '可下载',
  [DownloadableType.RESTRICTED]: '受限制',
  [DownloadableType.EXPIRED]: '已过期',
  [DownloadableType.TOO_LARGE]: '文件过大',
  [DownloadableType.UNSUPPORTED]: '不支持',
};

/**
 * 确保已登录
 */
async function ensureLogin(): Promise<boolean> {
  if (!isLoggedIn()) {
    console.log(chalk.yellow('请先登录: tg-agg login'));
    return false;
  }

  const config = getTelegramConfig();
  if (!config) {
    console.log(chalk.red('配置加载失败'));
    return false;
  }

  const spinner = ora('正在连接 Telegram...').start();
  const client = await connectWithSession(config);

  if (!client) {
    spinner.fail('连接失败，请重新登录');
    return false;
  }

  spinner.succeed('已连接');
  return true;
}

/**
 * 显示统计信息
 */
function displayStats(stats: AggregationStats): void {
  console.log(chalk.cyan('\n=== 聚合统计 ===\n'));

  console.log(chalk.white(`总媒体数: ${chalk.bold(stats.totalMedia)}`));
  console.log(chalk.white(`总大小: ${chalk.bold(stats.totalSizeFormatted)}`));
  console.log(
    chalk.white(
      `时间范围: ${formatDate(stats.dateRange.start)} ~ ${formatDate(stats.dateRange.end)}`
    )
  );

  // 按类型统计
  console.log(chalk.cyan('\n--- 按类型分类 ---'));
  for (const [type, data] of Object.entries(stats.byType)) {
    if (data.count > 0) {
      const typeName = mediaTypeNames[type as MediaType];
      console.log(
        chalk.white(
          `  ${typeName}: ${chalk.bold(data.count)} 个 (${formatFileSize(data.size)})`
        )
      );
    }
  }

  // 按可下载性统计
  console.log(chalk.cyan('\n--- 按可下载性分类 ---'));
  for (const [type, count] of Object.entries(stats.byDownloadable)) {
    if (count > 0) {
      const typeName = downloadableTypeNames[type as DownloadableType];
      const color =
        type === DownloadableType.DOWNLOADABLE ? chalk.green : chalk.yellow;
      console.log(color(`  ${typeName}: ${chalk.bold(count)} 个`));
    }
  }
}

/**
 * 显示媒体列表
 */
function displayMediaList(
  mediaList: MediaInfo[],
  page: number = 1,
  pageSize: number = 20
): void {
  const startIdx = (page - 1) * pageSize;
  const endIdx = Math.min(startIdx + pageSize, mediaList.length);
  const totalPages = Math.ceil(mediaList.length / pageSize);

  console.log(chalk.cyan(`\n=== 媒体列表 (第 ${page}/${totalPages} 页) ===\n`));

  for (let i = startIdx; i < endIdx; i++) {
    const media = mediaList[i];
    const downloadableIcon =
      media.downloadable === DownloadableType.DOWNLOADABLE
        ? chalk.green('✓')
        : chalk.red('✗');

    console.log(
      chalk.white(
        `${i + 1}. [${downloadableIcon}] ${mediaTypeNames[media.type]} - ${
          media.fileName || 'unnamed'
        }`
      )
    );
    console.log(chalk.gray(`   大小: ${media.fileSizeFormatted} | 日期: ${formatDate(media.date)}`));
    if (media.caption) {
      console.log(chalk.gray(`   描述: ${media.caption.slice(0, 50)}...`));
    }
  }
}

/**
 * 交互式搜索频道
 */
export async function searchChannel(): Promise<string | null> {
  const { keyword } = await inquirer.prompt([
    {
      type: 'input',
      name: 'keyword',
      message: '请输入频道/群组名称或用户名:',
      validate: (input) => (input ? true : '请输入搜索关键词'),
    },
  ]);

  const spinner = ora('正在搜索...').start();
  const results = await searchJoinedChats(keyword);

  if (results.length === 0) {
    spinner.fail('未找到匹配的频道');
    return null;
  }

  spinner.succeed(`找到 ${results.length} 个频道`);

  const { selected } = await inquirer.prompt([
    {
      type: 'list',
      name: 'selected',
      message: '请选择频道:',
      choices: results.map((chat) => ({
        name: `${chat.title} ${chat.username ? `(@${chat.username})` : ''} [${chat.type}]`,
        value: chat.username ? `@${chat.username}` : chat.id,
      })),
    },
  ]);

  return selected;
}

/**
 * 构建搜索过滤器
 */
async function buildFilter(): Promise<SearchFilter> {
  const { useFilter } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'useFilter',
      message: '是否使用过滤器?',
      default: false,
    },
  ]);

  if (!useFilter) {
    return {};
  }

  const filter: SearchFilter = {};

  const answers = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'mediaTypes',
      message: '选择媒体类型 (空选表示全部):',
      choices: [
        { name: '图片', value: MediaType.PHOTO },
        { name: '视频', value: MediaType.VIDEO },
        { name: '文档', value: MediaType.DOCUMENT },
        { name: '音频', value: MediaType.AUDIO },
        { name: '动图', value: MediaType.ANIMATION },
      ],
    },
    {
      type: 'input',
      name: 'minSize',
      message: '最小文件大小 (如 1MB, 留空不限制):',
    },
    {
      type: 'input',
      name: 'maxSize',
      message: '最大文件大小 (如 100MB, 留空不限制):',
    },
    {
      type: 'input',
      name: 'keyword',
      message: '关键词搜索 (留空不限制):',
    },
    {
      type: 'confirm',
      name: 'downloadableOnly',
      message: '只显示可下载的文件?',
      default: true,
    },
  ]);

  if (answers.mediaTypes?.length > 0) {
    filter.mediaTypes = answers.mediaTypes;
  }

  if (answers.minSize) {
    filter.minSize = parseSize(answers.minSize);
  }

  if (answers.maxSize) {
    filter.maxSize = parseSize(answers.maxSize);
  }

  if (answers.keyword) {
    filter.keyword = answers.keyword;
  }

  filter.downloadableOnly = answers.downloadableOnly;

  return filter;
}

/**
 * 解析大小字符串
 */
function parseSize(sizeStr: string): number {
  const match = sizeStr.match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)?$/i);
  if (!match) return 0;

  const value = parseFloat(match[1]);
  const unit = (match[2] || 'B').toUpperCase();

  const multipliers: Record<string, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024,
  };

  return Math.floor(value * (multipliers[unit] || 1));
}

/**
 * 主聚合命令
 */
export async function aggregate(
  target?: string,
  options?: { limit?: number; output?: string }
): Promise<MediaInfo[]> {
  if (!(await ensureLogin())) {
    return [];
  }

  // 获取目标频道
  let chatIdentifier = target;
  if (!chatIdentifier) {
    chatIdentifier = await searchChannel();
    if (!chatIdentifier) {
      return [];
    }
  }

  // 获取频道信息
  const spinner = ora('正在获取频道信息...').start();
  const chatInfo = await getChatInfo(chatIdentifier);

  if (!chatInfo) {
    spinner.fail('无法获取频道信息');
    return [];
  }

  spinner.succeed(`频道: ${chatInfo.title}`);

  // 构建过滤器
  const filter = await buildFilter();

  // 聚合媒体
  const limit = options?.limit || 500;
  console.log(chalk.cyan(`\n正在扫描最近 ${limit} 条消息...\n`));

  let lastProgress = 0;
  const aggregateSpinner = ora('扫描中...').start();

  const mediaList = await aggregateMedia(
    chatIdentifier,
    filter,
    limit,
    (current, total) => {
      const progress = Math.round((current / total) * 100);
      if (progress !== lastProgress) {
        aggregateSpinner.text = `扫描中... ${createProgressBar(progress, 20)}`;
        lastProgress = progress;
      }
    }
  );

  aggregateSpinner.succeed(`扫描完成，找到 ${mediaList.length} 个媒体文件`);

  // 显示统计
  const stats = generateStats(mediaList);
  displayStats(stats);

  // 显示媒体列表
  if (mediaList.length > 0) {
    const { showList } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'showList',
        message: '是否显示详细列表?',
        default: false,
      },
    ]);

    if (showList) {
      displayMediaList(mediaList);
    }
  }

  return mediaList;
}

/**
 * 列出已加入的频道
 */
export async function listChannels(): Promise<void> {
  if (!(await ensureLogin())) {
    return;
  }

  const spinner = ora('正在获取频道列表...').start();
  const channels = await searchJoinedChats('');

  if (channels.length === 0) {
    spinner.fail('未找到已加入的频道');
    return;
  }

  spinner.succeed(`找到 ${channels.length} 个频道/群组`);

  console.log(chalk.cyan('\n=== 频道列表 ===\n'));

  for (const chat of channels) {
    const icon = chat.type === 'channel' ? '📢' : '👥';
    console.log(
      chalk.white(
        `${icon} ${chat.title} ${chat.username ? chalk.gray(`@${chat.username}`) : ''}`
      )
    );
  }
}
