import {
  MastraFilesystem,
  PermissionError,
  type FileContent,
  type FileEntry,
  type FileStat,
  type LocalFilesystem,
  type ReadOptions,
  type WriteOptions,
  type ListOptions,
  type RemoveOptions,
  type CopyOptions,
} from '@mastra/core/workspace';
import path from 'node:path';
import { createLogger } from '#utils/logger';

const log = createLogger('validating-filesystem');

// ════════════════════════════════════════════════════════════════════
//  Protected entries — mirrors PROTECTED_ENTRIES in path-security.ts.
//  LocalFilesystem provides containment (basePath allowlist) but no
//  denylist, so we add one here to block .git/.env/secrets uniformly.
// ════════════════════════════════════════════════════════════════════
const PROTECTED_ENTRIES = new Set([
  '.git',
  '.env',
  '.env.local',
  '.env.production',
  '.env.development',
  '.env.staging',
  '.env.test',
  '.ssh',
  'id_rsa',
  '.npmrc',
  '.pypirc',
]);

/**
 * Returns the protected entry name if the path touches one, else null.
 *
 * Checks both the top-level segment (catches `.git/foo`, `.ssh/x`) and the
 * basename at any depth (catches `subdir/.env`, `config/id_rsa`). Identical
 * to the blocklist logic in path-security.ts so custom tools and workspace
 * tools enforce the same protection surface.
 */
function findProtectedEntry(filePath: string): string | null {
  const segments = filePath.split(path.sep);
  const topSegment = segments[0];
  if (topSegment && PROTECTED_ENTRIES.has(topSegment)) {
    return topSegment;
  }
  const baseSegment = path.basename(filePath);
  if (PROTECTED_ENTRIES.has(baseSegment)) {
    return baseSegment;
  }
  return null;
}

/**
 * Wraps a LocalFilesystem and blocks access to protected entries
 * (.git, .env*, .ssh, credentials) before delegating to the inner fs.
 *
 * Containment (path-traversal / symlink-escape protection) is handled by
 * the inner LocalFilesystem's `contained: true` mode. This wrapper only
 * adds the denylist that containment does not provide.
 */
export class ValidatingFilesystem extends MastraFilesystem {
  readonly id: string;
  readonly name = 'ValidatingFilesystem';
  readonly provider: string;
  readonly readOnly?: boolean;
  status: import('@mastra/core/workspace').ProviderStatus;
  readonly basePath?: string;

  constructor(private readonly inner: LocalFilesystem) {
    super({ name: 'ValidatingFilesystem' });
    this.id = inner.id;
    this.provider = inner.provider;
    this.status = inner.status;
    this.readOnly = inner.readOnly;
    this.basePath = inner.basePath;
  }

  private assertNotProtected(filePath: string): void {
    const protectedName = findProtectedEntry(filePath);
    if (protectedName) {
      log.warn({ filePath, protectedName }, 'Access to protected entry blocked');
      throw new PermissionError(filePath, 'access');
    }
  }

  init(): Promise<void> {
    return this.inner.init();
  }

  destroy(): Promise<void> {
    return this.inner.destroy();
  }

  readFile(path: string, options?: ReadOptions): Promise<string | Buffer> {
    this.assertNotProtected(path);
    return this.inner.readFile(path, options);
  }

  writeFile(path: string, content: FileContent, options?: WriteOptions): Promise<void> {
    this.assertNotProtected(path);
    return this.inner.writeFile(path, content, options);
  }

  appendFile(path: string, content: FileContent): Promise<void> {
    this.assertNotProtected(path);
    return this.inner.appendFile(path, content);
  }

  deleteFile(path: string, options?: RemoveOptions): Promise<void> {
    this.assertNotProtected(path);
    return this.inner.deleteFile(path, options);
  }

  copyFile(src: string, dest: string, options?: CopyOptions): Promise<void> {
    this.assertNotProtected(src);
    this.assertNotProtected(dest);
    return this.inner.copyFile(src, dest, options);
  }

  moveFile(src: string, dest: string, options?: CopyOptions): Promise<void> {
    this.assertNotProtected(src);
    this.assertNotProtected(dest);
    return this.inner.moveFile(src, dest, options);
  }

  mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    this.assertNotProtected(path);
    return this.inner.mkdir(path, options);
  }

  rmdir(path: string, options?: RemoveOptions): Promise<void> {
    this.assertNotProtected(path);
    return this.inner.rmdir(path, options);
  }

  readdir(path: string, options?: ListOptions): Promise<FileEntry[]> {
    this.assertNotProtected(path);
    return this.inner.readdir(path, options);
  }

  exists(path: string): Promise<boolean> {
    this.assertNotProtected(path);
    return this.inner.exists(path);
  }

  stat(path: string): Promise<FileStat> {
    this.assertNotProtected(path);
    return this.inner.stat(path);
  }
}
