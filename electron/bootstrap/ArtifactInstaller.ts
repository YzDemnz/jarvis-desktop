import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import type { TrustedArtifact, RuntimeCatalog } from './contracts';
export async function sha256(file: string, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    const h = createHash('sha256');
    const stream = fs.createReadStream(file, { highWaterMark: 4 * 1024 * 1024, signal });
    for await (const bytes of stream) {
        signal.throwIfAborted();
        h.update(bytes);
    }
    return h.digest('hex');
}
export function contained(root: string, relative: string): string {
    if (!path.isAbsolute(root) || !relative || path.isAbsolute(relative))
        throw Error('INSTALL_PATH_DENIED');
    const file = path.resolve(root, relative), rel = path.relative(root, file);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel))
        throw Error('INSTALL_PATH_DENIED');
    // Reject junction/symlink ancestors, including a compromised cache/root.
    let cursor = file;
    while (true) {
        if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink())
            throw Error('INSTALL_SYMLINK_DENIED');
        const parent = path.dirname(cursor);
        if (parent === cursor)
            break;
        cursor = parent;
    }
    return file;
}
function trustedURL(raw: string): boolean {
    const u = new URL(raw);
    return u.protocol === 'https:' && !u.username && !u.password &&
        ['github.com', 'release-assets.githubusercontent.com', 'huggingface.co', 'cdn-lfs.huggingface.co', 'cdn-lfs-us-1.huggingface.co', 'cas-bridge.xethub.hf.co', 'us.aws.cdn.hf.co', 'registry.ollama.ai'].includes(u.hostname);
}
export class ArtifactInstaller {
    constructor(readonly root: string, private readonly provision: string[] = []) { if (!path.isAbsolute(root))
        throw Error('INSTALL_ROOT_MUST_BE_ABSOLUTE'); }
    async obtain(a: TrustedArtifact, signal: AbortSignal, progress: (received: number) => void): Promise<string> {
        if (!/^[a-f0-9]{64}$/.test(a.sha256) || path.basename(a.filename) !== a.filename || !trustedURL(a.url))
            throw Error('CATALOG_ARTIFACT_DENIED');
        const cache = contained(this.root, 'cache');
        fs.mkdirSync(cache, { recursive: true });
        const final = contained(cache, a.sha256 + '-' + a.filename), partial = final + '.partial';
        const valid = async (file: string) => fs.existsSync(file) && fs.statSync(file).size === a.size && await sha256(file, signal) === a.sha256;
        if (await valid(final))
            return final;
        if (fs.existsSync(final))
            fs.renameSync(final, final + '.invalid-' + Date.now());
        for (const source of this.provision) {
            if (await valid(source)) {
                // Copy via streams; no uninterruptible multi-GB copy and no symlinks.
                const { pipeline } = await import('node:stream/promises');
                const input = fs.createReadStream(source, { highWaterMark: 4 * 1024 ** 2 });
                let copied = 0;
                input.on('data', chunk => { copied += chunk.length; progress(copied); });
                await pipeline(input, fs.createWriteStream(partial, { highWaterMark: 4 * 1024 ** 2 }), { signal });
                if (!await valid(partial))
                    throw Error('PROVISION_HASH_MISMATCH');
                signal.throwIfAborted();
                fs.renameSync(partial, final);
                progress(a.size);
                return final;
            }
        }
        let offset = fs.existsSync(partial) ? fs.statSync(partial).size : 0;
        if (offset > a.size) {
            fs.renameSync(partial, partial + '.invalid-' + Date.now());
            offset = 0;
        }
        if (offset === a.size) {
            if (await valid(partial)) {
                fs.renameSync(partial, final);
                return final;
            }
            fs.renameSync(partial, partial + '.invalid-' + Date.now());
            offset = 0;
        }
        const abort = new AbortController(), relay = () => abort.abort();
        signal.addEventListener('abort', relay, { once: true });
        if (signal.aborted)
            relay();
        let timer = setTimeout(relay, 60000);
        const touch = () => { clearTimeout(timer); timer = setTimeout(relay, 60000); };
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        try {
            let url = a.url, response!: Response;
            for (let redirect = 0; redirect < 6; redirect++) {
                if (!trustedURL(url))
                    throw Error('DOWNLOAD_REDIRECT_DENIED');
                response = await fetch(url, { signal: abort.signal, redirect: 'manual', headers: offset ? { Range: `bytes=${offset}-` } : {} });
                if (![301, 302, 303, 307, 308].includes(response.status))
                    break;
                const next = response.headers.get('location');
                await response.body?.cancel();
                if (!next)
                    throw Error('DOWNLOAD_REDIRECT_MISSING');
                url = new URL(next, url).href;
            }
            if (response.status !== 200 && response.status !== 206)
                throw Error('DOWNLOAD_HTTP_' + response.status);
            if (response.status === 206 && response.headers.get('content-range') !== `bytes ${offset}-${a.size - 1}/${a.size}`)
                throw Error('DOWNLOAD_RANGE_DENIED');
            if (response.status === 200)
                offset = 0;
            const output = fs.createWriteStream(partial, { flags: offset ? 'a' : 'w', highWaterMark: 4 * 1024 ** 2, signal: abort.signal });
            const failed: {
                error?: Error;
            } = {};
            output.on('error', e => { failed.error = e; relay(); });
            reader = response.body!.getReader();
            let received = offset;
            try {
                while (true) {
                    signal.throwIfAborted();
                    const item = await reader.read();
                    if (item.done)
                        break;
                    touch();
                    received += item.value.length;
                    if (received > a.size)
                        throw Error('DOWNLOAD_SIZE_EXCEEDED');
                    if (failed.error)
                        throw failed.error;
                    if (!output.write(item.value))
                        await new Promise<void>((resolve, reject) => { const done = () => { output.off('error', reject); resolve(); }; output.once('drain', done); output.once('error', reject); });
                    progress(received);
                }
                clearTimeout(timer);
                await new Promise<void>((resolve, reject) => { output.once('error', reject); output.end(resolve); });
                if (failed.error)
                    throw failed.error;
            }
            finally {
                output.destroy();
            }
            if (!await valid(partial)) {
                fs.renameSync(partial, partial + '.invalid-' + Date.now());
                throw Error('ARTIFACT_INTEGRITY_MISMATCH');
            }
            signal.throwIfAborted();
            fs.renameSync(partial, final);
            return final;
        }
        finally {
            clearTimeout(timer);
            signal.removeEventListener('abort', relay);
            await reader?.cancel().catch(() => { });
        }
    }
    async runtime(catalog: RuntimeCatalog, archive: string, signal: AbortSignal): Promise<string> {
        const bin = contained(this.root, 'runtimes/' + catalog.id);
        fs.mkdirSync(bin, { recursive: true });
        const healthy = async () => { for (const a of catalog.assets)
            if (!fs.existsSync(contained(bin, a.file)) || await sha256(contained(bin, a.file), signal) !== a.sha256)
                return false; return true; };
        if (await healthy())
            return bin;
        if (await sha256(archive, signal) !== catalog.artifact.sha256)
            throw Error('RUNTIME_ARCHIVE_CHANGED');
        // Closed, small official ZIP. Parse the central directory; no ZIP64,
        // encrypted entries, paths, links, executable surprises or guessed assets.
        const bytes = fs.readFileSync(archive);
        let end = bytes.length - 22;
        while (end >= Math.max(0, bytes.length - 65557) && bytes.readUInt32LE(end) !== 0x06054b50)
            end--;
        if (end < 0 || bytes.readUInt32LE(end) !== 0x06054b50 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6))
            throw Error('ZIP_DIRECTORY_DENIED');
        const count = bytes.readUInt16LE(end + 10);
        let cursor = bytes.readUInt32LE(end + 16);
        if (count > 100 || bytes.length > 64 * 1024 ** 2)
            throw Error('ZIP_TOO_LARGE');
        const extracted = new Set<string>();
        for (let n = 0; n < count; n++) {
            signal.throwIfAborted();
            if (bytes.readUInt32LE(cursor) !== 0x02014b50)
                throw Error('ZIP_ENTRY_DENIED');
            const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10), compressed = bytes.readUInt32LE(cursor + 20), size = bytes.readUInt32LE(cursor + 24);
            const nameLength = bytes.readUInt16LE(cursor + 28), extra = bytes.readUInt16LE(cursor + 30), comment = bytes.readUInt16LE(cursor + 32), local = bytes.readUInt32LE(cursor + 42);
            const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
            cursor += 46 + nameLength + extra + comment;
            const entry = catalog.assets.find(a => a.file === name);
            if (!entry || flags & 1 || ![0, 8].includes(method) || size > 256 * 1024 ** 2 || extracted.has(name) || bytes.readUInt32LE(local) !== 0x04034b50)
                throw Error('ZIP_ASSET_DENIED');
            const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
            const body = bytes.subarray(start, start + compressed);
            const data = method === 8 ? inflateRawSync(body, { maxOutputLength: size }) : body;
            if (data.length !== size || createHash('sha256').update(data).digest('hex') !== entry.sha256)
                throw Error('ZIP_ASSET_HASH_MISMATCH');
            const target = contained(bin, name);
            fs.writeFileSync(target + '.partial', data);
            signal.throwIfAborted();
            fs.renameSync(target + '.partial', target);
            extracted.add(name);
        }
        if (!await healthy())
            throw Error('RUNTIME_ASSET_MISSING');
        return bin;
    }
}
