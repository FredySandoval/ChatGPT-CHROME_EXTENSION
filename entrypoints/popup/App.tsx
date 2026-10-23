import { SupportProject, useSupportPreferences } from '@/components/support-project';
import { Copy, Check } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button }                       from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Progress }                     from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem }   from '@/components/ui/radio-group';
import { ScrollArea }                   from '@/components/ui/scroll-area';
import { cn }                           from '@/lib/utils';

const defaultUserLabel      = 'USER';
const defaultAssistantLabel = 'ASSISTANT';
const defaultSecondsBetweenChatDownloads = 2;

type DownloadType      = 'json'         | 'raw-json'  | 'markdown';
type FromSource        = 'Current Chat' | 'All Chats' | 'Current Project';
type DownloadFormat    = 'Markdown'     | 'JSON'      | 'Raw JSON' | 'PDF';
type RunningMode       = 'all'          | 'project'   | null;
type MarkdownExtension = '.md'          | '.mdx';

type Settings = {
  startOffset           : number;
  stopOffset            : number;
  userLabel             : string;
  assistantLabel        : string;
  markdownExtension     : MarkdownExtension;
  mdxFrontmatter        : string;
  autoAdvanceStartOffset: boolean;
  secondsBetweenChatDownloads: number;
};

type MarkdownSettings = Pick<Settings, 'userLabel' | 'assistantLabel' | 'markdownExtension' | 'mdxFrontmatter'>;

type BackupResponse = {
  text?            : string;
  message?         : string;
  error?           : string;
  cancelled?       : boolean;
  conversations?   : unknown[];
  rawConversations?: unknown[];
  failures?        : unknown[];
};

type StopBackupResponse = {
  message? : string;
  stopping?: boolean;
};

type ProgressStatus = 'idle' | 'running' | 'warning' | 'done' | 'cancelled' | 'error';

type ProgressMessage = {
  text?        : string;
  total?       : number;
  completed?   : number;
  targetTotal? : number;
  status?      : ProgressStatus;
  activeBackup?: boolean;
};

type LogEntry = {
  label : string;
  time  : string;
  status: ProgressStatus;
};

const popupLogEntriesStorageKey = 'popupLogEntries';
const maxPopupLogEntries = 500;

type StorageSettings = Partial<Settings>;

export type ChoiceItem = {
  iconName : string;
  label    : string;
  sublabel?: string;
  selected?: boolean;
  disabled?: boolean;
};

type ChoicePanelProps = {
  title         : string;
  items         : ChoiceItem[];
  value?        : string;
  onValueChange?: (value: string) => void;
};

const icon = (name: string) => `/icons/${name}`;

const iconSizes: Record<string, string> = {
  "icon-all-chats-28x28.svg":           "h-[28px] w-[28px]",
  "icon-checkmark-10x7.svg":            "h-[7px]  w-[10px]",
  "icon-current-chat-28x28.svg":        "h-[28px] w-[28px]",
  "icon-current-project-28x28.svg":     "h-[28px] w-[28px]",
  "icon-download-24x24.svg":            "h-[24px] w-[24px]",
  "icon-download-as-rawjson-28x28.svg": "h-[28px] w-[28px]",
  "icon-download-as-json-28x28.svg":    "h-[28px] w-[28px]",
  "icon-download-as-pdf-28x28.svg": "h-[28px] w-[28px]",
  "icon-download-as-md-28x28.svg":      "h-[28px] w-[28px]",
  "icon-heart-14x12.svg":               "h-[12px] w-[14px]",
  "icon-logoA-64x64.svg":               "h-[64px] w-[64px]",
  "icon-options-bottom-left-14x14.svg": "h-[14px] w-[14px]",
  "icon-progress-20x11.svg":            "h-[11px] w-[20px]",
  "icon-greater-than-14x14.svg":        "h-[14px] w-[14px]",
  "icon-checkmark-checked-24x24.svg":   "h-[24px] w-[24px]",
  "icon-checkmark-unchecked-24x24.svg": "h-[24px] w-[24px]",
}

