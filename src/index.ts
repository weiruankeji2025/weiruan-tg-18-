#!/usr/bin/env node

/**
 * TG Content Aggregator - Telegram内容聚合下载工具
 *
 * 功能:
 * - 聚合频道/群组媒体内容
 * - 分类管理（可下载/不可下载，文件类型）
 * - 高速稳定下载（并发、断点续传）
 * - 自定义文件名
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { login, logout, showStatus, configureCredentials } from './commands/login';
import { aggregate, listChannels } from './commands/aggregate';
import { downloadSelected, downloadSingle, configureDownload, showDownloadStatus, setCachedMediaList } from './commands/download';
import { disconnect } from './core/client';

const program = new Command();

// 程序信息
program
  .name('tg-agg')
  .description(chalk.cyan('Telegram 内容聚合下载工具'))
  .version('1.0.0');

// 配置命令
program
  .command('config')
  .description('配置 Telegram API 凭据')
  .action(async () => {
    await configureCredentials();
  });

// 登录命令
program
  .command('login')
  .description('登录 Telegram 账号')
  .action(async () => {
    await login();
    await disconnect();
  });

// 登出命令
program
  .command('logout')
  .description('登出当前账号')
  .action(async () => {
    await logout();
  });

// 状态命令
program
  .command('status')
  .description('查看登录状态')
  .action(async () => {
    await showStatus();
    await disconnect();
  });

// 列出频道命令
program
  .command('list')
  .alias('ls')
  .description('列出已加入的频道/群组')
  .action(async () => {
    await listChannels();
    await disconnect();
  });

// 聚合命令
program
  .command('scan [target]')
  .alias('aggregate')
  .description('扫描频道/群组内容')
  .option('-l, --limit <number>', '扫描消息数量限制', '500')
  .option('-o, --output <file>', '导出结果到文件')
  .action(async (target, options) => {
    const limit = parseInt(options.limit) || 500;
    const mediaList = await aggregate(target, { limit, output: options.output });

    if (mediaList.length > 0) {
      setCachedMediaList(mediaList);

      // 询问是否下载
      const inquirer = await import('inquirer');
      const { download } = await inquirer.default.prompt([
        {
          type: 'confirm',
          name: 'download',
          message: '是否开始下载?',
          default: false,
        },
      ]);

      if (download) {
        await downloadSelected(mediaList);
      }
    }

    await disconnect();
  });

// 下载命令
program
  .command('download [target]')
  .alias('dl')
  .description('下载媒体文件')
  .option('-m, --message-id <id>', '指定消息ID')
  .option('-n, --name <filename>', '自定义文件名')
  .option('-a, --all', '下载所有扫描到的文件')
  .action(async (target, options) => {
    if (options.all) {
      await downloadSelected();
    } else if (options.messageId) {
      await downloadSingle(target, parseInt(options.messageId), options.name);
    } else {
      await downloadSingle(target, undefined, options.name);
    }
    await disconnect();
  });

// 下载配置命令
program
  .command('download-config')
  .alias('dlc')
  .description('配置下载选项')
  .action(async () => {
    await configureDownload();
  });

// 下载状态命令
program
  .command('download-status')
  .alias('dls')
  .description('查看下载状态')
  .action(() => {
    showDownloadStatus();
  });

// 交互模式
program
  .command('interactive')
  .alias('i')
  .description('进入交互模式')
  .action(async () => {
    await interactiveMode();
  });

/**
 * 交互模式
 */
async function interactiveMode(): Promise<void> {
  const inquirer = await import('inquirer');

  console.log(chalk.cyan('\n=== Telegram 内容聚合工具 ===\n'));
  console.log(chalk.gray('输入 exit 退出\n'));

  let running = true;

  while (running) {
    const { action } = await inquirer.default.prompt([
      {
        type: 'list',
        name: 'action',
        message: '请选择操作:',
        choices: [
          { name: '🔑 登录/查看状态', value: 'login' },
          { name: '📋 列出频道', value: 'list' },
          { name: '🔍 扫描频道内容', value: 'scan' },
          { name: '⬇️  下载文件', value: 'download' },
          { name: '⚙️  配置下载选项', value: 'config' },
          { name: '📊 查看下载状态', value: 'status' },
          { name: '❌ 退出', value: 'exit' },
        ],
      },
    ]);

    switch (action) {
      case 'login':
        await showStatus();
        const { needLogin } = await inquirer.default.prompt([
          {
            type: 'confirm',
            name: 'needLogin',
            message: '是否需要重新登录?',
            default: false,
          },
        ]);
        if (needLogin) {
          await login();
        }
        break;

      case 'list':
        await listChannels();
        break;

      case 'scan':
        const mediaList = await aggregate();
        if (mediaList.length > 0) {
          setCachedMediaList(mediaList);
        }
        break;

      case 'download':
        await downloadSelected();
        break;

      case 'config':
        await configureDownload();
        break;

      case 'status':
        showDownloadStatus();
        break;

      case 'exit':
        running = false;
        break;
    }

    console.log('');
  }

  await disconnect();
  console.log(chalk.green('再见!'));
}

// 帮助信息美化
program.addHelpText(
  'after',
  `
${chalk.cyan('示例:')}
  $ tg-agg config                    # 配置 API 凭据
  $ tg-agg login                     # 登录 Telegram
  $ tg-agg list                      # 列出已加入的频道
  $ tg-agg scan @channel_name        # 扫描指定频道
  $ tg-agg scan -l 1000              # 扫描最近 1000 条消息
  $ tg-agg download -a               # 下载所有扫描到的文件
  $ tg-agg download -n "my_file"     # 使用自定义文件名下载
  $ tg-agg i                         # 进入交互模式

${chalk.cyan('获取 API 凭据:')}
  1. 访问 https://my.telegram.org/apps
  2. 登录您的 Telegram 账号
  3. 创建应用获取 API ID 和 API Hash
`
);

// 错误处理
process.on('uncaughtException', (error) => {
  console.error(chalk.red(`错误: ${error.message}`));
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error(chalk.red(`未处理的Promise拒绝: ${reason}`));
  process.exit(1);
});

// 优雅退出
process.on('SIGINT', async () => {
  console.log(chalk.yellow('\n正在退出...'));
  await disconnect();
  process.exit(0);
});

// 解析命令行
program.parse(process.argv);

// 如果没有参数，显示帮助
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
