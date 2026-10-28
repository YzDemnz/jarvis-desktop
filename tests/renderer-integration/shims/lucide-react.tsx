import { createElement, forwardRef } from 'react';

/**
 * Harness-only lucide-react. Each icon renders a real <svg> carrying its name,
 * so tests can target an icon without depending on the actual path data.
 * Regenerate with: python3 tests/renderer-integration/gen-lucide-shim.py
 */
function icon(name: string) {
  const Component = forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
    createElement('svg', { ...props, ref, 'data-icon': name, viewBox: '0 0 24 24', width: 16, height: 16 }));
  Component.displayName = name;
  return Component;
}

export type LucideIcon = ReturnType<typeof icon>;
export const Activity = icon('Activity');
export const AlertTriangle = icon('AlertTriangle');
export const AppWindow = icon('AppWindow');
export const Archive = icon('Archive');
export const ArrowLeft = icon('ArrowLeft');
export const ArrowRight = icon('ArrowRight');
export const ArrowUp = icon('ArrowUp');
export const ArrowUpRight = icon('ArrowUpRight');
export const Bookmark = icon('Bookmark');
export const Braces = icon('Braces');
export const Check = icon('Check');
export const ChevronDown = icon('ChevronDown');
export const ChevronRight = icon('ChevronRight');
export const ChevronsLeft = icon('ChevronsLeft');
export const ChevronsRight = icon('ChevronsRight');
export const Circle = icon('Circle');
export const CircleDashed = icon('CircleDashed');
export const CircleSlash = icon('CircleSlash');
export const CircleUser = icon('CircleUser');
export const Clock = icon('Clock');
export const Cloud = icon('Cloud');
export const Compass = icon('Compass');
export const Cpu = icon('Cpu');
export const Download = icon('Download');
export const Eraser = icon('Eraser');
export const ExternalLink = icon('ExternalLink');
export const Eye = icon('Eye');
export const File = icon('File');
export const FileCode = icon('FileCode');
export const FileText = icon('FileText');
export const Folder = icon('Folder');
export const FolderGit2 = icon('FolderGit2');
export const FolderOpen = icon('FolderOpen');
export const FolderPlus = icon('FolderPlus');
export const FolderTree = icon('FolderTree');
export const GitBranch = icon('GitBranch');
export const Globe = icon('Globe');
export const Hand = icon('Hand');
export const HardDrive = icon('HardDrive');
export const Image = icon('Image');
export const KeyRound = icon('KeyRound');
export const LineChart = icon('LineChart');
export const Loader2 = icon('Loader2');
export const Lock = icon('Lock');
export const LucideIcon = icon('LucideIcon');
export const MessageSquare = icon('MessageSquare');
export const Microscope = icon('Microscope');
export const Minimize2 = icon('Minimize2');
export const Minus = icon('Minus');
export const MoreHorizontal = icon('MoreHorizontal');
export const Octagon = icon('Octagon');
export const PanelRight = icon('PanelRight');
export const PanelRightClose = icon('PanelRightClose');
export const PanelsTopLeft = icon('PanelsTopLeft');
export const Pause = icon('Pause');
export const Pin = icon('Pin');
export const Play = icon('Play');
export const Plus = icon('Plus');
export const Quote = icon('Quote');
export const RefreshCw = icon('RefreshCw');
export const RotateCw = icon('RotateCw');
export const Search = icon('Search');
export const Settings = icon('Settings');
export const ShieldAlert = icon('ShieldAlert');
export const ShieldCheck = icon('ShieldCheck');
export const Sparkles = icon('Sparkles');
export const Square = icon('Square');
export const Terminal = icon('Terminal');
export const TerminalSquare = icon('TerminalSquare');
export const Trash2 = icon('Trash2');
export const Undo2 = icon('Undo2');
export const Wand2 = icon('Wand2');
export const Wrench = icon('Wrench');
export const X = icon('X');
export const Zap = icon('Zap');