function SvgIcon({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cn('relative inline-block shrink-0', iconSizes[name], className)}>
      <img src={icon(name)} alt="" className="absolute left-0 top-0" />
    </span>
  );
}

export function ChoicePanel({ title, items, value, onValueChange }: ChoicePanelProps) {
  const defaultValue = items.find((item) => item.selected && !item.disabled)?.label ?? items.find((item) => !item.disabled)?.label;
  const groupId = title.replace(/\s+/g, '-').toLowerCase();

  return (
    <div>
      <h2 className="mb-[3px] text-[14px] font-bold text-[#215145]">{title}</h2>
      <RadioGroup
        value={value}
        defaultValue={defaultValue}
        onValueChange={onValueChange}
        className="gap-0 rounded-[8px] border-[4px] border-[#C6F0E5]/70 bg-[#FDFFFF] px-[17px] py-[11px]"
      >
        <div className="space-y-[11px]">
          {items.map((item, index) => {
            const id = `${groupId}-${index}`;
            return (
              <label
                key={item.label}
                htmlFor={id}
                aria-disabled={item.disabled}
                className={cn(
                  'relative isolate flex items-center gap-[9px] after:absolute after:-inset-[4px] after:-z-10 after:rounded-[6px] after:transition-colors',
                  item.disabled
                    ? 'cursor-default opacity-45 grayscale'
                    : 'cursor-pointer hover:after:bg-[#C6F0E5]'
                )}
              >
                <SvgIcon name={item.iconName} />

                <div className="flex flex-col leading-[1.1]">
                  <span className="text-[13px] font-medium text-[#215145]">{item.label}</span>
                  {item.sublabel ? <span className="text-[11px] text-[#6B7280]">{item.sublabel}</span> : null}
                </div>

                <span className="relative ml-auto size-[24px] shrink-0">
                  <RadioGroupItem id={id} value={item.label} disabled={item.disabled} className="peer absolute inset-0 size-full opacity-0 disabled:cursor-default" />
                  <SvgIcon name="icon-checkmark-unchecked-24x24.svg" className="absolute inset-0 peer-data-[state=checked]:hidden" />
                  <SvgIcon name="icon-checkmark-checked-24x24.svg" className="absolute inset-0 hidden peer-data-[state=checked]:inline-block" />
                </span>
              </label>
            );
          })}
        </div>
      </RadioGroup>
    </div>
  );
}

function Header() {
  return (
    <header className="flex h-[64px] items-start justify-between">
      <div className="h-[64px] w-[64px]">
        <img src={icon("icon-logoA-64x64.svg")} alt=""/>
      </div>
      <div >
        <h1 className="font-sans text-[22px] font-bold  text-[#215145]">ChatGPT Backup Tool</h1>
        <p className="font-sans text-[14px] font-normal  text-[#6B7280]">Back up your conversations in seconds</p>
      </div>
      <div className="mt-0 flex h-[40px] w-[90px] items-center justify-center gap-[10px] rounded-[15px] bg-[#D1F0E8]/50 font-sans text-[14px] font-normal text-[#009D7A]">
        <span className="relative h-[10px] w-[10px] rounded-full bg-[#10A37F] " >
          <span className="absolute  h-full w-full animate-ping rounded-full bg-[#10A37F] opacity-50" />
        </span>Ready
      </div>
    </header>
  )
}

function LogRow({ label, time, dot = "bg-[#10A37F]" }: { label: string; time: string; dot?: string }) {
  return (
    <div className="mb-[13px] flex items-center justify-between pr-[1px]">
      <div className="flex items-center gap-[11px]">
        <span className={cn("h-[6px] w-[6px] rounded-full", dot)} />
        <span>{label}</span>
      </div>
      <span className="text-[12px] text-[#9CA3AF]">{time}</span>
    </div>
  )
}

