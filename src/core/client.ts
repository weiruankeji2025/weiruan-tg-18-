/**
 * Telegram客户端管理模块
 */

import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { NewMessage } from 'telegram/events';
import { Api } from 'telegram/tl';
import * as readline from 'readline';
import { TelegramConfig } from '../types';
import { saveSession, loadSession, saveTelegramConfig } from '../utils/config';

let clientInstance: TelegramClient | null = null;

/**
 * 创建readline接口用于输入
 */
function createReadlineInterface(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

/**
 * 获取用户输入
 */
async function prompt(question: string): Promise<string> {
  const rl = createReadlineInterface();
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * 初始化并连接Telegram客户端
 */
export async function initClient(config: TelegramConfig): Promise<TelegramClient> {
  const sessionString = config.sessionString || loadSession() || '';
  const stringSession = new StringSession(sessionString);

  const client = new TelegramClient(stringSession, config.apiId, config.apiHash, {
    connectionRetries: 5,
    retryDelay: 1000,
    autoReconnect: true,
    useWSS: false,
  });

  await client.start({
    phoneNumber: async () => {
      if (config.phoneNumber) return config.phoneNumber;
      return await prompt('请输入手机号 (格式: +86xxxxxxxxxx): ');
    },
    password: async () => {
      return await prompt('请输入两步验证密码 (如果没有设置请直接回车): ');
    },
    phoneCode: async () => {
      return await prompt('请输入收到的验证码: ');
    },
    onError: (err) => {
      console.error('登录错误:', err.message);
      throw err;
    },
  });

  // 保存会话
  const newSessionString = client.session.save() as unknown as string;
  saveSession(newSessionString);

  // 保存配置（不包含敏感信息）
  saveTelegramConfig({
    apiId: config.apiId,
    apiHash: config.apiHash,
  });

  clientInstance = client;
  return client;
}

/**
 * 获取当前客户端实例
 */
export function getClient(): TelegramClient | null {
  return clientInstance;
}

/**
 * 使用已保存的会话快速连接
 */
export async function connectWithSession(config: TelegramConfig): Promise<TelegramClient | null> {
  const sessionString = loadSession();
  if (!sessionString) {
    return null;
  }

  try {
    const stringSession = new StringSession(sessionString);
    const client = new TelegramClient(stringSession, config.apiId, config.apiHash, {
      connectionRetries: 5,
      retryDelay: 1000,
      autoReconnect: true,
    });

    await client.connect();

    // 验证会话是否有效
    const me = await client.getMe();
    if (!me) {
      return null;
    }

    clientInstance = client;
    return client;
  } catch (error) {
    console.error('会话连接失败:', error);
    return null;
  }
}

/**
 * 断开连接
 */
export async function disconnect(): Promise<void> {
  if (clientInstance) {
    await clientInstance.disconnect();
    clientInstance = null;
  }
}

/**
 * 获取当前用户信息
 */
export async function getCurrentUser(): Promise<Api.User | null> {
  if (!clientInstance) return null;
  try {
    return await clientInstance.getMe() as Api.User;
  } catch (error) {
    console.error('获取用户信息失败:', error);
    return null;
  }
}

/**
 * 获取所有对话列表
 */
export async function getDialogs(limit: number = 100): Promise<Api.Dialog[]> {
  if (!clientInstance) return [];
  try {
    const dialogs = await clientInstance.getDialogs({ limit });
    return dialogs as unknown as Api.Dialog[];
  } catch (error) {
    console.error('获取对话列表失败:', error);
    return [];
  }
}

/**
 * 通过用户名或链接获取实体
 */
export async function getEntity(identifier: string): Promise<Api.TypeInputPeer | null> {
  if (!clientInstance) return null;
  try {
    return await clientInstance.getInputEntity(identifier);
  } catch (error) {
    console.error('获取实体失败:', error);
    return null;
  }
}

/**
 * 搜索公开频道/群组
 */
export async function searchPublicChats(query: string): Promise<any[]> {
  if (!clientInstance) return [];
  try {
    const result = await clientInstance.invoke(
      new Api.contacts.Search({
        q: query,
        limit: 50,
      })
    );
    return (result as any).chats || [];
  } catch (error) {
    console.error('搜索失败:', error);
    return [];
  }
}

/**
 * 加入频道/群组
 */
export async function joinChat(identifier: string): Promise<boolean> {
  if (!clientInstance) return false;
  try {
    const entity = await getEntity(identifier);
    if (!entity) return false;

    await clientInstance.invoke(
      new Api.channels.JoinChannel({
        channel: entity as Api.TypeInputChannel,
      })
    );
    return true;
  } catch (error) {
    console.error('加入频道失败:', error);
    return false;
  }
}

/**
 * 检查客户端是否已连接
 */
export function isConnected(): boolean {
  return clientInstance?.connected || false;
}

/**
 * 添加新消息事件监听
 */
export function onNewMessage(callback: (event: NewMessage.Event) => void): void {
  if (!clientInstance) return;
  clientInstance.addEventHandler(callback, new NewMessage({}));
}
