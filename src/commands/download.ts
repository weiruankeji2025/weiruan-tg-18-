/**
 * 下载命令
 */

import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import cliProgress from 'cli-progress';
import {
  downloadAll,
  downloadOne,
  getAllTasks,
  getDownloadStats,
  pauseDownload,
  resumeDownload,
  cancelDownload,
} from '../core/downloader';
import { aggregate } from './aggregate';
import { connectWithSession } from '../core/client';
import {
  getTelegramConfig,
  isLoggedIn,
  getDownloadConfig,
  updateDownloadConfig,
} from '../utils/config';
import {
  MediaInfo,
  DownloadTask,
  DownloadStatus,
  DownloadConfig,
  DownloadableType,
} from '../types';
import { formatFileSize, formatSpeed, formatDuration } from '../utils/helpers';

// 缓存当前聚合的媒体列表
let cachedMediaList: MediaInfo[] = [];

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

  const client = await connectWithSession(config);
  if (!client) {
    console.log(chalk.red('连接失败，请重新登录'));
    return false;
  }

  return true;
}

/**
 * 创建多进度条
 */
function createMultiBar(): cliProgress.MultiBar {
  return new cliProgress.MultiBar(
    {
      clearOnComplete: false,
      hideCursor: true,
      format: '{filename} |{bar}| {percentage}% | {speed} | ETA: {eta}',
    },
    cliProgress.Presets.shades_classic
  );
}

/**
 * 下载选中的文件
 */
export async function downloadSelected(mediaList?: MediaInfo[]): Promise<void> {
  if (!(await ensureLogin())) {
    return;
  }

  // 使用缓存或新聚合
  let media = mediaList || cachedMediaList;

  if (!media || media.length === 0) {
    console.log(chalk.yellow('没有可下载的媒体，请先运行聚合命令'));
    media = await aggregate();
    if (media.length === 0) {
      return;
    }
  }

  // 过滤可下载的
  const downloadable = media.filter(
    (m) => m.downloadable === DownloadableType.DOWNLOADABLE
  );

  if (downloadable.length === 0) {
    console.log(chalk.yellow('没有可下载的文件'));
    return;
  }

  // 选择下载方式
  const { downloadMode } = await inquirer.prompt([
    {
      type: 'list',
      name: 'downloadMode',
      message: `找到 ${downloadable.length} 个可下载文件，请选择下载方式:`,
      choices: [
        { name: '下载全部', value: 'all' },
        { name: '选择下载', value: 'select' },
        { name: '按类型下载', value: 'type' },
        { name: '取消', value: 'cancel' },
      ],
    },
  ]);

  if (downloadMode === 'cancel') {
    return;
  }

  let toDownload: MediaInfo[] = [];

  if (downloadMode === 'all') {
    toDownload = downloadable;
  } else if (downloadMode === 'select') {
    // 选择具体文件
    const { selected } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'selected',
        message: '选择要下载的文件:',
        choices: downloadable.slice(0, 50).map((m, idx) => ({
          name: `${m.fileName || `file_${idx}`} (${m.fileSizeFormatted})`,
          value: m.id,
          checked: false,
        })),
        pageSize: 20,
      },
    ]);

    toDownload = downloadable.filter((m) => selected.includes(m.id));
  } else if (downloadMode === 'type') {
    // 按类型选择
    const types = [...new Set(downloadable.map((m) => m.type))];
    const { selectedTypes } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'selectedTypes',
        message: '选择要下载的媒体类型:',
        choices: types.map((t) => ({ name: t, value: t })),
      },
    ]);

    toDownload = downloadable.filter((m) => selectedTypes.includes(m.type));
  }

  if (toDownload.length === 0) {
    console.log(chalk.yellow('未选择任何文件'));
    return;
  }

  // 确认下载
  const totalSize = toDownload.reduce((sum, m) => sum + m.fileSize, 0);
  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: `即将下载 ${toDownload.length} 个文件 (${formatFileSize(totalSize)})，确认?`,
      default: true,
    },
  ]);

  if (!confirm) {
    return;
  }

  // 执行下载
  await executeDownload(toDownload);
}

/**
 * 执行下载任务
 */
async function executeDownload(mediaList: MediaInfo[]): Promise<void> {
  const config = getDownloadConfig();

  console.log(chalk.cyan(`\n开始下载 ${mediaList.length} 个文件...\n`));
  console.log(chalk.gray(`输出目录: ${config.outputDir}`));
  console.log(chalk.gray(`并发数: ${config.concurrentDownloads}`));
  console.log('');

  // 创建进度条
  const multibar = createMultiBar();
  const bars: Map<string, cliProgress.SingleBar> = new Map();

  let completed = 0;
  let failed = 0;

  const tasks = await downloadAll(mediaList, config, {
    onStart: (task) => {
      const bar = multibar.create(100, 0, {
        filename: (task.media.fileName || 'file').slice(0, 30).padEnd(30),
        speed: '0 B/s',
        eta: '--:--',
      });
      bars.set(task.id, bar);
    },
    onProgress: (task) => {
      const bar = bars.get(task.id);
      if (bar) {
        bar.update(task.progress, {
          speed: task.speedFormatted,
          eta: task.eta ? formatDuration(task.eta) : '--:--',
        });
      }
    },
    onComplete: (task) => {
      const bar = bars.get(task.id);
      if (bar) {
        bar.update(100, { speed: 'Done', eta: '完成' });
      }
      completed++;
    },
    onError: (task, error) => {
      const bar = bars.get(task.id);
      if (bar) {
        bar.update(task.progress, { speed: 'Error', eta: error.message.slice(0, 10) });
      }
      failed++;
    },
  });

  multibar.stop();

  // 显示结果
  console.log(chalk.cyan('\n=== 下载完成 ===\n'));
  console.log(chalk.green(`成功: ${completed} 个`));
  if (failed > 0) {
    console.log(chalk.red(`失败: ${failed} 个`));
  }
  console.log(chalk.gray(`输出目录: ${config.outputDir}`));
}

