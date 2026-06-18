import React                               from 'react'           ;
import  { type SyntheticEvent,  useState } from 'react'           ;
import ReactDOM                            from 'react-dom/client';
import { Check, Info, Save }    from "lucide-react";
import { Button }                                   from '@/components/ui/button'     ;
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'       ;
import { Checkbox }                                 from '@/components/ui/checkbox'   ;
import { Input }                                    from '@/components/ui/input'      ;
import { Label }                                    from '@/components/ui/label'      ;
import { RadioGroup, RadioGroupItem }               from '@/components/ui/radio-group';
import { Textarea }                                 from '@/components/ui/textarea'   ;
import { Tooltip, TooltipContent }                  from "@/components/ui/tooltip"    ;
import { TooltipProvider, TooltipTrigger }          from "@/components/ui/tooltip"    ;
import '../../src/styles/globals.css';
import { cn } from "@/lib/utils"     ;

const textStyles = {
  pageTitle   : "text-sm"           ,
  sectionTitle: "text-sm"           ,
  label       : "text-sm"           ,
  description : "text-sm"           ,
  control     : "text-sm md:text-sm",
  textarea    : "text-sm md:text-sm",
  helper      : "text-sm"           ,
  button      : "text-sm"           ,
}

type SettingRowProps = {
  title       : string         ;
  children    : React.ReactNode;
  description?: React.ReactNode;
}

const DEFAULT_USER_LABEL                     = 'USER'                        ;
const DEFAULT_ASSISTANT_LABEL                = 'ASSISTANT'                   ;
const DEFAULT_START_OFFSET                   = 0                             ;
const DEFAULT_MAX_CHATS_TO_EXPORT            = '40'                          ;
const DEFAULT_MARKDOWN_EXTENSION             = '.md'                         ;
const DEFAULT_MDX_FRONTMATTER                = '---\ntitle: "{{title}}"\n---';
const DEFAULT_AUTO_ADVANCE_START_OFFSET      = true                          ;
const DEFAULT_SECONDS_BETWEEN_CHAT_DOWNLOADS = 2                             ;

type MarkdownExtension = '.md' | '.mdx';

type StoredOptions = {
  startOffset                ? : number ;
  stopOffset                 ? : number ;
  userLabel                  ? : string ;
  assistantLabel             ? : string ;
  markdownExtension          ? : string ;
  mdxFrontmatter             ? : string ;
  autoAdvanceStartOffset     ? : boolean;
  secondsBetweenChatDownloads? : number ;
};

function SettingRow({ title, description, children, }: SettingRowProps) {
  return (
    <>
      <div className="grid grid-cols-[1fr_348px] items-center gap-10 py-2 first:pt-0 last:pb-0  ">
        <div className="max-w-[610px] space-y-1.5 ">
          <div className={cn("flex items-center gap-2 leading-7 font-medium tracking-[-0.02em] text-foreground", textStyles.label)}>
            <Label className={cn("leading-7 font-medium tracking-[-0.02em]", textStyles.label)}>
              {title}
            </Label>
            {title === "Skip newest chats" ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="size-5 text-muted-foreground" strokeWidth={2} />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>0 starts from your newest chat.</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : null}
          </div>
          {description ? (
            <p className={cn("leading-snug text-muted-foreground", textStyles.description)}>
              {description}
            </p>
          ) : null}
        </div>
        <div className="flex justify-start pt-0.5">{children}</div>
      </div>
    </>
  )
}

function Section({ title, children, }: { title: string; children: React.ReactNode; }) {
  return (
    <Card className="mt-[20px] gap-0 border border-border px-[30px] pb-6 shadow-[0_1px_2px_rgb(0_0_0/0.025)] ring-0">
      <CardHeader className="px-0">
        <CardTitle className={cn("mb-[26px] leading-none font-bold tracking-[-0.02em]", textStyles.sectionTitle)}>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0">{children}</CardContent>
    </Card>
  )
}

function OptionsInput({ className, ...props }: React.ComponentProps<typeof Input>) {
  return (
    <Input
      className={cn(
        "h-10 rounded-lg bg-background px-[22px]",
        textStyles.control,
        className
      )}
      {...props}
    />
  )
}

function normalizeMarkdownExtension(value: unknown): MarkdownExtension {
  return value === '.mdx' ? '.mdx' : '.md';
}

function deriveChatsToExport(startOffset: number, stopOffset: number) {
  const stop = Number(stopOffset ?? -1);
  if (stop === -1) return '0';
  return String(Math.max(stop - startOffset, 0));
}

