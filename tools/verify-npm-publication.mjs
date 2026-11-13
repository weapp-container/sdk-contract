import { createHash } from 'node:crypto';

export async function verifyNpmPublication(pkg, bytes, {
  fetchImpl = fetch,
  attempts = 60,
  wait = () => new Promise(resolve => setTimeout(resolve, 5000)),
} = {}) {
  const base = `https://registry.npmjs.org/${encodeURIComponent(pkg.name)}`;
  const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
  const pending = response => [404, 429].includes(response.status) || response.status >= 500;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const response = await fetchImpl(`${base}/${encodeURIComponent(pkg.version)}`, { signal: AbortSignal.timeout(30000) });
    if (!response.ok && !pending(response)) throw Error(`Cannot verify npm publication (${response.status}); do not republish`);
    if (response.ok) {
      const metadata = await response.json();
      if (metadata.name !== pkg.name || metadata.version !== pkg.version || metadata.dist?.integrity !== integrity) throw Error('Registry npm archive identity differs from the validated package; do not republish');
      const archive = await fetchImpl(metadata.dist.tarball, { signal: AbortSignal.timeout(120000) });
      if (!archive.ok && !pending(archive)) throw Error(`Cannot download published npm archive (${archive.status}); do not republish`);
      if (archive.ok) {
        if (!Buffer.from(await archive.arrayBuffer()).equals(bytes)) throw Error('Registry npm archive bytes differ from the validated package; do not republish');
        const tags = await fetchImpl(`https://registry.npmjs.org/-/package/${encodeURIComponent(pkg.name)}/dist-tags`, { signal: AbortSignal.timeout(30000) });
        if (!tags.ok && !pending(tags)) throw Error(`Cannot verify npm preview tag (${tags.status}); do not republish`);
        if (tags.ok && (await tags.json()).preview === pkg.version) return { integrity, tag: 'preview' };
      }
    }
    if (attempt + 1 < attempts) await wait();
  }
  throw Error('Published version or preview tag is still propagating; use --verify-published with the original receipt later; do not republish');
}