/**
 * 下载单个文件（支持自定义文件名）
 */
export async function downloadSingle(
  target?: string,
  messageId?: number,
  customFileName?: string
): Promise<void> {
  if (!(await ensureLogin())) {
    return;
  }

  // 如果没有提供目标，使用交互式选择
  if (!target) {
    if (cachedMediaList.length === 0) {
      console.log(chalk.yellow('请先运行聚合命令或指定频道'));
      return;
    }

    const downloadable = cachedMediaList.filter(
      (m) => m.downloadable === DownloadableType.DOWNLOADABLE
    );

    const { selected } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selected',
        message: '选择要下载的文件:',
        choices: downloadable.slice(0, 30).map((m) => ({
          name: `${m.fileName || 'unnamed'} (${m.fileSizeFormatted})`,
          value: m,
        })),
        pageSize: 15,
      },
    ]);

    // 询问自定义文件名
    const { useCustomName } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'useCustomName',
        message: '是否自定义文件名?',
        default: false,
      },
    ]);

    if (useCustomName) {
      const { fileName } = await inquirer.prompt([
        {
          type: 'input',
          name: 'fileName',
          message: '输入文件名 (不含扩展名):',
          default: selected.fileName?.replace(/\.[^/.]+$/, '') || 'downloaded',
        },
      ]);
      customFileName = fileName;
    }

    const spinner = ora('下载中...').start();

    const task = await downloadOne(selected, undefined, customFileName, {
      onProgress: (t) => {
        spinner.text = `下载中... ${t.progress}% | ${t.speedFormatted}`;
      },
      onComplete: (t) => {
        spinner.succeed(`下载完成: ${t.outputPath}`);
      },
      onError: (t, err) => {
        spinner.fail(`下载失败: ${err.message}`);
      },
    });

    return;
  }

  // TODO: 支持通过URL直接下载
  console.log(chalk.yellow('直接URL下载功能开发中...'));
}

/**
 * 配置下载选项
 */
export async function configureDownload(): Promise<void> {
  const current = getDownloadConfig();

  console.log(chalk.cyan('\n=== 下载配置 ===\n'));

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'outputDir',
      message: '下载目录:',
      default: current.outputDir,
    },
    {
      type: 'number',
      name: 'concurrentDownloads',
      message: '并发下载数 (1-10):',
      default: current.concurrentDownloads,
      validate: (input) => {
        if (input >= 1 && input <= 10) return true;
        return '请输入 1-10 之间的数字';
      },
    },
    {
      type: 'input',
      name: 'fileNameTemplate',
      message: '文件名模板:',
      default: current.fileNameTemplate,
    },
    {
      type: 'confirm',
      name: 'createSubfolders',
      message: '按类型创建子文件夹?',
      default: current.createSubfolders,
    },
    {
      type: 'confirm',
      name: 'skipExisting',
      message: '跳过已存在的文件?',
      default: current.skipExisting,
    },
    {
      type: 'confirm',
      name: 'resumeEnabled',
      message: '启用断点续传?',
      default: current.resumeEnabled,
    },
  ]);

  updateDownloadConfig(answers);
  console.log(chalk.green('\n✓ 配置已保存\n'));

  // 显示文件名模板帮助
  console.log(chalk.gray('文件名模板变量:'));
  console.log(chalk.gray('  {id} - 文件ID'));
  console.log(chalk.gray('  {chatTitle} - 频道名称'));
  console.log(chalk.gray('  {date} - 日期'));
  console.log(chalk.gray('  {time} - 时间'));
  console.log(chalk.gray('  {type} - 媒体类型'));
  console.log(chalk.gray('  {originalName} - 原始文件名'));
  console.log(chalk.gray('  {extension} - 扩展名'));
  console.log(chalk.gray('  {messageId} - 消息ID'));
}

/**
 * 显示下载状态
 */
export function showDownloadStatus(): void {
  const stats = getDownloadStats();
  const tasks = getAllTasks();

  console.log(chalk.cyan('\n=== 下载状态 ===\n'));

  console.log(chalk.white(`总任务: ${stats.total}`));
  console.log(chalk.yellow(`等待中: ${stats.pending}`));
  console.log(chalk.blue(`下载中: ${stats.downloading}`));
  console.log(chalk.green(`已完成: ${stats.completed}`));
  console.log(chalk.red(`失败: ${stats.failed}`));
  console.log(chalk.gray(`已暂停: ${stats.paused}`));

  console.log(
    chalk.white(
      `\n进度: ${formatFileSize(stats.downloadedBytes)} / ${formatFileSize(stats.totalBytes)}`
    )
  );

  // 显示活动任务
  const activeTasks = tasks.filter(
    (t) =>
      t.status === DownloadStatus.DOWNLOADING ||
      t.status === DownloadStatus.PAUSED
  );

  if (activeTasks.length > 0) {
    console.log(chalk.cyan('\n--- 活动任务 ---'));
    for (const task of activeTasks) {
      const statusIcon =
        task.status === DownloadStatus.DOWNLOADING ? '▶️' : '⏸️';
      console.log(
        chalk.white(
          `${statusIcon} ${task.media.fileName || 'file'} - ${task.progress}% (${task.speedFormatted})`
        )
      );
    }
  }
}

/**
 * 设置缓存的媒体列表
 */
export function setCachedMediaList(list: MediaInfo[]): void {
  cachedMediaList = list;
}