function Footer() {
  function openOptions(event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    chrome.runtime.openOptionsPage();
  }

  function openGitHub(event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    chrome.tabs.create({ url: 'https://github.com/FredySandoval/ChatGPT-CHROME_EXTENSION' });
  }

  return (
    <footer className="flex h-[54px] w-full items-center justify-between border-t border-[#D3D3D3] bg-[#E7F2E8]/45 px-[18px] text-[14px]">
      <a className="flex items-center gap-[8px] text-[#00A582]" href="#" onClick={openOptions}>
        <SvgIcon name="icon-options-bottom-left-14x14.svg" />
        Options
      </a>
      <span className="flex items-center gap-[8px] text-[#6B7280] select-none" >
        <SvgIcon name="icon-heart-14x12.svg" className="opacity-70" />
        Open source
      </span>
      <a className="flex items-center gap-[7px] text-[#00A582]" href="https://github.com/FredySandoval/ChatGPT-CHROME_EXTENSION" onClick={openGitHub}>
        <span className="relative h-[15px] w-[15px]">
          <span className="absolute bottom-0 left-0 h-[11px] w-[11px] rounded-[2px] border-2 border-[#00A582]" />
          <span className="absolute right-0 top-0 h-[8px] w-[8px] border-r-2 border-t-2 border-[#00A582]" />
        </span>
        GitHub
      </a>
    </footer>
  )
}

function sendMessage<T>(message: unknown): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: T | undefined) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message || 'Extension messaging failed'));
      } else {
        resolve(response);
      }
    });
  });
}

function getActiveTabs(): Promise<chrome.tabs.Tab[]> {
  return new Promise((resolve) => chrome.tabs.query({ active: true, currentWindow: true }, resolve));
}

function normalizeMarkdownExtension(value: unknown): MarkdownExtension {
  return value === '.mdx' ? '.mdx' : '.md';
}

function formatLogTime(date = new Date()) {
  return date.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function getProgressDot(status: ProgressStatus) {
  if (status === 'warning') return 'bg-[#F59E0B]';
  if (status === 'cancelled') return 'bg-[#F97316]';
  if (status === 'error') return 'bg-[#DC2626]';
  if (status === 'idle') return 'bg-[#9CA3AF]';
  return 'bg-[#10A37F]';
}

function isTerminalStatus(status: ProgressStatus) {
  return status === 'done' || status === 'cancelled' || status === 'error';
}

function isProgressStatus(value: unknown): value is ProgressStatus {
  return value === 'idle'
    || value === 'running'
    || value === 'warning'
    || value === 'done'
    || value === 'cancelled'
    || value === 'error';
}

function isLogEntry(value: unknown): value is LogEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<LogEntry>;
  return typeof entry.label === 'string'
    && typeof entry.time === 'string'
    && isProgressStatus(entry.status);
}

