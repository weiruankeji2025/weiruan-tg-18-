/**
 * 配置管理
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TelegramConfig, DownloadConfig } from '../types';

const CONFIG_DIR = path.join(os.homedir(), '.tg-aggregator');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const SESSION_FILE = path.join(CONFIG_DIR, 'session.txt');

interface AppConfig {
  telegram: TelegramConfig;
  download: DownloadConfig;
}

const DEFAULT_DOWNLOAD_CONFIG: DownloadConfig = {
  outputDir: path.join(os.homedir(), 'TG-Downloads'),
  concurrentDownloads: 3,
  chunkSize: 512 * 1024,  // 512KB
  maxRetries: 3,
  retryDelay: 2000,
  resumeEnabled: true,
  fileNameTemplate: '{chatTitle}_{date}_{id}.{extension}',
  createSubfolders: true,
  skipExisting: true,
};

/**
 * 确保配置目录存在
 */
function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

/**
 * 加载配置
 */
export function loadConfig(): AppConfig | null {
  try {
    ensureConfigDir();
    if (fs.existsSync(CONFIG_FILE)) {
      const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
      return JSON.parse(content);
    }
  } catch (error) {
    console.error('加载配置失败:', error);
  }
  return null;
}

/**
 * 保存配置
 */
export function saveConfig(config: AppConfig): void {
  try {
    ensureConfigDir();
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (error) {
    console.error('保存配置失败:', error);
    throw error;
  }
}

/**
 * 获取Telegram配置
 */
export function getTelegramConfig(): TelegramConfig | null {
  const config = loadConfig();
  return config?.telegram || null;
}

/**
 * 保存Telegram配置
 */
export function saveTelegramConfig(telegramConfig: TelegramConfig): void {
  const config = loadConfig() || {
    telegram: telegramConfig,
    download: DEFAULT_DOWNLOAD_CONFIG,
  };
  config.telegram = telegramConfig;
  saveConfig(config);
}

/**
 * 获取下载配置
 */
export function getDownloadConfig(): DownloadConfig {
  const config = loadConfig();
  return config?.download || DEFAULT_DOWNLOAD_CONFIG;
}

/**
 * 保存下载配置
 */
export function saveDownloadConfig(downloadConfig: DownloadConfig): void {
  const config = loadConfig() || {
    telegram: { apiId: 0, apiHash: '' },
    download: downloadConfig,
  };
  config.download = downloadConfig;
  saveConfig(config);
}

/**
 * 保存会话字符串
 */
export function saveSession(sessionString: string): void {
  ensureConfigDir();
  fs.writeFileSync(SESSION_FILE, sessionString);
}

/**
 * 加载会话字符串
 */
export function loadSession(): string | null {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      return fs.readFileSync(SESSION_FILE, 'utf-8').trim();
    }
  } catch (error) {
    console.error('加载会话失败:', error);
  }
  return null;
}

/**
 * 删除会话
 */
export function clearSession(): void {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      fs.unlinkSync(SESSION_FILE);
    }
  } catch (error) {
    console.error('删除会话失败:', error);
  }
}

/**
 * 检查是否已配置
 */
export function isConfigured(): boolean {
  const config = loadConfig();
  return !!(config?.telegram?.apiId && config?.telegram?.apiHash);
}

/**
 * 检查是否已登录
 */
export function isLoggedIn(): boolean {
  return !!loadSession();
}

/**
 * 获取配置目录路径
 */
export function getConfigDir(): string {
  return CONFIG_DIR;
}

/**
 * 获取默认下载配置
 */
export function getDefaultDownloadConfig(): DownloadConfig {
  return { ...DEFAULT_DOWNLOAD_CONFIG };
}

/**
 * 更新部分下载配置
 */
export function updateDownloadConfig(updates: Partial<DownloadConfig>): void {
  const current = getDownloadConfig();
  saveDownloadConfig({ ...current, ...updates });
}
