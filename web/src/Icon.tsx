import { createElement } from 'react';
import type { IconNode } from 'lucide';
import {
  AppWindow, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Bell, BellDot, BellOff, BookOpen, Bookmark, Braces, Check, ChevronDown, ChevronRight,
  ChevronUp, ChevronsDownUp, Circle, CircleCheck, CircleSlash, CircleX, Clock, CloudDownload, CodeXml, Compass, Copy, CreditCard, Database,
  Diff, Ellipsis, EllipsisVertical, Eraser, ExternalLink, Eye, EyeOff, File, FileArchive, FileCode, FileImage, FilePlus, FileText, Files,
  Folder, FolderOpen, FoldVertical, GitBranch, GitCommitHorizontal, Globe, History, Info, Layers, Lightbulb, ListChecks, LoaderCircle, Lock,
  LockOpen, Maximize, Maximize2, MessageSquare, MessagesSquare, Mic, Minimize, Minimize2, Minus, Package, Palette, PanelLeft, PanelRight,
  PanelRightDashed, Paperclip, Pause, Pencil, Play, Plug, Plus, RefreshCw, RotateCcw, RotateCw, Scale, Search, Settings, Settings2,
  Smartphone, Sparkles, Square, SquareCode, SquareDashed, Target, Terminal, TextWrap, Timer, Type, TriangleAlert, User, Volume2, VolumeX, Wrench,
  X, Zap,
} from 'lucide';
import './icon.css';

// Every icon is a Lucide line icon. Call sites still use the old codicon names, so this table maps each name to one Lucide
// glyph: the same meaning gets the same icon everywhere. "blank" keeps an empty slot so ticked and unticked rows line up.
const ICONS: Record<string, IconNode> = {
  add: Plus,
  'arrow-down': ArrowDown,
  'arrow-left': ArrowLeft,
  'arrow-right': ArrowRight,
  'arrow-up': ArrowUp,
  bell: Bell,
  'bell-dot': BellDot,
  'bell-slash': BellOff,
  blank: [],
  book: BookOpen,
  bookmark: Bookmark,
  browser: AppWindow,
  check: Check,
  checklist: ListChecks,
  'chevron-down': ChevronDown,
  'chevron-right': ChevronRight,
  'chevron-up': ChevronUp,
  'circle-large-outline': Circle,
  'circle-slash': CircleSlash,
  'clear-all': Eraser,
  clock: Clock,
  close: X,
  'cloud-download': CloudDownload,
  code: CodeXml,
  'collapse-all': ChevronsDownUp,
  comment: MessageSquare,
  'comment-discussion': MessagesSquare,
  compass: Compass,
  copy: Copy,
  'credit-card': CreditCard,
  dash: Minus,
  database: Database,
  'debug-pause': Pause,
  'debug-restart': RotateCcw,
  'debug-start': Play,
  'debug-stop': Square,
  'device-mobile': Smartphone,
  diff: Diff,
  edit: Pencil,
  ellipsis: Ellipsis,
  error: CircleX,
  eye: Eye,
  'eye-closed': EyeOff,
  file: File,
  'file-code': FileCode,
  'file-media': FileImage,
  'file-pdf': FileText,
  'file-text': FileText,
  'file-zip': FileArchive,
  files: Files,
  fold: FoldVertical,
  folder: Folder,
  'folder-opened': FolderOpen,
  'git-branch': GitBranch,
  'git-commit': GitCommitHorizontal,
  globe: Globe,
  history: History,
  info: Info,
  json: Braces,
  'kebab-vertical': EllipsisVertical,
  law: Scale,
  layers: Layers,
  'layout-sidebar-left': PanelLeft,
  'layout-sidebar-right': PanelRight,
  'layout-sidebar-right-off': PanelRightDashed,
  lightbulb: Lightbulb,
  'link-external': ExternalLink,
  loading: LoaderCircle,
  lock: Lock,
  markdown: FileText,
  'maximize-2': Maximize2,
  mic: Mic,
  'minimize-2': Minimize2,
  mute: VolumeX,
  'new-file': FilePlus,
  package: Package,
  paperclip: Paperclip,
  pass: CircleCheck,
  person: User,
  play: Play,
  plug: Plug,
  refresh: RotateCw,
  'screen-full': Maximize,
  'screen-normal': Minimize,
  search: Search,
  settings: Settings2,
  'settings-gear': Settings,
  sparkle: Sparkles,
  'symbol-color': Palette,
  'symbol-method': Wrench,
  'symbol-string': Type,
  sync: RefreshCw,
  target: Target,
  terminal: Terminal,
  tools: Wrench,
  unlock: LockOpen,
  unmute: Volume2,
  vscode: SquareCode,
  warning: TriangleAlert,
  watch: Timer,
  'word-wrap': TextWrap,
  zap: Zap,
};

// Listening shows the mic with its capsule filled, so it differs from the idle mic by shape, not only by colour.
const MIC_FILLED: IconNode = Mic.map(([tag, attrs]) => [tag, tag === 'rect' ? { ...attrs, fill: 'currentColor' } : attrs]);

const camel = (k: string) => k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

const warned = new Set<string>();

function glyph(name: string): IconNode {
  if (name === 'mic-filled') return MIC_FILLED;
  const node = ICONS[name];
  if (node) return node;
  if (!warned.has(name)) {
    warned.add(name);
    console.warn(`Icon: no Lucide icon mapped for "${name}"`);
  }
  // A dashed square: visible, but never mistaken for a status shape such as the idle ring.
  return SquareDashed;
}

// The <i> keeps the old codicon element and box (1em square, sized by font-size), so every rule that sizes, hides or
// tints `.codicon`, or that targets a label `span` next to it, still applies. The svg inside draws the glyph at 1em
// with a 1.5px stroke at every size.
export function Icon({ name, small, spin, color }: { name: string; small?: boolean; spin?: boolean; color?: string }) {
  const node = glyph(name);
  return (
    <i
      aria-hidden
      data-icon={name}
      className={`codicon icon${small ? ' small' : ''}${spin ? ' spin' : ''}`}
      style={color ? { color } : undefined}
    >
      <svg
        viewBox="1 1 22 22" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" focusable="false"
      >
        {node.map(([tag, attrs], i) =>
          createElement(tag, {
            key: i,
            vectorEffect: 'non-scaling-stroke',
            ...Object.fromEntries(Object.entries(attrs).map(([k, v]) => [camel(k), v])),
          }),
        )}
      </svg>
    </i>
  );
}
