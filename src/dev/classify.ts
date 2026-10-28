/** What kind of file is this, before anything reads it. */

const SECRET_NAMES = [
  /^\.env$/i, /^\.env\..+/i, /^credentials(\..+)?$/i, /^secrets?(\..+)?$/i, /\.pem$/i, /\.key$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i, /\.p12$/i, /\.pfx$/i, /\.keystore$/i, /^\.npmrc$/i,
  /^\.pypirc$/i, /^\.netrc$/i, /^\.git-credentials$/i, /^service[-_]?account.*\.json$/i,
];

/** Examples that document the shape of a secret without holding one. */
const SECRET_EXAMPLES = /^\.env\.(example|sample|template|dist)$/i;

export function isSecretFile(name: string): boolean {
  if (SECRET_EXAMPLES.test(name)) return false;
  return SECRET_NAMES.some((re) => re.test(name));
}

const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.tif', '.tiff', '.psd', '.blend',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.obj', '.o', '.a', '.lib', '.pdb', '.class', '.jar', '.pyc', '.wasm', '.node',
  '.zip', '.7z', '.rar', '.gz', '.tgz', '.bz2', '.xz', '.tar', '.iso', '.msi', '.pak', '.pbo',
  '.db', '.sqlite', '.sqlite3', '.mdb', '.accdb',
  '.pdf', '.docx', '.xlsx', '.pptx', '.mp3', '.mp4', '.wav', '.ogg', '.mov', '.avi', '.mkv', '.flac',
  '.ttf', '.otf', '.woff', '.woff2', '.eot', '.dds', '.fbx', '.glb',
]);

export function isBinaryExtension(ext: string): boolean {
  return BINARY_EXT.has(ext.toLowerCase());
}

/** A NUL byte in the first 8 KB is the classic, reliable binary signal. */
export function looksBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8192);
  let odd = 0;
  for (let i = 0; i < n; i++) {
    const b = bytes[i]!;
    if (b === 0) return true;
    if (b < 7 || (b > 13 && b < 32 && b !== 27)) odd++;
  }
  return n > 0 && odd / n > 0.3;
}

const LANGS: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript', '.mts': 'typescript', '.cts': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.json': 'json', '.md': 'markdown', '.css': 'css', '.scss': 'scss', '.html': 'html',
  '.py': 'python', '.rs': 'rust', '.go': 'go', '.cs': 'csharp', '.java': 'java', '.kt': 'kotlin',
  '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.hpp': 'cpp', '.cc': 'cpp', '.toml': 'toml', '.yaml': 'yaml',
  '.yml': 'yaml', '.xml': 'xml', '.sh': 'shell', '.ps1': 'powershell', '.sql': 'sql', '.lua': 'lua',
  '.c#': 'csharp', '.enfusion': 'enfusion', '.et': 'enfusion', '.conf': 'ini', '.ini': 'ini',
};

export const languageOf = (ext: string): string | null => LANGS[ext.toLowerCase()] ?? null;

/** Directories never indexed or searched: generated, vendored or VCS internals. */
export const DEFAULT_IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.cache', '.next', '.nuxt', '.turbo', '.parcel-cache',
  'coverage', 'target', 'bin', 'obj', '__pycache__', '.venv', 'venv', '.mypy_cache', '.pytest_cache',
  '.gradle', '.idea', '.vs', 'temp', 'tmp', 'vendor', 'release', 'dist-electron', '.svelte-kit',
]);

export const LARGE_FILE_BYTES = 1024 * 1024;
