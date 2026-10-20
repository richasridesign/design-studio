// The Design Studio plugin's main code, in Figma's plugin sandbox. Its window (ui.html) holds the socket to Design
// Studio on this Mac and passes messages through. Build with `npm run plugin` (bundles into code.js and embed.js).
// What it does with each message lives in agent.ts, shared with figma.com in the Design Studio window (embed.ts).
import { agent } from './agent';

declare const figma: any;
declare const __html__: string;

const SIZE = { w: 280, h: 148 };
const SMALL = { w: 280, h: 48 };
figma.showUI(__html__, { width: SIZE.w, height: SIZE.h, title: 'Design Studio', themeColors: true });

// Figma gives the file's key only to private plugins, and may throw instead of answering; Design Studio then finds
// the file by its name.
const fileKey = () => { try { return typeof figma.fileKey === 'string' ? figma.fileKey : null; } catch { return null; } };
const a = agent(figma, (m) => figma.ui.postMessage(m), fileKey);

figma.ui.onmessage = (m: any) => {
  if (m && m.t === 'small') {
    const s = m.on ? SMALL : SIZE;
    figma.ui.resize(s.w, s.h);
  } else void a.onmessage(m);
};
