import * as fs from 'fs/promises';
import * as path from 'path';

const TMP_SUFFIX_RADIX = 16;
const TMP_SUFFIX_LENGTH = 10;
const ATOMIC_MODE_DEFAULT = 0o600;
const TMP_OPEN_MAX_ATTEMPTS = 8;

const IGNORABLE_FSYNC_ERRORS = new Set([
  'ENOTSUP',
  'EOPNOTSUPP',
  'EINVAL',
  'EPERM',
  'EBADF',
  'EISDIR',
]);

function shouldIgnoreFsyncError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return false;
  }
  const code = String((error as { code?: unknown }).code ?? '');
  return IGNORABLE_FSYNC_ERRORS.has(code);
}

function isFileAlreadyExistsError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return false;
  }
  const code = String((error as { code?: unknown }).code ?? '');
  return code === 'EEXIST';
}

function buildTmpPath(targetPath: string): string {
  const tmpSuffix = `${process.pid}.${Date.now()}.${Math.random()
    .toString(TMP_SUFFIX_RADIX)
    .slice(2, 2 + TMP_SUFFIX_LENGTH)}`;
  return `${targetPath}.tmp.${tmpSuffix}`;
}

async function openUniqueTmpFile(
  targetPath: string,
  mode: number
): Promise<{ tmpPath: string; fileHandle: fs.FileHandle }> {
  let attempts = 0;
  while (attempts < TMP_OPEN_MAX_ATTEMPTS) {
    attempts += 1;
    const tmpPath = buildTmpPath(targetPath);
    try {
      const fileHandle = await fs.open(tmpPath, 'wx', mode);
      return { tmpPath, fileHandle };
    } catch (error) {
      if (isFileAlreadyExistsError(error)) {
        continue;
      }
      throw error;
    }
  }
  throw new Error(
    `Failed to allocate temporary file for atomic write after ${TMP_OPEN_MAX_ATTEMPTS} attempts`
  );
}

async function safeFsyncFile(fileHandle: fs.FileHandle): Promise<void> {
  try {
    await fileHandle.sync();
  } catch (error) {
    if (!shouldIgnoreFsyncError(error)) {
      throw error;
    }
  }
}

async function safeFsyncDirectory(directoryPath: string): Promise<void> {
  let dirHandle: fs.FileHandle | null = null;
  try {
    dirHandle = await fs.open(directoryPath, 'r');
    await safeFsyncFile(dirHandle);
  } catch (error) {
    if (!shouldIgnoreFsyncError(error)) {
      throw error;
    }
  } finally {
    if (dirHandle) {
      await dirHandle.close().catch(() => {});
    }
  }
}

export interface WriteFileAtomicOptions {
  mode?: number;
}

export async function writeFileAtomic(
  targetPath: string,
  payload: string | Uint8Array,
  options: WriteFileAtomicOptions = {}
): Promise<void> {
  const mode = options.mode ?? ATOMIC_MODE_DEFAULT;
  const directoryPath = path.dirname(targetPath);

  await fs.mkdir(directoryPath, { recursive: true });

  let fileHandle: fs.FileHandle | null = null;
  let tmpPath: string | null = null;
  let renamed = false;

  try {
    const tmpFile = await openUniqueTmpFile(targetPath, mode);
    tmpPath = tmpFile.tmpPath;
    fileHandle = tmpFile.fileHandle;
    await fileHandle.writeFile(payload);
    await safeFsyncFile(fileHandle);
    await fileHandle.close().catch(() => {});
    fileHandle = null;

    if (!tmpPath) {
      throw new Error('Atomic write temporary path was not initialized');
    }
    await fs.rename(tmpPath, targetPath);
    renamed = true;
    await safeFsyncDirectory(directoryPath);
  } finally {
    if (fileHandle) {
      await fileHandle.close().catch(() => {});
    }
    if (!renamed && tmpPath) {
      await fs.unlink(tmpPath).catch(() => {});
    }
  }
}
