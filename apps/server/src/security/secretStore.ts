import { execFile, spawn } from 'node:child_process';
import { APP_NAME } from '../config.ts';

export type SecretAccount = 'anthropic' | 'youtube';
export const SECRET_ACCOUNTS: readonly SecretAccount[] = ['anthropic', 'youtube'];

/** 비밀값 저장소 어댑터. 키 원문은 이 인터페이스 밖으로 로그·응답에 나가지 않는다. */
export interface SecretStore {
  readonly kind: 'keychain' | 'memory';
  get(account: SecretAccount): Promise<string | null>;
  has(account: SecretAccount): Promise<boolean>;
  set(account: SecretAccount, secret: string): Promise<void>;
  remove(account: SecretAccount): Promise<void>;
}

export class MemorySecretStore implements SecretStore {
  readonly kind = 'memory' as const;
  private readonly values = new Map<SecretAccount, string>();
  constructor(initial: Partial<Record<SecretAccount, string>> = {}) {
    for (const [k, v] of Object.entries(initial)) if (v) this.values.set(k as SecretAccount, v);
  }
  async get(account: SecretAccount) {
    return this.values.get(account) ?? null;
  }
  async has(account: SecretAccount) {
    return this.values.has(account);
  }
  async set(account: SecretAccount, secret: string) {
    this.values.set(account, secret);
  }
  async remove(account: SecretAccount) {
    this.values.delete(account);
  }
}

const SECURITY_BIN = '/usr/bin/security';

function runSecurity(args: readonly string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    execFile(SECURITY_BIN, [...args], { timeout: 10_000, maxBuffer: 64 * 1024 }, (error, stdout) => {
      const code = error ? (typeof (error as NodeJS.ErrnoException & { code?: unknown }).code === 'number' ? Number((error as { code: number }).code) : 1) : 0;
      resolve({ code, stdout: String(stdout ?? '') });
    });
  });
}

/** `security -i`의 명령줄 인용 규칙에 맞게 큰따옴표 문자열로 감싼다. */
function quoteForSecurityShell(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * macOS Keychain 구현 (서비스명 context-marketing-agent).
 * 저장 시 비밀값을 argv에 노출하지 않기 위해 `security -i`의 stdin으로 명령을 전달한다.
 */
export class KeychainSecretStore implements SecretStore {
  readonly kind = 'keychain' as const;
  private readonly service: string;
  constructor(service: string = APP_NAME) {
    this.service = service;
  }

  async get(account: SecretAccount): Promise<string | null> {
    const { code, stdout } = await runSecurity(['find-generic-password', '-s', this.service, '-a', account, '-w']);
    if (code !== 0) return null;
    const value = stdout.replace(/\r?\n$/, '');
    return value.length > 0 ? value : null;
  }

  async has(account: SecretAccount): Promise<boolean> {
    const { code } = await runSecurity(['find-generic-password', '-s', this.service, '-a', account]);
    return code === 0;
  }

  async set(account: SecretAccount, secret: string): Promise<void> {
    if (/[\r\n]/.test(secret)) throw new Error('비밀값에 줄바꿈을 포함할 수 없습니다.');
    const command = `add-generic-password -U -s ${quoteForSecurityShell(this.service)} -a ${quoteForSecurityShell(account)} -w ${quoteForSecurityShell(secret)}\n`;
    await new Promise<void>((resolve, reject) => {
      const child = spawn(SECURITY_BIN, ['-i'], { stdio: ['pipe', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', (d: Buffer) => {
        stderr += d.toString();
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0 && !stderr.trim()) resolve();
        else reject(new Error('Keychain 저장에 실패했습니다.'));
      });
      child.stdin.end(command);
    });
    if (!(await this.has(account))) throw new Error('Keychain 저장 확인에 실패했습니다.');
  }

  async remove(account: SecretAccount): Promise<void> {
    await runSecurity(['delete-generic-password', '-s', this.service, '-a', account]);
  }
}

export function createDefaultSecretStore(platform: NodeJS.Platform = process.platform): SecretStore {
  return platform === 'darwin' ? new KeychainSecretStore() : new MemorySecretStore();
}
