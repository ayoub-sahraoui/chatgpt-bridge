import { useEffect, useState } from 'react';
import { browser } from '#imports';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { rpc } from '@/lib/rpc';
import { DEFAULT_SETTINGS, getSettings, settingsItem, statusItem } from '@/lib/settings';
import { BRIDGE_VERSION } from '@/lib/protocol';
import type { BridgeStatus, Settings, WsState } from '@/lib/protocol';
import { applyThemeValue } from '@/lib/theme';
import { cn } from '@/lib/utils';
import {
  Check,
  Copy,
  ExternalLink,
  Loader2,
  Moon,
  RefreshCw,
  Settings2,
  Sun,
  X,
  Zap,
} from 'lucide-react';

interface StateMeta {
  label: string;
  dot: string;
}

const STATE_META: Record<WsState, StateMeta> = {
  connected: {
    label: 'Ready',
    dot: 'bg-emerald-500',
  },
  connecting: {
    label: 'Connecting',
    dot: 'bg-amber-500 animate-pulse',
  },
  disconnected: {
    label: 'Disconnected',
    dot: 'bg-rose-500',
  },
  disabled: {
    label: 'Disabled',
    dot: 'bg-zinc-400 dark:bg-zinc-600',
  },
};

export default function App({ embedded = false, onClose }: { embedded?: boolean; onClose?: () => void }) {
  const [settings, setSettings] = useState<Settings>({ ...DEFAULT_SETTINGS });
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [opening, setOpening] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pinging, setPinging] = useState(false);
  const [pingResult, setPingResult] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);

  useEffect(() => {
    void getSettings().then((s) => {
      setSettings(s);
      applyThemeValue(s.theme);
    });
    void statusItem.getValue().then(setStatus);
    const un1 = settingsItem.watch((s) => {
      if (s) {
        setSettings(s);
        applyThemeValue(s.theme);
      }
    });
    const un2 = statusItem.watch(() => void statusItem.getValue().then(setStatus));
    return () => {
      un1();
      un2();
    };
  }, []);

  const meta = STATE_META[status?.wsState ?? 'disabled'];
  const isDark =
    settings.theme === 'dark' ||
    (settings.theme === 'system' &&
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);

  async function toggleTheme() {
    const nextTheme: 'light' | 'dark' = isDark ? 'light' : 'dark';
    applyThemeValue(nextTheme);
    const nextSettings = { ...settings, theme: nextTheme };
    setSettings(nextSettings);
    await settingsItem.setValue(nextSettings);
  }

  async function toggleEnabled(checked: boolean) {
    const next = { ...settings, enabled: checked };
    setSettings(next);
    await settingsItem.setValue(next);
  }

  async function openChatGPT() {
    setOpening(true);
    try {
      await rpc('chatgpt.ensureTab');
      if (embedded) onClose?.();
      else window.close();
    } finally {
      setOpening(false);
    }
  }

  async function copyCurl() {
    try {
      await navigator.clipboard.writeText(curlCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard fallback
    }
  }

  async function pingBridge() {
    setPinging(true);
    setPingResult(null);
    const t0 = performance.now();
    try {
      await rpc('bridge.ping', {}, 3000);
      const ms = Math.round(performance.now() - t0);
      setPingResult(`${ms}ms`);
    } catch {
      setPingResult('err');
    } finally {
      setPinging(false);
      setTimeout(() => setPingResult(null), 3000);
    }
  }

  async function retryConnection() {
    setReconnecting(true);
    try {
      await rpc('bridge.ping', {}, 2000);
    } catch {
      // ping triggers connection check in background
    } finally {
      setTimeout(() => setReconnecting(false), 800);
    }
  }

  const port = status?.serverUrl?.split(':').pop() ?? '8787';
  const hostLabel = `127.0.0.1:${port}`;
  const httpUrl = `http://${hostLabel}`;

  const curlCommand = `curl -X POST ${httpUrl}/ask \\
  -H "Content-Type: application/json" \\
  -d '{"prompt": "Hello!"}'`;

  const statusBadge = (
    <Badge variant="outline" className="gap-1.5 rounded-full px-2 py-1 text-[11px]" role="status">
      <span className={cn('size-1.5 rounded-full', meta.dot)} />
      {meta.label}
    </Badge>
  );

  return (
    <div className="flex w-full flex-col overflow-hidden rounded-2xl border bg-background text-foreground">
      <header className="flex items-center justify-between gap-3 border-b bg-card px-4 py-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <img src="/icon/128.png" alt="" width={40} height={40} className="size-10 shrink-0 object-contain" />
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold tracking-tight">ChatGPT Bridge</h1>
            <p className="mt-0.5 truncate font-mono text-[11px] tabular-nums text-muted-foreground">{hostLabel}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            className="size-8 text-muted-foreground"
            title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
            aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>
          {embedded ? (
            <Button variant="ghost" size="icon" onClick={onClose} className="size-8 text-muted-foreground" aria-label="Close panel" title="Close panel">
              <X className="size-4" />
            </Button>
          ) : statusBadge}
        </div>
      </header>

      <main className="space-y-4 p-4">
        <Card className="gap-0 overflow-hidden py-0 shadow-xs">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Label htmlFor="bridge-enabled" className="cursor-pointer text-[13px] font-medium">
                    Bridge server
                  </Label>
                  {embedded && statusBadge}
                </div>
                <p id="bridge-enabled-hint" className="text-xs leading-relaxed text-muted-foreground">
                  {settings.enabled ? `Listening on port ${port}` : 'Paused. Incoming requests are disabled.'}
                </p>
              </div>
              <Switch
                id="bridge-enabled"
                checked={settings.enabled}
                onCheckedChange={toggleEnabled}
                aria-describedby="bridge-enabled-hint"
              />
            </div>

            {settings.enabled && status && status.wsState !== 'connected' && (
              <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/40 p-2.5" role="status">
                <p className="min-w-0 text-xs leading-relaxed text-muted-foreground">
                  {status.wsState === 'connecting' ? 'Connecting to local host…' : 'Local host is offline.'}
                </p>
                <Button variant="outline" size="sm" onClick={retryConnection} disabled={reconnecting} className="h-7 px-2 text-xs">
                  <RefreshCw className={cn('size-3', reconnecting && 'animate-spin')} />
                  Retry
                </Button>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <Button onClick={openChatGPT} disabled={opening} className="gap-1.5 px-2 text-xs">
                {opening ? <Loader2 className="size-3.5 animate-spin" /> : <ExternalLink className="size-3.5" />}
                Open ChatGPT
              </Button>
              <Button variant="outline" onClick={() => void browser.runtime.openOptionsPage()} className="gap-1.5 text-xs">
                <Settings2 className="size-3.5 text-muted-foreground" />
                Settings
              </Button>
            </div>
          </CardContent>

          <dl className="space-y-3 border-t bg-muted/20 px-4 py-3 text-xs">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">ChatGPT tab</dt>
              <dd className="inline-flex items-center gap-1.5 font-medium">
                <span className={cn('size-1.5 rounded-full', status?.chatgptTabId != null ? 'bg-emerald-500' : 'bg-muted-foreground/50')} />
                {status?.chatgptTabId != null ? 'Ready' : 'Not detected'}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">Active task</dt>
              <dd className="font-mono tabular-nums text-muted-foreground">
                {status?.activeTaskId ? (
                  <span className="inline-flex items-center gap-1.5 text-primary" title={status.activeTaskId}>
                    <Loader2 className="size-3 animate-spin" />
                    {status.activeTaskId.slice(0, 8)}…
                  </span>
                ) : 'Idle'}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">Native host</dt>
              <dd className="font-mono tabular-nums text-muted-foreground">
                {status?.wsState === 'connected' ? `Active (:${port})` : 'Offline'}
              </dd>
            </div>
          </dl>
        </Card>

        <Card className="gap-3 p-3 shadow-xs">
          <div className="flex items-center justify-between gap-2">
            <h2 className="inline-flex items-center gap-2 font-mono text-xs">
              <Badge variant="secondary" className="rounded-sm px-1.5 py-0.5 font-mono text-[10px] text-primary">POST</Badge>
              /ask
            </h2>
            <div className="flex items-center gap-1" aria-live="polite">
              <Button
                variant="ghost"
                size="sm"
                onClick={pingBridge}
                disabled={pinging || status?.wsState !== 'connected'}
                className="h-7 gap-1 px-2 text-xs text-muted-foreground"
                title="Send test ping"
              >
                {pinging ? <Loader2 className="size-3 animate-spin" /> : <Zap className="size-3" />}
                {pingResult ?? 'Ping'}
              </Button>
              <Button variant="outline" size="sm" onClick={copyCurl} className="h-7 gap-1.5 px-2 text-xs">
                {copied ? <Check className="size-3 text-emerald-600 dark:text-emerald-400" /> : <Copy className="size-3" />}
                {copied ? 'Copied' : 'Copy cURL'}
              </Button>
            </div>
          </div>
          <pre tabIndex={0} aria-label="Example cURL request" className="overflow-x-auto rounded-lg border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <code>{curlCommand}</code>
          </pre>
        </Card>
      </main>

      <footer className="flex items-center justify-between gap-3 border-t px-4 py-3 text-[11px] text-muted-foreground">
        <a href={`${httpUrl}/docs`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-sm transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
          API docs <ExternalLink className="size-3" />
        </a>
        <span className="font-mono tabular-nums">v{BRIDGE_VERSION}</span>
        <a href="https://chatgpt.com" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-sm transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
          chatgpt.com <ExternalLink className="size-3" />
        </a>
      </footer>
    </div>
  );
}
