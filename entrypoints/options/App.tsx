import { useEffect, useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { rpc } from '@/lib/rpc';
import { BRIDGE_VERSION } from '@/lib/protocol';
import type { Settings } from '@/lib/protocol';
import { DEFAULT_SETTINGS, getSettings, settingsItem } from '@/lib/settings';
import { applyThemeValue } from '@/lib/theme';
import { cn } from '@/lib/utils';
import {
  Activity,
  Check,
  Code,
  Copy,
  ExternalLink,
  Loader2,
  Monitor,
  Moon,
  Save,
  Server,
  Stethoscope,
  Sun,
  Terminal,
  Timer,
} from 'lucide-react';

export default function App() {
  const [form, setForm] = useState<Settings>({ ...DEFAULT_SETTINGS });
  const [loaded, setLoaded] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [diagnostics, setDiagnostics] = useState<string | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [copiedType, setCopiedType] = useState<string | null>(null);

  useEffect(() => {
    void getSettings().then((s) => {
      setForm(s);
      setLoaded(true);
      applyThemeValue(s.theme);
    });
    const un = settingsItem.watch((s) => {
      if (s) {
        setForm((prev) => ({ ...prev, theme: s.theme }));
        applyThemeValue(s.theme);
      }
    });
    return () => un();
  }, []);

  function patch(p: Partial<Settings>) {
    setForm((f) => ({ ...f, ...p }));
    setSavedAt(null);
  }

  async function save() {
    setSaving(true);
    try {
      await settingsItem.setValue(form);
      applyThemeValue(form.theme);
      setSavedAt(Date.now());
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    const t0 = performance.now();
    try {
      await rpc('bridge.ping', {}, 8000);
      setTestResult({ ok: true, message: `Pong in ${Math.round(performance.now() - t0)}ms — bridge is reachable` });
    } catch (err) {
      setTestResult({ ok: false, message: String(err instanceof Error ? err.message : err) });
    } finally {
      setTesting(false);
    }
  }

  async function runDiagnostics() {
    setDiagLoading(true);
    setDiagnostics(null);
    try {
      const result = await rpc<Record<string, unknown>>('chatgpt.diagnostics', {}, 60_000);
      setDiagnostics(JSON.stringify(result, null, 2));
    } catch (err) {
      setDiagnostics(`Diagnostics failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDiagLoading(false);
    }
  }

  async function copySnippet(type: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedType(type);
      setTimeout(() => setCopiedType(null), 2000);
    } catch {}
  }

  const num = (v: string, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };

  const httpUrl = form.serverUrl?.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://') ?? 'http://127.0.0.1:8787';

  const curlExample = `curl -X POST ${httpUrl}/ask \\
  -H "Content-Type: application/json" \\
  -d '{"prompt": "Explain quantum computing in two sentences"}'`;

  const pythonExample = `from openai import OpenAI

client = OpenAI(base_url="${httpUrl}/v1", api_key="none")

response = client.chat.completions.create(
    model="chatgpt-web",
    messages=[{"role": "user", "content": "Explain quantum computing in two sentences"}],
    stream=True,
)

for chunk in response:
    print(chunk.choices[0].delta.content or "", end="", flush=True)`;

  return (
    <div className="min-h-screen bg-background text-foreground antialiased selection:bg-primary/20">
      <header className="sticky top-0 z-10 border-b bg-background">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <img src="/logo.png" alt="" width={48} height={48} className="size-12 shrink-0 object-contain" />
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold tracking-tight">ChatGPT Bridge</h1>
              <p className="mt-0.5 text-xs text-muted-foreground">Your local ChatGPT connection</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div role="group" aria-label="Color theme" className="flex items-center gap-1 rounded-lg border bg-muted/40 p-1">
              {(
                [
                  ['light', Sun],
                  ['dark', Moon],
                  ['system', Monitor],
                ] as const
              ).map(([value, Icon]) => (
                <Button
                  key={value}
                  variant={form.theme === value ? 'secondary' : 'ghost'}
                  size="icon"
                  className="size-8"
                  onClick={async () => {
                    patch({ theme: value });
                    applyThemeValue(value);
                    const current = await getSettings();
                    await settingsItem.setValue({ ...current, theme: value });
                  }}
                  aria-label={`${value} theme`}
                  aria-pressed={form.theme === value}
                  title={`${value.charAt(0).toUpperCase()}${value.slice(1)} theme`}
                >
                  <Icon className="size-4" />
                </Button>
              ))}
            </div>
            <Button onClick={save} disabled={!loaded || saving} className="gap-2" aria-live="polite">
              {saving ? <Loader2 className="size-4 animate-spin" /> : savedAt ? <Check className="size-4" /> : <Save className="size-4" />}
              {saving ? 'Saving…' : savedAt ? 'Saved' : 'Save changes'}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold tracking-tight">Settings</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">Manage your connection, API access, and automation preferences.</p>
        </div>
        <Tabs defaultValue="connection" className="gap-6">
          <TabsList aria-label="Settings sections" className="grid h-auto w-full grid-cols-2 gap-1 p-1 sm:grid-cols-4">
            <TabsTrigger value="connection" className="min-h-9 gap-2 data-[state=active]:text-primary">
              <Server className="size-4" /> Connection
            </TabsTrigger>
            <TabsTrigger value="rest" className="min-h-9 gap-2 data-[state=active]:text-primary">
              <Terminal className="size-4" /> REST API
            </TabsTrigger>
            <TabsTrigger value="automation" className="min-h-9 gap-2 data-[state=active]:text-primary">
              <Timer className="size-4" /> Automation
            </TabsTrigger>
            <TabsTrigger value="diagnostics" className="min-h-9 gap-2 data-[state=active]:text-primary">
              <Stethoscope className="size-4" /> Diagnostics
            </TabsTrigger>
          </TabsList>

          {/* ── Connection Tab ────────────────────────────────────────── */}
          <TabsContent value="connection" className="min-w-0 space-y-5">
            <Card className="min-w-0 gap-5 shadow-xs">
              <CardHeader>
                <CardTitle className="text-base">Local connection</CardTitle>
                <CardDescription>
                  The native host starts your local server automatically when Chrome opens.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-2">
                  <Label htmlFor="server-url">WebSocket server URL</Label>
                  <Input
                    id="server-url"
                    aria-describedby="server-url-hint"
                    className="font-mono text-sm"
                    value={form.serverUrl}
                    onChange={(e) => patch({ serverUrl: e.target.value })}
                    placeholder="ws://127.0.0.1:8787"
                  />
                  <p id="server-url-hint" className="text-xs leading-relaxed text-muted-foreground">Keep it on 127.0.0.1 to prevent unauthorized external network access.</p>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="token">Shared secret token (optional)</Label>
                  <Input
                    id="token"
                    type="password"
                    className="font-mono text-sm"
                    value={form.token}
                    onChange={(e) => patch({ token: e.target.value })}
                    placeholder="Shared secret if token auth is enabled"
                  />
                </div>
                <Separator />
                <Row id="auto-reconnect" label="Auto-reconnect" hint="Retry the WebSocket with exponential backoff if disconnected">
                  <Switch id="auto-reconnect" aria-describedby="auto-reconnect-hint" checked={form.autoReconnect} onCheckedChange={(v) => patch({ autoReconnect: v })} />
                </Row>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="reconnect-delay">Reconnect base delay (ms)</Label>
                    <Input
                      id="reconnect-delay"
                      type="number"
                      min={250}
                      step={250}
                      value={form.reconnectDelayMs}
                      onChange={(e) => patch({ reconnectDelayMs: num(e.target.value, DEFAULT_SETTINGS.reconnectDelayMs) })}
                    />
                  </div>
                </div>
                <Separator />
                <Row id="auto-open-chatgpt" label="Auto-open ChatGPT on startup" hint="Ensure a ChatGPT tab exists whenever Chrome opens">
                  <Switch id="auto-open-chatgpt" aria-describedby="auto-open-chatgpt-hint" checked={form.autoOpenChatGPT} onCheckedChange={(v) => patch({ autoOpenChatGPT: v })} />
                </Row>
              </CardContent>
            </Card>

            <Card className="min-w-0 gap-5 shadow-xs">
              <CardHeader>
                <CardTitle className="text-base">Connection test</CardTitle>
                <CardDescription>Send a test ping through the WebSocket bridge.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button variant="outline" onClick={testConnection} disabled={testing} className="gap-1.5">
                  {testing ? <Loader2 className="size-4 animate-spin" /> : <Activity className="size-4 text-primary" />}
                  Test bridge ping
                </Button>
                {testResult && (
                  <p role="status" className={cn('rounded-lg border bg-muted/30 p-3 text-sm leading-relaxed', testResult.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive')}>
                    {testResult.ok ? '✓ ' : '✕ '}
                    {testResult.message}
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── REST API Tab ──────────────────────────────────────────── */}
          <TabsContent value="rest" className="min-w-0 space-y-5">
            <Card className="min-w-0 gap-5 shadow-xs">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Terminal className="size-4 text-primary" />
                  REST API endpoints
                </CardTitle>
                <CardDescription>
                  Directly call ChatGPT from curl, Python, Node, Go, or any local script.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-2 rounded-lg border bg-muted/30 p-4 text-xs">
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 break-all font-mono text-xs font-medium">POST {httpUrl}/ask</span>
                    <Badge variant="outline" className="text-[10px]">Simple REST</Badge>
                  </div>
                  <p className="break-words text-xs leading-relaxed text-muted-foreground">
                    Accepts <code>{JSON.stringify({ prompt: 'your question', stream: true })}</code>.
                  </p>
                </div>

                <div className="space-y-2 rounded-lg border bg-muted/30 p-4 text-xs">
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 break-all font-mono text-xs font-medium">POST {httpUrl}/v1/chat/completions</span>
                    <Badge variant="outline" className="text-[10px]">OpenAI compatible</Badge>
                  </div>
                  <p className="break-words text-xs leading-relaxed text-muted-foreground">
                    Drop-in replacement for OpenAI SDKs using <code>base_url="{httpUrl}/v1"</code>.
                  </p>
                </div>

                {/* cURL Example */}
                <div className="min-w-0 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="flex items-center gap-2 text-sm font-medium">
                      <Code className="size-3.5 text-primary" />
                      cURL request
                    </h3>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copySnippet('curl', curlExample)}
                      className="h-7 gap-1 px-2 text-xs"
                    >
                      {copiedType === 'curl' ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
                      {copiedType === 'curl' ? 'Copied' : 'Copy'}
                    </Button>
                  </div>
                  <pre tabIndex={0} className="max-w-full overflow-x-auto rounded-lg border bg-muted/30 p-4 font-mono text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {curlExample}
                  </pre>
                </div>

                {/* Python OpenAI SDK Example */}
                <div className="min-w-0 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="flex items-center gap-2 text-sm font-medium">
                      <Code className="size-3.5 text-primary" />
                      Python (OpenAI SDK)
                    </h3>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copySnippet('python', pythonExample)}
                      className="h-7 gap-1 px-2 text-xs"
                    >
                      {copiedType === 'python' ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
                      {copiedType === 'python' ? 'Copied' : 'Copy'}
                    </Button>
                  </div>
                  <pre tabIndex={0} className="max-w-full overflow-x-auto rounded-lg border bg-muted/30 p-4 font-mono text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {pythonExample}
                  </pre>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Automation Tab ────────────────────────────────────────── */}
          <TabsContent value="automation" className="min-w-0 space-y-5">
            <Card className="min-w-0 gap-5 shadow-xs">
              <CardHeader>
                <CardTitle className="text-base">Timeouts and streaming</CardTitle>
                <CardDescription>Fine-tune task timeouts and UI streaming throttles.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-6 sm:grid-cols-3">
                <div className="grid gap-2">
                  <Label htmlFor="ask-timeout">Ask timeout (s)</Label>
                  <Input
                    id="ask-timeout"
                    type="number"
                    min={5}
                    value={form.askTimeoutMs / 1000}
                    onChange={(e) => patch({ askTimeoutMs: num(e.target.value, 300) * 1000 })}
                  />
                  <p className="text-xs leading-relaxed text-muted-foreground">Overall wait for one answer.</p>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="gen-timeout">Generation cap (s)</Label>
                  <Input
                    id="gen-timeout"
                    type="number"
                    min={10}
                    value={form.generationTimeoutMs / 1000}
                    onChange={(e) => patch({ generationTimeoutMs: num(e.target.value, 600) * 1000 })}
                  />
                  <p className="text-xs leading-relaxed text-muted-foreground">Hard cap; generation stops after this.</p>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="stream-batch">Delta batch (ms)</Label>
                  <Input
                    id="stream-batch"
                    type="number"
                    min={30}
                    step={10}
                    value={form.streamBatchMs}
                    onChange={(e) => patch({ streamBatchMs: num(e.target.value, DEFAULT_SETTINGS.streamBatchMs) })}
                  />
                  <p className="text-xs leading-relaxed text-muted-foreground">Throttle for streamed task.delta events.</p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Diagnostics Tab ───────────────────────────────────────── */}
          <TabsContent value="diagnostics" className="min-w-0 space-y-5">
            <Card className="min-w-0 gap-5 shadow-xs">
              <CardHeader>
                <CardTitle className="text-base">Page diagnostics</CardTitle>
                <CardDescription>
                  Inspects the active ChatGPT tab and reports which DOM selectors currently match.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4" aria-busy={diagLoading}>
                <Button variant="outline" onClick={runDiagnostics} disabled={diagLoading} className="gap-1.5">
                  {diagLoading ? <Loader2 className="size-4 animate-spin" /> : <Stethoscope className="size-4 text-primary" />}
                  Run diagnostics
                </Button>
                {diagnostics && (
                  <ScrollArea className="h-72 min-w-0 rounded-lg border bg-muted/30">
                    <pre className="whitespace-pre-wrap break-all p-4 font-mono text-xs leading-relaxed">{diagnostics}</pre>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>

            <Card className="min-w-0 gap-5 shadow-xs">
              <CardHeader>
                <CardTitle className="text-base">About ChatGPT Bridge</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <Badge variant="secondary" className="font-mono tabular-nums">v{BRIDGE_VERSION}</Badge>
                <Separator className="bg-border/60" />
                <p className="break-words text-sm leading-relaxed text-muted-foreground">
                  Bridge communication is orchestrated through a local WebSocket server (<code className="break-all">{form.serverUrl}</code>) with HTTP REST endpoints (<code>POST /ask</code>, <code>POST /v1/chat/completions</code>) auto-spawned via Chrome Native Messaging.
                </p>
                <div className="pt-1">
                  <a
                    href="https://chatgpt.com"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                  >
                    Open ChatGPT Web
                    <ExternalLink className="size-3" />
                  </a>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function Row({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0 space-y-1">
        <Label htmlFor={id} className="cursor-pointer text-sm font-medium leading-snug">{label}</Label>
        {hint && <p id={`${id}-hint`} className="text-xs leading-relaxed text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}
