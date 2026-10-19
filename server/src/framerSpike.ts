// Phase 0 spike for the portfolio workflow. Read only: it never sets text, creates a branch, publishes or deploys.
// Run it yourself, on a duplicate of your Framer project if you like:
//
//   cd server && npx tsx src/framerSpike.ts https://framer.com/projects/<id> [site]
//
// The key comes from the Keychain (saved by Design Studio's Connect form for that site) or from the
// FRAMER_SPIKE_KEY variable for this one command. It is never printed. The report says which methods exist,
// whether case studies are pages or CMS items, which pages are drafts, the branches, and the unpublished changes.

import { readKey } from './framerKey.js';

const [project, site = 'richadesign.in'] = process.argv.slice(2);

async function main() {
  if (!project) throw new Error('Pass the Framer project link: npx tsx src/framerSpike.ts https://framer.com/projects/<id>');
  const key = process.env.FRAMER_SPIKE_KEY || (await readKey(site));
  if (!key) throw new Error(`No key for ${site}. Connect it in Design Studio first, or set FRAMER_SPIKE_KEY for this command.`);
  const api = await import('framer-api');
  const framer: any = await api.connect(project, key);
  const line = (k: string, v: unknown) => console.log(`${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  const safe = async <T>(name: string, fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch (e) {
      line(name, `not available (${e instanceof Error ? e.message : String(e)})`);
      return null;
    }
  };
  try {
    const methods = ['getNodesWithType', 'getNode', 'getUnpublishedPageChanges', 'getPublishInfo', 'getCollections', 'getActiveBranch', 'getBranches', 'createDesignPage', 'createWebPage', 'uploadImage'];
    line('Methods', Object.fromEntries(methods.map((m) => [m, typeof framer[m] === 'function'])));
    const pages = (await safe('Web pages', () => framer.getNodesWithType('WebPageNode'))) as any[] | null;
    if (pages) line('Web pages', pages.map((p) => ({ path: p.path, draft: !!p.draft, cms: p.collectionId ?? null })));
    const design = (await safe('Design pages', () => framer.getNodesWithType('DesignPageNode'))) as any[] | null;
    if (design) line('Design pages', design.length);
    const first = pages?.find((p) => p.path === '/helpdesk-dashboard') ?? pages?.find((p) => p.path && p.path !== '/');
    if (first) {
      const texts = (await safe('Text nodes', () => first.getNodesWithType('TextNode'))) as any[] | null;
      if (texts) {
        line(`Text nodes on ${first.path}`, texts.length);
        const sample = texts[0];
        if (sample) {
          line('getText on one node', typeof (await safe('getText', () => sample.getText())));
          line('getHTML on one node', typeof (await safe('getHTML', () => sample.getHTML())));
        }
      }
    }
    const cols = (await safe('CMS collections', () => framer.getCollections())) as any[] | null;
    if (cols) line('CMS collections', cols.map((c) => c.name));
    const branch: any = await safe('Active branch', () => framer.getActiveBranch());
    if (branch) line('Active branch', branch?.title ?? branch?.name ?? branch);
    const branches = (await safe('Branches', () => framer.getBranches())) as any[] | null;
    if (branches) line('Branches', branches.map((b) => b?.title ?? b?.name ?? b?.id));
    const info: any = await safe('Publish info', () => framer.getPublishInfo());
    if (info) line('Publish info', { production: info.production?.url ?? null, staging: info.staging?.url ?? null });
    const changes = (await safe('Unpublished changes', () => framer.getUnpublishedPageChanges())) as any[] | null;
    if (changes) line('Unpublished changes', changes.map((c) => `${c.status} ${c.path}`));
    console.log('Read only: nothing was changed, nothing was published.');
  } finally {
    await framer.disconnect?.().catch(() => {});
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
