// A narrow wrapper around the Framer Server API (framer-api). Design Studio reads pages and text, sets plain text
// on one node at a time and lists unpublished changes. It never publishes or deploys: those methods are not part of
// the wrapper, and the raw connection never leaves this file. Publishing is Richa's click in Framer.

import type { EditRecord, EditPlanItem } from '../../shared/portfolio.js';

export type FramerPage = { id: string; path: string; draft: boolean };
export type FramerText = { id: string; page: string; text: string; mixed: boolean };
export type FramerChange = { path: string; status: string };

/** Everything Design Studio can do on a Framer project. */
export type FramerSite = {
  pages(): Promise<FramerPage[]>;
  texts(pagePath: string): Promise<FramerText[]>;
  text(node: string): Promise<{ text: string; mixed: boolean } | null>;
  setText(node: string, text: string): Promise<void>;
  unpublished(): Promise<FramerChange[]>;
  close(): Promise<void>;
};

/** The few raw methods the wrapper uses, so tests can hand in a fake. */
type RawNode = { id: string; getText?: () => Promise<string | null>; getHTML?: () => Promise<string | null>; setText?: (t: string) => Promise<void>; getNodesWithType?: (t: 'TextNode') => Promise<RawNode[]>; path?: string | null; draft?: boolean };
export type RawFramer = {
  getNodesWithType(type: 'WebPageNode'): Promise<RawNode[]>;
  getNode(id: string): Promise<RawNode | null>;
  getUnpublishedPageChanges(): Promise<ReadonlyArray<{ path?: string | null; status?: string }>>;
  getProjectInfo(): Promise<{ name?: string; id?: string }>;
  disconnect(): Promise<void>;
};
export type Connect = (project: string, key: string) => Promise<RawFramer>;

const realConnect: Connect = async (project, key) => {
  if (process.env.VITEST) throw new Error('Tests must not reach Framer');
  const api = await import('framer-api');
  return (await api.connect(project, key)) as unknown as RawFramer;
};

/** One text style per node: anything beyond a single wrapping tag (bold, links, spans) is mixed. */
export function isMixed(html: string | null | undefined): boolean {
  if (!html) return false;
  const inner = html.trim().replace(/^<(p|h[1-6]|div|span)(\s[^>]*)?>([\s\S]*)<\/\1>$/i, '$3');
  return /<[a-z!/]/i.test(inner);
}

/** A Framer error in plain words. The key never appears in it, even if Framer's own message quotes it. */
export function keyCheckError(e: unknown, key: string): string {
  const code = String((e as { code?: unknown })?.code ?? '');
  const raw = e instanceof Error ? e.message : String(e ?? '');
  if (code === 'UNAUTHORIZED') return 'Framer did not accept this key. Make a new one in Site Settings > General > API keys.';
  if (code === 'INVALID_REQUEST' || code === 'PROJECT_CLOSED') return 'Framer could not open this project with this key. Check the link, and that the key was made in this project.';
  if (code === 'TIMEOUT') return 'Framer did not answer in time. Try again in a minute.';
  if (code === 'TOKEN_SESSION_LIMIT' || code === 'POOL_EXHAUSTED') return 'Framer has too many open connections for this key. Try again in a few minutes.';
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|fetch failed|getaddrinfo|network/i.test(raw)) return 'Could not reach Framer. Check your internet connection, then try again.';
  const said = raw.split(key.trim() || '\u0000').join('[key]').replace(/\s+/g, ' ').trim().slice(0, 160);
  return said ? `Framer did not accept the key check: ${said}` : 'Framer did not accept the key check.';
}

/**
 * Check key: connects, reads the project's name and disconnects. Nothing in the project is read or changed.
 */
export async function projectInfo(project: string, key: string, connect: Connect = realConnect): Promise<{ name: string }> {
  let raw: RawFramer | null = null;
  try {
    raw = await connect(project, key);
    const info = await raw.getProjectInfo();
    return { name: String(info?.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Untitled project' };
  } catch (e) {
    throw new Error(keyCheckError(e, key));
  } finally {
    await raw?.disconnect().catch(() => {});
  }
}

export async function openSite(project: string, key: string, connect: Connect = realConnect): Promise<FramerSite> {
  const raw = await connect(project, key);
  const pageNodes = async () => (await raw.getNodesWithType('WebPageNode')).filter((p) => typeof p.path === 'string');
  const read = async (n: RawNode) => {
    const [text, html] = await Promise.all([n.getText?.() ?? null, n.getHTML?.().catch(() => null) ?? null]);
    return { text: text ?? '', mixed: isMixed(html) };
  };
  return {
    pages: async () => (await pageNodes()).map((p) => ({ id: p.id, path: p.path as string, draft: !!p.draft })),
    texts: async (pagePath) => {
      const page = (await pageNodes()).find((p) => p.path === pagePath);
      if (!page?.getNodesWithType) return [];
      const out: FramerText[] = [];
      for (const n of await page.getNodesWithType('TextNode')) {
        const r = await read(n);
        if (r.text.trim()) out.push({ id: n.id, page: pagePath, ...r });
      }
      return out;
    },
    text: async (node) => {
      const n = await raw.getNode(node);
      return n?.getText ? read(n) : null;
    },
    setText: async (node, text) => {
      const n = await raw.getNode(node);
      if (!n?.setText) throw new Error('This text is gone from the page');
      await n.setText(text);
    },
    unpublished: async () => (await raw.getUnpublishedPageChanges()).map((c) => ({ path: c.path ?? '', status: c.status ?? 'changed' })).filter((c) => c.path),
    close: () => raw.disconnect().catch(() => {}),
  };
}

/**
 * Applies a plan on Go. Each node is read right before it is written: if her text changed since the plan, or the node
 * has mixed styles, the edit stops (or turns into copy and paste) instead of overwriting. Returns every record, with
 * the old text kept for Undo all.
 */
export async function applyPlan(site: FramerSite, plan: EditPlanItem[], onStep: (records: EditRecord[]) => void = () => {}): Promise<{ records: EditRecord[]; error: string | null }> {
  const records: EditRecord[] = plan.map((p) => ({ ...p, state: p.kind === 'copy' ? 'copy' : 'waiting' }));
  onStep(records);
  for (const r of records) {
    if (r.kind !== 'text') continue;
    try {
      const now = await site.text(r.node);
      if (!now) throw new Error('This text is gone from the page');
      if (now.mixed) {
        Object.assign(r, { state: 'copy', error: 'Mixed styles, paste it by hand' });
        continue;
      }
      if (now.text !== r.old) throw new Error('The text changed in Framer since the plan');
      await site.setText(r.node, r.text);
      r.state = 'done';
    } catch (e) {
      r.state = 'failed';
      r.error = e instanceof Error ? e.message : String(e);
      onStep(records);
      return { records, error: r.error };
    } finally {
      onStep(records);
    }
  }
  return { records, error: null };
}

/** Puts back the old text of every edit that is still as Design Studio left it. Text she changed since is kept. */
export async function undoAll(site: FramerSite, records: EditRecord[]): Promise<{ records: EditRecord[]; kept: number }> {
  let kept = 0;
  for (const r of records) {
    if (r.kind !== 'text' || r.state !== 'done') continue;
    const now = await site.text(r.node).catch(() => null);
    if (now && now.text === r.text) {
      await site.setText(r.node, r.old);
      r.state = 'undone';
    } else kept++;
  }
  return { records, kept };
}