function dedupeLogEntries(entries: LogEntry[]) {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = `${entry.status}:${entry.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getStoredLogEntries(value: unknown): LogEntry[] {
  return Array.isArray(value) ? dedupeLogEntries(value.filter(isLogEntry)).slice(-maxPopupLogEntries) : [];
}

function appendLogEntriesWithoutDuplicates(entries: LogEntry[], entriesToAppend: LogEntry[]) {
  return dedupeLogEntries([...entries, ...entriesToAppend]).slice(-maxPopupLogEntries);
}

export default function App() {
  const logScrollAreaRef                    = useRef<HTMLDivElement | null>(null);
  const logEntriesLoadedRef                 = useRef(false);
  const [progressDone,   setProgressDone]   = useState(0);
  const [progressTarget, setProgressTarget] = useState(0);
  const [progressStatus, setProgressStatus] = useState<ProgressStatus>('idle');
  const [isProgressOpen, setIsProgressOpen] = useState(true);
  const [logEntries,     setLogEntries]     = useState<LogEntry[]>([]);
  const [runningMode,    setRunningMode]    = useState<RunningMode>(null);
  const [isProjectChat,  setIsProjectChat]  = useState(false);
  const [fromSource,     setFromSource]     = useState<FromSource>('Current Chat');
  const [downloadFormat, setDownloadFormat] = useState<DownloadFormat>('Markdown');
  const [settings,       setSettings]       = useState<Settings>({
    startOffset: 0,
    stopOffset: -1,
    userLabel: defaultUserLabel,
    assistantLabel: defaultAssistantLabel,
    markdownExtension: '.md',
    mdxFrontmatter: '---\ntitle: "{{title}}"\n---',
    autoAdvanceStartOffset: true,
    secondsBetweenChatDownloads: defaultSecondsBetweenChatDownloads,
  });

  const support = useSupportPreferences();
  const [exportSucceeded, setExportSucceeded] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const actionLock = useRef(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const allRunning = runningMode === 'all';
  const projectRunning = runningMode === 'project';

  useEffect(() => {
    chrome.storage.local.get(['colorScheme', popupLogEntriesStorageKey], (result: { colorScheme?: string; popupLogEntries?: unknown }) => {
      const storedLogEntries = getStoredLogEntries(result[popupLogEntriesStorageKey]);
      setLogEntries((currentEntries) => {
        const entries = appendLogEntriesWithoutDuplicates(storedLogEntries, currentEntries);
        logEntriesLoadedRef.current = true;
        chrome.storage.local.set({ [popupLogEntriesStorageKey]: entries });
        return entries;
      });

      document.documentElement.classList.remove('light', 'dark');
      document.documentElement.classList.add('light');
    });

    getActiveTabs().then((tabs) => {
      const activeTabUrl = tabs?.[0]?.url || '';
      setIsProjectChat(/^https:\/\/chatgpt\.com\/g\/g-p-[^/]+\/c\//.test(activeTabUrl));
    });

    chrome.storage.sync.get([
      'startOffset', 'stopOffset', 'userLabel', 'assistantLabel', 'markdownExtension', 'mdxFrontmatter', 'autoAdvanceStartOffset', 'secondsBetweenChatDownloads',
    ], (result: StorageSettings) => {
      setSettings({
        startOffset: Number(result.startOffset ?? 0),
        stopOffset: Number(result.stopOffset ?? -1),
        userLabel: result.userLabel || defaultUserLabel,
        assistantLabel: result.assistantLabel || defaultAssistantLabel,
        markdownExtension: normalizeMarkdownExtension(result.markdownExtension),
        mdxFrontmatter: result.mdxFrontmatter || '---\ntitle: "{{title}}"\n---',
        autoAdvanceStartOffset: result.autoAdvanceStartOffset ?? true,
        secondsBetweenChatDownloads: Number(result.secondsBetweenChatDownloads ?? defaultSecondsBetweenChatDownloads),
      });
    });

    const port = chrome.runtime.connect({ name: 'progress' });
    port.onMessage.addListener((msg: ProgressMessage) => {
      if (msg.activeBackup) setRunningMode('all');
      if (!msg.text) return;
      updateProgress(msg.text, msg.status ?? 'running', msg.completed ?? msg.total, msg.targetTotal);
      if (!msg.activeBackup && msg.status && isTerminalStatus(msg.status)) resetRunningStates();
    });
    return () => port.disconnect();
  }, []);

  useEffect(() => {
    const viewport = logScrollAreaRef.current?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
    if (!viewport) return;

    requestAnimationFrame(() => {
      viewport.scrollTop = viewport.scrollHeight;
    });
  }, [logEntries]);

  function persistLogEntries(entries: LogEntry[]) {
    if (logEntriesLoadedRef.current) {
      chrome.storage.local.set({ [popupLogEntriesStorageKey]: entries });
    }
  }

  function addLogEntry(label: string, status: ProgressStatus = 'running') {
    setLogEntries((entries) => {
      const last = entries[entries.length - 1];
      if (last?.label === label && last.status === status) return entries;

      const updatedEntries = [...entries, { label, status, time: formatLogTime() }].slice(-maxPopupLogEntries);
      persistLogEntries(updatedEntries);
      return updatedEntries;
    });
  }

  function setProgressDetails(text: string, status: ProgressStatus = 'running', completed?: number, targetTotal?: number) {
    const hasCompleted = typeof completed === 'number' && completed > 0;
    const hasTarget = typeof targetTotal === 'number' && targetTotal > 0;
    const countPrefix = hasCompleted ? `${completed}${hasTarget ? ` / ${targetTotal}` : ''}: ` : '';
    const label = `${countPrefix}${text}`;
    setProgressStatus(status);
    if (status === 'error' || status === 'warning' || status === 'cancelled') setExportSucceeded(false);
    if (typeof completed === 'number') setProgressDone(completed);
    if (typeof targetTotal === 'number') setProgressTarget(targetTotal);
    return label;
  }

  function updateProgress(text: string, status: ProgressStatus = 'running', completed?: number, targetTotal?: number) {
    addLogEntry(setProgressDetails(text, status, completed, targetTotal), status);
  }

  function startProgressAction(text: string, status: ProgressStatus = 'running', completed?: number, targetTotal?: number) {
    setExportSucceeded(false);
    const label = setProgressDetails(text, status, completed, targetTotal);
    const latestActionEntries = [{ label, status, time: formatLogTime() }];
    setLogEntries(latestActionEntries);
    persistLogEntries(latestActionEntries);
  }

  function resetRunningStates() {
    setRunningMode(null);
  }

  function showResponseStatus(response: BackupResponse | undefined, fallbackSuccessText = 'Download complete') {
    if (chrome.runtime.lastError) {
      updateProgress(`Error: ${chrome.runtime.lastError.message}`, 'error');
      resetRunningStates();
      return;
    }
    if (!response) {
      updateProgress(fallbackSuccessText, 'done');
      resetRunningStates();
      return;
    }
    if (response.cancelled) {
      updateProgress(`Stopped and downloaded ${response.conversations?.length || response.rawConversations?.length || 0} chats${response.failures?.length ? `, skipped ${response.failures.length}` : ''}`, 'cancelled');
      resetRunningStates();
      return;
    }
    if (response.error) {
      const isUpdateNotice = String(response.error).startsWith('Update required:');
      updateProgress(isUpdateNotice ? response.error : `Error: ${response.error}`, 'error');
      resetRunningStates();
      return;
    }
    if (response.failures?.length) {
      updateProgress(`Done: ${response.conversations?.length || response.rawConversations?.length || 0} chats, skipped ${response.failures.length}`, 'warning');
      resetRunningStates();
      return;
    }
    updateProgress(fallbackSuccessText, 'done');
    setExportSucceeded(true);
    resetRunningStates();
  }

  function maybeAdvanceStartOffset(response: BackupResponse | undefined) {
    if (!settings.autoAdvanceStartOffset || !response || response.error) return;
    const downloadedCount = response.conversations?.length || response.rawConversations?.length || 0;
    if (!downloadedCount) return;

    const nextStartOffset = settings.startOffset + downloadedCount;
    const nextStopOffset = settings.stopOffset === -1 ? -1 : settings.stopOffset + downloadedCount;
    setSettings((s) => ({ ...s, startOffset: nextStartOffset, stopOffset: nextStopOffset }));
    chrome.storage.sync.set({ startOffset: nextStartOffset, stopOffset: nextStopOffset });
  }

  async function backupAll(message: 'backUpAllAsJSON' | 'backUpAllAsRAWJSON' | 'backUpAllAsMARKDOWN', text: string, extra: Partial<MarkdownSettings> = {}) {
    setRunningMode('all');
    startProgressAction(text, 'running', 0);
    const response = await sendMessage<BackupResponse>({ message, startOffset: settings.startOffset, stopOffset: settings.stopOffset, secondsBetweenChatDownloads: settings.secondsBetweenChatDownloads, ...extra });
    maybeAdvanceStartOffset(response);
    showResponseStatus(response);
  }

  async function backupCurrentChat(downloadType: DownloadType) {
    startProgressAction(`Preparing current chat ${downloadType === 'raw-json' ? 'raw JSON' : downloadType} backup...`, 'running', 0);
    const tabs = await getActiveTabs();
    const includeImages = fromSource === 'Current Chat';
    const response = await sendMessage<BackupResponse>({ message: 'backUpSingleChat', tabs, downloadType, includeImages, ...markdownSettings });
    showResponseStatus(response);
  }

  async function backupProject(downloadType: DownloadType) {
    setRunningMode('project');
    startProgressAction(`Preparing current project ${downloadType === 'raw-json' ? 'raw JSON' : downloadType} backup...`, 'running', 0);
    const response = await sendMessage<BackupResponse>({ message: 'backUpCurrentProject', downloadType, startOffset: 0, stopOffset: -1, secondsBetweenChatDownloads: settings.secondsBetweenChatDownloads, ...markdownSettings });
    showResponseStatus(response);
  }

  async function stopBackup() {
    updateProgress('Stopping backup and preparing partial download...', 'cancelled');
    const response = await sendMessage<StopBackupResponse>({ message: 'stopBackup' });
    if (!response?.stopping) {
      updateProgress('No backup is currently running', 'idle');
      resetRunningStates();
    }
  }

  function handleFromSourceChange(value: string) {
    if (value === 'Current Project' && !isProjectChat) return;
    setFromSource(value as FromSource);
    if (value !== 'Current Chat' && downloadFormat === 'PDF') setDownloadFormat('Markdown');
  }

  function handleDownloadFormatChange(value: string) {
    setDownloadFormat(value as DownloadFormat);
  }

  function getDownloadType(format: DownloadFormat): DownloadType {
    if (format === 'JSON') return 'json';
    if (format === 'Raw JSON') return 'raw-json';
    return 'markdown';
  }

  async function handleCopy() {
    if (actionLock.current || runningMode || fromSource !== 'Current Chat' || downloadFormat === 'PDF') return;
    actionLock.current = true;
    setActionBusy(true);
    setCopied(false);
    startProgressAction('Preparing current chat for clipboard...', 'running', 0);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      const tabs = await getActiveTabs();
      const response = await sendMessage<BackupResponse>({
        message: 'backUpSingleChat', tabs, downloadType: getDownloadType(downloadFormat),
        includeImages: true, output: 'clipboard', ...markdownSettings,
      });
      if (response?.error || typeof response?.text !== 'string') throw new Error(response?.error || 'Missing content');
      await navigator.clipboard.writeText(response.text);
      if (tabs[0]?.id) {
        void chrome.tabs.sendMessage(tabs[0].id, { message: 'showExportSuccess' }).catch(() => {});
      }
      setCopied(true);
      updateProgress('Copied to clipboard', 'done', 1, 1);
      setExportSucceeded(true);
    } catch {
      updateProgress('Could not copy to clipboard. Please try again.', 'error');
    } finally {
      actionLock.current = false;
      setActionBusy(false);
    }
  }

  async function handleDownload() {
    if (actionLock.current || runningMode) return;
    actionLock.current = true;
    setActionBusy(true);
    setCopied(false);
    setExportSucceeded(false);
    try {
      await performDownload();
    } catch (error) {
      updateProgress(`Unable to communicate with the extension: ${error instanceof Error ? error.message : String(error)}. Reopen the popup and try again.`, 'error');
      resetRunningStates();
    } finally {
      actionLock.current = false;
      setActionBusy(false);
    }
  }

  async function performDownload() {
    if (allRunning || projectRunning) {
      await stopBackup();
      return;
    }

    if (downloadFormat === 'PDF') {
      if (fromSource !== 'Current Chat') return;
      getActiveTabs().then(async tabs => {
        const tab = tabs[0];
        if (!tab?.id || !tab.url || new URL(tab.url).origin !== 'https://chatgpt.com') throw new Error('Open a ChatGPT conversation first.');
        await chrome.tabs.create({ url: chrome.runtime.getURL(`/pdf.html?tab=${tab.id}`) });
      }).catch(error => updateProgress(String(error), 'error'));
      return;
    }
    const downloadType = getDownloadType(downloadFormat);

    if (fromSource === 'All Chats') {
      if (downloadType === 'json')     await backupAll('backUpAllAsJSON', 'Fetching chats for JSON backup...');
      if (downloadType === 'raw-json') await backupAll('backUpAllAsRAWJSON', 'Fetching chats for raw JSON backup...');
      if (downloadType === 'markdown') await backupAll('backUpAllAsMARKDOWN', 'Fetching chats for markdown backup...', markdownSettings);
      return;
    }

    if (fromSource === 'Current Project') {
      if (!isProjectChat) return;
      await backupProject(downloadType);
      return;
    }

    await backupCurrentChat(downloadType);
  }

  const markdownSettings = useMemo<MarkdownSettings>(() => ({
    userLabel        : settings.userLabel,
    assistantLabel   : settings.assistantLabel,
    markdownExtension: settings.markdownExtension,
    mdxFrontmatter   : settings.mdxFrontmatter,
  }), [settings]);

  const busy = actionBusy || runningMode !== null;
  const copyUnavailable = fromSource !== 'Current Chat' || downloadFormat === 'PDF';
  const actionClass = 'flex h-[48px] w-full cursor-pointer gap-[8px] rounded-[10px] border-[3px] border-[#9FE3D5] bg-[#E7F2E8]/60 px-2 py-2 text-[14px] font-medium text-[#215145] shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:bg-[#E7F2E8]';

  const progressPercent = useMemo(() => {
    if (isTerminalStatus(progressStatus)) return 100;
    if (progressStatus === 'idle') return 0;

    const completed = Math.max(0, progressDone);
    const target = Math.max(0, progressTarget);

    if (!completed) return 5;
    if (!target) return 5;
    return Math.max(5, Math.min(99, Math.round((completed / target) * 100)));
  }, [progressStatus, progressDone, progressTarget]);

  const canStopBackup = allRunning || projectRunning;

  return <section className="mx-auto w-[500px] overflow-hidden bg-white shadow-[0_14px_38px_10px_rgba(0,0,0,0.22)]">
    <div className="p-[25px]">
      <Header />

      <div className="mt-[48px] grid grid-cols-2 gap-[24px]">
        <ChoicePanel
          title="From"
          value={fromSource}
          onValueChange={handleFromSourceChange}
          items={[
            { iconName: 'icon-current-chat-28x28.svg'   , label: 'Current Chat',    selected: true           },
            { iconName: 'icon-all-chats-28x28.svg'      , label: 'All Chats'                                 },
            { iconName: 'icon-current-project-28x28.svg', label: 'Current Project', disabled: !isProjectChat },
          ]}
        />
        <ChoicePanel
          title="Format"
          value={downloadFormat}
          onValueChange={handleDownloadFormatChange}
          items={[
            { iconName: 'icon-download-as-pdf-28x28.svg', label: 'PDF', sublabel: fromSource === 'Current Chat' ? '.pdf' : 'Current chat only', disabled: fromSource !== 'Current Chat' },
            { iconName: 'icon-download-as-md-28x28.svg'     , label: 'Markdown', sublabel: '.md', selected: true },
            { iconName: 'icon-download-as-json-28x28.svg'   , label: 'JSON'    , sublabel: '.json'               },
            { iconName: 'icon-download-as-rawjson-28x28.svg', label: 'Raw JSON', sublabel: '.jsonl'              },
          ]}
        />
      </div>

      <div className="mt-[28px] grid grid-cols-2 gap-[12px]">
        <Button type="button" variant="outline" onClick={handleDownload} disabled={busy} className={actionClass}>
          <SvgIcon name="icon-download-24x24.svg" /> {downloadFormat === 'PDF' ? 'Preview conversation' : 'Download'}
        </Button>
        <span title={fromSource !== 'Current Chat' ? 'Clipboard copy is only available for Current Chat.' : downloadFormat === 'PDF' ? 'Clipboard copy is only available for text formats.' : undefined}>
          <Button type="button" variant="outline" onClick={handleCopy} disabled={busy || copyUnavailable} className={actionClass}>
            {copied ? <Check size={20} /> : <Copy size={20} />} {copied ? 'Copied!' : 'Copy to Clipboard'}
          </Button>
        </span>
      </div>

      <Collapsible open={isProgressOpen} onOpenChange={setIsProgressOpen}>


        <CollapsibleTrigger className="relative isolate mt-[25px] flex w-full cursor-pointer items-center justify-between text-left text-[#215145] after:absolute after:-inset-[4px] after:-z-10 after:rounded-[6px] after:content-[''] after:transition-colors hover:after:bg-[#C6F0E5]">
          <div className="flex items-center gap-[10px] text-[16px] font-bold">
            <SvgIcon name="icon-greater-than-14x14.svg" className={cn("transition-transform", isProgressOpen && "rotate-90")} />
            Progress
          </div>
          <div className="text-[17px] font-bold text-[#10A37F]">{progressPercent}%</div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <Progress
            value={progressPercent}
            className="mt-[10px] h-[10px] rounded-full bg-[#F3F4F6] [&_[data-slot=progress-indicator]]:bg-[#10A37F]"
          />
          <ScrollArea ref={logScrollAreaRef} className="mt-[17px] h-[135px] rounded-[10px] border border-[#EEF0F2] bg-[#F9FAFB]/70 px-[12px] py-[13px] text-[14px] text-[#4B5563] [&_[data-slot=scroll-area-scrollbar]]:w-[8px] [&_[data-slot=scroll-area-thumb]]:bg-[#D1D5DB]">
            {logEntries.length ? logEntries.map((entry, index) => (
              <LogRow key={`${index}-${entry.time}-${entry.label}-${entry.status}`} label={entry.label} time={entry.time} dot={getProgressDot(entry.status)} />
            )) : (
              <LogRow label="Waiting for backup activity..." time="--:--:--" dot={getProgressDot('idle')} />
            )}
          </ScrollArea>
        </CollapsibleContent>
      </Collapsible>
      {exportSucceeded && !busy && support.loaded && !support.hidden ? (
        <div role="status" className="mt-[20px] rounded-[10px] border border-[#9FE3D5] bg-[#E7F2E8]/60 p-[16px] text-center text-[14px] text-[#215145]">
          <h2 className="font-bold">Export Success!</h2>
          <p className="mt-2">
            Built with ❤️. Thanks for using.{' '}
            <a className="text-[#009D7A] underline hover:no-underline" href="https://chromewebstore.google.com/detail/chatgpt-backup-chatgpt-to/majboohgjfdnegkhadaialohhlimolcc/reviews" target="_blank" rel="noopener noreferrer">Send feedback</a>
          </p>
          <SupportProject />
          <a href="https://buymeacoffee.com/shockerovi7" target="_blank" rel="noopener noreferrer" onClick={() => support.setHidden(true)} className="mt-3 inline-block cursor-pointer text-sm underline hover:no-underline">
            Buy a coffee &amp; Don’t show this again
          </a>
        </div>
      ) : null}
      {canStopBackup ? (
        <Button type="button" onClick={stopBackup} className="mt-[25px] flex h-[41px] w-[85px] items-center justify-center gap-[8px] rounded-[7px] border-[3px] border-[#FEE2E2] bg-[#FEF2F2] text-[14px] text-[#DC2626] hover:bg-[#FFC8C8]">
          <span className="h-[10px] w-[10px] rounded-[1px] bg-[#DC2626]" />
          Stop
        </Button>
      ) : null}


    </div>
    <Footer />
  </section>;
}
