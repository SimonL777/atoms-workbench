import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import { Agent, fetch } from 'undici';
import { config, HttpError } from './config.ts';

export function isPublicAddress(address: string) {
  try {
    return ipaddr.process(address).range() === 'unicast';
  } catch {
    return false;
  }
}
export function validateModelUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(400, '请填写有效的模型服务 Base URL。');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !['http:', 'https:'].includes(url.protocol) ||
    (!config.allowPrivateModels &&
      (url.protocol !== 'https:' ||
        host.toLowerCase() === 'localhost' ||
        host.endsWith('.localhost') ||
        (isIP(host) && !isPublicAddress(host))))
  )
    throw new HttpError(400, '模型地址需使用公网 HTTPS，且不能包含用户名、密码、查询参数或片段。');
  if (/\/chat\/completions\/?$/.test(url.pathname))
    throw new HttpError(
      400,
      '请填写 Base URL（例如 https://api.openai.com/v1），不要包含 /chat/completions。',
    );
  return url;
}
export async function modelRequest(
  baseUrl: string,
  apiKey: string,
  body: unknown,
  signal: AbortSignal,
) {
  const url = validateModelUrl(baseUrl);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  let addresses: { address: string; family: number }[];
  try {
    addresses = isIP(host)
      ? [{ address: host, family: isIP(host) }]
      : await lookup(host, { all: true });
  } catch {
    throw new Error('模型服务地址无法解析，请检查模型配置。');
  }
  if (
    !addresses.length ||
    (!config.allowPrivateModels && addresses.some((item) => !isPublicAddress(item.address)))
  )
    throw new Error('模型服务地址不能指向本机或内网。');
  // Pin the checked DNS results for this connection to prevent DNS rebinding.
  const dispatcher = new Agent({
    connect: {
      lookup: (_host, options, callback) => {
        const found = addresses.filter((item) => !options.family || item.family === options.family);
        if (!found.length) return callback(new Error('Model address unavailable'), '', 4);
        if (options.all) callback(null, found);
        else callback(null, found[0].address, found[0].family);
      },
    },
  });
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      dispatcher,
      redirect: 'error',
      signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`模型调用失败（HTTP ${response.status}），请检查你的模型配置。`);
    }
    try {
      return await response.json();
    } catch {
      throw new Error('模型没有返回有效的 JSON 回复，请检查服务兼容性。');
    }
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (error instanceof Error && /^(模型调用失败|模型没有返回)/.test(error.message)) throw error;
    throw new Error('模型服务连接失败，请检查模型地址和网络后重试。');
  } finally {
    await dispatcher.close();
  }
}
