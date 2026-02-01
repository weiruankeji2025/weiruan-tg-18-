/**
 * 登录命令
 */

import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { initClient, connectWithSession, getCurrentUser, disconnect } from '../core/client';
import {
  getTelegramConfig,
  saveTelegramConfig,
  isConfigured,
  isLoggedIn,
  clearSession,
} from '../utils/config';

/**
 * 配置API凭据
 */
export async function configureCredentials(): Promise<void> {
  console.log(chalk.cyan('\n=== Telegram API 配置 ===\n'));
  console.log(chalk.gray('请先在 https://my.telegram.org/apps 创建应用获取 API ID 和 API Hash\n'));

  const answers = await inquirer.prompt([
    {
      type: 'number',
      name: 'apiId',
      message: '请输入 API ID:',
      validate: (input) => {
        if (!input || isNaN(input)) {
          return '请输入有效的 API ID (数字)';
        }
        return true;
      },
    },
    {
      type: 'input',
      name: 'apiHash',
      message: '请输入 API Hash:',
      validate: (input) => {
        if (!input || input.length < 10) {
          return '请输入有效的 API Hash';
        }
        return true;
      },
    },
  ]);

  saveTelegramConfig({
    apiId: answers.apiId,
    apiHash: answers.apiHash,
  });

  console.log(chalk.green('\n✓ API 凭据已保存\n'));
}

/**
 * 执行登录
 */
export async function login(): Promise<boolean> {
  // 检查是否已配置
  if (!isConfigured()) {
    console.log(chalk.yellow('尚未配置 API 凭据'));
    await configureCredentials();
  }

  const config = getTelegramConfig();
  if (!config) {
    console.log(chalk.red('配置加载失败'));
    return false;
  }

  // 尝试使用现有会话连接
  if (isLoggedIn()) {
    const spinner = ora('正在连接...').start();

    const client = await connectWithSession(config);
    if (client) {
      const user = await getCurrentUser();
      spinner.succeed(chalk.green(`已登录: ${user?.firstName || user?.username || 'User'}`));
      return true;
    }

    spinner.fail('会话已过期，需要重新登录');
  }

  // 执行新登录
  console.log(chalk.cyan('\n=== Telegram 登录 ===\n'));

  try {
    const spinner = ora('正在登录...').start();
    spinner.stop(); // 暂停spinner以便输入

    await initClient(config);

    const user = await getCurrentUser();
    console.log(chalk.green(`\n✓ 登录成功: ${user?.firstName || user?.username || 'User'}\n`));
    return true;
  } catch (error: any) {
    console.error(chalk.red(`\n登录失败: ${error.message}\n`));
    return false;
  }
}

/**
 * 登出
 */
export async function logout(): Promise<void> {
  const spinner = ora('正在登出...').start();

  try {
    await disconnect();
    clearSession();
    spinner.succeed('已登出');
  } catch (error: any) {
    spinner.fail(`登出失败: ${error.message}`);
  }
}

/**
 * 显示当前登录状态
 */
export async function showStatus(): Promise<void> {
  console.log(chalk.cyan('\n=== 登录状态 ===\n'));

  if (!isConfigured()) {
    console.log(chalk.yellow('状态: 未配置'));
    console.log(chalk.gray('请运行 tg-agg config 配置 API 凭据'));
    return;
  }

  if (!isLoggedIn()) {
    console.log(chalk.yellow('状态: 未登录'));
    console.log(chalk.gray('请运行 tg-agg login 进行登录'));
    return;
  }

  const config = getTelegramConfig();
  if (!config) return;

  const spinner = ora('正在验证会话...').start();
  const client = await connectWithSession(config);

  if (client) {
    const user = await getCurrentUser();
    spinner.succeed('会话有效');
    console.log(chalk.green(`\n当前用户: ${user?.firstName || ''} ${user?.lastName || ''}`));
    console.log(chalk.gray(`用户名: @${user?.username || 'N/A'}`));
    console.log(chalk.gray(`用户ID: ${user?.id}`));
  } else {
    spinner.fail('会话已过期');
    console.log(chalk.yellow('\n请运行 tg-agg login 重新登录'));
  }
}