function App() {
  const [startOffset                   , setStartOffset                ] = useState(DEFAULT_START_OFFSET)                         ;
  const [chatsToExport                 , setChatsToExport              ] = useState<string>(DEFAULT_MAX_CHATS_TO_EXPORT)          ;
  const [autoAdvance                   , setAutoAdvance                ] = useState(DEFAULT_AUTO_ADVANCE_START_OFFSET)            ;
  const [secondsBetweenChatDownloads   , setSecondsBetweenChatDownloads] = useState(DEFAULT_SECONDS_BETWEEN_CHAT_DOWNLOADS)       ;
  const [userLabel                     , setUserLabel                  ] = useState(DEFAULT_USER_LABEL)                           ;
  const [assistantLabel                , setAssistantLabel             ] = useState(DEFAULT_ASSISTANT_LABEL)                      ;
  const [markdownExtension             , setMarkdownExtension          ] = useState<MarkdownExtension>(DEFAULT_MARKDOWN_EXTENSION);
  const [frontmatterTemplate           , setFrontmatterTemplate        ] = useState(DEFAULT_MDX_FRONTMATTER)                      ;
  const [saveStatus                    , setSaveStatus                 ] = useState<'idle' | 'saved'>('idle')                     ;
  const manifest      = chrome.runtime.getManifest();
  const versionText   = [manifest.version, manifest.version_name].filter(Boolean).join(' ');
  const isMdxSelected = markdownExtension === '.mdx';

  React.useEffect(() => {
    chrome.storage.sync.get(['startOffset','stopOffset','userLabel','assistantLabel','markdownExtension','mdxFrontmatter','autoAdvanceStartOffset','secondsBetweenChatDownloads'], (result: StoredOptions) => {
      const start = Number(result.startOffset ?? DEFAULT_START_OFFSET);
      const stop = result.stopOffset ?? (start + Number(DEFAULT_MAX_CHATS_TO_EXPORT));
      setStartOffset(start);
      setChatsToExport(deriveChatsToExport(start, stop));
      setUserLabel(result.userLabel || DEFAULT_USER_LABEL);
      setAssistantLabel(result.assistantLabel || DEFAULT_ASSISTANT_LABEL);
      setMarkdownExtension(normalizeMarkdownExtension(result.markdownExtension));
      setFrontmatterTemplate(result.mdxFrontmatter || DEFAULT_MDX_FRONTMATTER);
      setAutoAdvance(result.autoAdvanceStartOffset ?? DEFAULT_AUTO_ADVANCE_START_OFFSET);
      setSecondsBetweenChatDownloads(Number(result.secondsBetweenChatDownloads ?? DEFAULT_SECONDS_BETWEEN_CHAT_DOWNLOADS));
    });
  }, []);

  function save(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedStartOffset = Math.max(Number(startOffset) || 0, 0);
    const chatsToExportCount = chatsToExport.trim() === '' ? -1 : Math.max(Number(chatsToExport), 0);
    const stopOffset = chatsToExportCount <= 0 ? -1 : normalizedStartOffset + chatsToExportCount;
    const normalizedSeconds = Number.isFinite(Number(secondsBetweenChatDownloads))
      ? Math.max(Number(secondsBetweenChatDownloads), 0)
      : DEFAULT_SECONDS_BETWEEN_CHAT_DOWNLOADS;

    chrome.storage.sync.set({
      startOffset: normalizedStartOffset,
      stopOffset,
      userLabel: userLabel || DEFAULT_USER_LABEL,
      assistantLabel: assistantLabel || DEFAULT_ASSISTANT_LABEL,
      markdownExtension,
      mdxFrontmatter: frontmatterTemplate || DEFAULT_MDX_FRONTMATTER,
      autoAdvanceStartOffset: autoAdvance,
      secondsBetweenChatDownloads: normalizedSeconds,
    }, () => {
      setSaveStatus('saved');
      window.setTimeout(() => setSaveStatus('idle'), 1800);
    });
  }

  return (
    <main className="min-h-svh text-foreground">
      <form onSubmit={save} className="max-w-[1228px] bg-background px-8 pt-8 pb-[30px] shadow-[0_1px_3px_rgb(0_0_0/0.045)]">
        <header>
          <h1 className={cn("leading-tight font-bold tracking-[-0.035em]", textStyles.pageTitle)}>
            Options
          </h1>
          <p className={cn("mt-2 leading-7 text-muted-foreground", textStyles.label)}>
            Version {versionText}
          </p>
        </header>

        <Section title="Chat Export">
          <SettingRow title="Skip newest chats" description="0 = start from your newest chat.">
            <OptionsInput type="number" min="0" value={startOffset} onChange={(event) => setStartOffset(Number(event.target.value || 0))} />
          </SettingRow>
          <SettingRow title="Max chats to export" description="Leave empty to export all remaining chats after the skipped ones.">
            <OptionsInput type="number" min="0" placeholder="All remaining chats" value={chatsToExport} onChange={(event) => setChatsToExport(event.target.value)} />
          </SettingRow>
          <SettingRow
            title="Auto-advance skip newest chats"
            description={<><span>After a successful all-chats backup, automatically skip the chats</span><br /><span>that were just exported next time.</span></>}
          >
            <Checkbox checked={autoAdvance} onCheckedChange={(checked) => setAutoAdvance(checked === true)} className="mt-0.5 size-7 rounded-md [&_svg]:size-5" />
          </SettingRow>
        </Section>

        <Section title="Download Behavior">
          <SettingRow
            title="Seconds between chat downloads"
            description={<><span>Delay between individual chat download requests.</span><br /><span>Higher values are slower but gentler. Default is 2 seconds.</span></>}
          >
            <OptionsInput type="number" min="0" step="0.5" value={secondsBetweenChatDownloads} onChange={(event) => setSecondsBetweenChatDownloads(Number(event.target.value || DEFAULT_SECONDS_BETWEEN_CHAT_DOWNLOADS))} />
          </SettingRow>
          <SettingRow
            title="Delay between requests (seconds)"
            description={<><span>Delay between individual chat download requests.</span><br /><span>Higher values are slower but gentler. Default is 2 seconds.</span></>}
          >
            <OptionsInput type="number" min="0" step="0.5" value={secondsBetweenChatDownloads} onChange={(event) => setSecondsBetweenChatDownloads(Number(event.target.value || DEFAULT_SECONDS_BETWEEN_CHAT_DOWNLOADS))} />
          </SettingRow>
        </Section>

        <Section title="Labels">
          <SettingRow title="User label" description="Supports plain text, markdown, or HTML.">
            <OptionsInput value={userLabel} onChange={(event) => setUserLabel(event.target.value)} />
          </SettingRow>
          <SettingRow title="Assistant label" description="Supports plain text, markdown, or HTML.">
            <OptionsInput value={assistantLabel} onChange={(event) => setAssistantLabel(event.target.value)} />
          </SettingRow>
        </Section>

        <Section title="Markdown Export">
          <div className="space-y-5">
            <div>
              <Label className={cn("leading-7 font-medium tracking-[-0.02em]", textStyles.label)}>
                Markdown file extension
              </Label>
              <RadioGroup value={markdownExtension} onValueChange={(value) => setMarkdownExtension(normalizeMarkdownExtension(value))} className="mt-2 gap-3">
                <div className="flex items-center gap-3">
                  <RadioGroupItem id="extension-md" value=".md" className="size-5" />
                  <Label htmlFor="extension-md" className={cn("leading-7 font-normal", textStyles.description)}>.md</Label>
                </div>
                <div className="flex items-center gap-3">
                  <RadioGroupItem id="extension-mdx" value=".mdx" className="size-5" />
                  <Label htmlFor="extension-mdx" className={cn("leading-7 font-normal", textStyles.description)}>.mdx</Label>
                </div>
              </RadioGroup>
              <p className={cn("mt-2 leading-6 text-muted-foreground", textStyles.description)}>
                Use .mdx if you want frontmatter support.
              </p>
            </div>

            <div>
              <Label htmlFor="frontmatter-template" className={cn("leading-7 font-normal", textStyles.description)}>
                Default frontmatter for .mdx
              </Label>
              <Textarea
                id="frontmatter-template"
                disabled={!isMdxSelected}
                value={frontmatterTemplate}
                onChange={(event) => setFrontmatterTemplate(event.target.value)}
                className={cn("mt-3 min-h-[118px] resize-none rounded-lg border-input bg-muted/25 px-2 py-2 font-mono leading-7 shadow-xs disabled:cursor-not-allowed disabled:opacity-50", textStyles.textarea)}
              />
              <p className={cn("mt-3 leading-6 text-muted-foreground", textStyles.helper)}>
                Enabled only when .mdx is selected. Use {"{{title}}"} to insert the chat title.
              </p>
            </div>
          </div>
        </Section>

        <Card className="mt-[30px] gap-0 border border-border p-5 shadow-[0_1px_2px_rgb(0_0_0/0.025)] ring-0">
          <Button
            type="submit"
            className={cn(
              "h-[50px] w-fit cursor-pointer gap-3 rounded-lg px-6 font-semibold transition-colors",
              saveStatus === 'saved' && "bg-emerald-600 text-white hover:bg-emerald-600",
              textStyles.button
            )}
          >
            {saveStatus === 'saved' ? <Check className="size-5" /> : <Save className="size-5" />}
            {saveStatus === 'saved' ? 'Saved' : 'Save'}
          </Button>
        </Card>
      </form>
    </main>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
