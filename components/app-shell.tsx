'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSyncExternalStore } from 'react';
import {
  Activity,
  CalendarDays,
  ChartNoAxesCombined,
  CircleGauge,
  Crosshair,
  Eye,
  EyeOff,
  Gauge,
  ImageUp,
  LayoutDashboard,
  Moon,
  Plus,
  RefreshCw,
  Settings,
  ShieldCheck,
  ShieldAlert,
  Sparkles,
  Sun,
  WalletMinimal,
  WalletCards,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { relativeTime } from '@/lib/analytics';
import {
  usePortfolio,
  type RefreshState,
} from '@/components/portfolio-provider';

const navItems = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/positions', label: 'Positions', icon: WalletCards },
  { href: '/wallets', label: 'Import', icon: WalletMinimal },
  { href: '/margin', label: 'Margin', icon: Gauge },
  { href: '/platforms', label: 'Platforms', icon: ShieldAlert },
  { href: '/targets', label: 'Targets', icon: Crosshair },
  { href: '/analytics', label: 'Analytics', icon: CircleGauge },
  { href: '/calendar', label: 'P&L Calendar', icon: CalendarDays },
  { href: '/settings', label: 'Settings', icon: Settings },
];

const THEME_EVENT = 'tessera-theme-change';

function subscribeTheme(onStoreChange: () => void) {
  window.addEventListener(THEME_EVENT, onStoreChange);
  return () => window.removeEventListener(THEME_EVENT, onStoreChange);
}

function getThemeSnapshot(): 'light' | 'dark' {
  return document.documentElement.classList.contains('light')
    ? 'light'
    : 'dark';
}

function getServerThemeSnapshot(): 'dark' {
  return 'dark';
}

const pageMeta: Record<string, { title: string; eyebrow: string }> = {
  '/': { title: 'Portfolio overview', eyebrow: 'Summary' },
  '/positions': { title: 'Position ledger', eyebrow: 'Spot & perpetuals' },
  '/wallets': { title: 'Position import', eyebrow: 'Wallets & screenshots' },
  '/margin': { title: 'Margin desk', eyebrow: 'Leverage & liquidation' },
  '/platforms': {
    title: 'Platform risk',
    eyebrow: 'Venue liquidation analytics',
  },
  '/targets': { title: 'Target planner', eyebrow: 'Scenario modeling' },
  '/analytics': {
    title: 'Portfolio analytics',
    eyebrow: 'Allocation & performance',
  },
  '/calendar': { title: 'P&L calendar', eyebrow: 'UTC performance journal' },
  '/settings': { title: 'Local preferences', eyebrow: 'Privacy & data' },
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const {
    portfolio,
    analytics,
    hydrated,
    refreshState,
    refreshPortfolio,
    openAdd,
    openScreenshotImport,
    setPrivacyMode,
    dismissSample,
    startFresh,
  } = usePortfolio();
  const meta = pageMeta[pathname] ?? pageMeta['/'];
  const defaultType =
    pathname === '/margin' || pathname === '/platforms' ? 'perp' : 'spot';
  const theme = useSyncExternalStore(
    subscribeTheme,
    getThemeSnapshot,
    getServerThemeSnapshot,
  );

  function toggleTheme() {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(nextTheme);
    document.documentElement.style.colorScheme = nextTheme;
    window.localStorage.setItem('tessera.theme', nextTheme);
    window.dispatchEvent(new Event(THEME_EVENT));
  }

  if (!hydrated) return <LoadingScreen />;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="min-h-screen lg:grid lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="hidden border-r border-border bg-card px-5 py-6 lg:flex lg:flex-col">
          <Brand />
          <nav className="mt-9 space-y-1" aria-label="Primary navigation">
            {navItems.map((item) => (
              <NavItem
                key={item.href}
                {...item}
                active={pathname === item.href}
              />
            ))}
          </nav>

          <div className="mt-auto rounded-xl border border-border bg-muted/55 p-4">
            <div className="flex items-center gap-2 text-[12px] font-semibold text-foreground">
              <ShieldCheck className="size-4 text-primary" /> Local data
            </div>
            <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
              Saved automatically in this browser. Wallet access is read-only.
            </p>
          </div>
        </aside>

        <section className="min-w-0 pb-20 lg:pb-0">
          <header className="sticky top-0 z-30 flex h-[78px] items-center justify-between border-b border-border bg-background/95 px-4 sm:px-6 xl:px-9">
            <div className="flex min-w-0 items-center gap-3">
              <div className="lg:hidden">
                <Brand compact />
              </div>
              <div className="hidden min-w-0 sm:block">
                <div className="flex items-center gap-2">
                  <p className="truncate text-[15px] font-semibold tracking-[-0.025em] text-foreground">
                    {meta.title}
                  </p>
                  <span className="rounded-md border border-border bg-muted px-2 py-0.5 text-[9px] font-medium text-muted-foreground">
                    {meta.eyebrow}
                  </span>
                </div>
                <MarketStatus
                  state={refreshState}
                  lastUpdated={analytics.lastUpdated}
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={toggleTheme}
                aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
                title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
                className="grid size-9 place-items-center rounded-lg border border-border bg-card text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                {theme === 'dark' ? (
                  <Sun className="size-4" />
                ) : (
                  <Moon className="size-4" />
                )}
              </button>
              <button
                onClick={() => setPrivacyMode(!portfolio.privacyMode)}
                aria-label={
                  portfolio.privacyMode
                    ? 'Show portfolio balances'
                    : 'Hide portfolio balances'
                }
                className="grid size-9 place-items-center rounded-lg border border-border bg-card text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                {portfolio.privacyMode ? (
                  <Eye className="size-4" />
                ) : (
                  <EyeOff className="size-4" />
                )}
              </button>
              <Button
                disabled={refreshState === 'loading'}
                onClick={() => void refreshPortfolio()}
                aria-label="Refresh prices and connected wallets"
                title="Refresh prices and connected wallets"
                variant="outline"
                className="h-9 rounded-lg border-border bg-card px-3 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <RefreshCw
                  className={`size-3.5 ${refreshState === 'loading' ? 'animate-spin' : ''}`}
                />
                <span className="hidden md:inline">Refresh wallets</span>
              </Button>
              <Button
                onClick={openScreenshotImport}
                variant="outline"
                aria-label="Import position screenshots"
                title="Import screenshots"
                className="h-9 rounded-lg border-border bg-card px-3 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <ImageUp className="size-3.5" />
                <span className="hidden xl:inline">Import screenshot</span>
              </Button>
              <Button
                onClick={() => openAdd(defaultType)}
                className="h-9 rounded-lg bg-primary px-3.5 font-semibold text-primary-foreground hover:opacity-90"
              >
                <Plus className="size-4" />
                <span className="hidden sm:inline">Enter position</span>
                <span className="sm:hidden">Add</span>
              </Button>
            </div>
          </header>

          <div className="mx-auto max-w-[1500px] px-4 py-5 sm:px-6 sm:py-7 xl:px-9 xl:py-8">
            {portfolio.sampleMode && (
              <div className="mb-5 flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary/[0.06] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
                  <div>
                    <p className="text-[11px] font-medium">
                      Sample portfolio is active
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Includes crypto holdings, a leveraged perpetual, and
                      target plans. Start fresh keeps saved import profiles.
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={dismissSample}
                    className="text-muted-foreground"
                  >
                    Keep sample
                  </Button>
                  <Button
                    size="sm"
                    onClick={startFresh}
                    className="bg-primary text-primary-foreground hover:opacity-90"
                  >
                    Start fresh
                  </Button>
                </div>
              </div>
            )}
            {children}
            <footer className="mt-8 flex flex-col gap-2 border-t border-border py-5 text-[10px] leading-4 text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <p>
                Prices and liquidation levels are estimates. Nothing here is
                financial advice.
              </p>
              <p>
                Local storage & OCR · CoinGecko · Yahoo Finance · Blockscout ·
                Hyperliquid · Lighter
              </p>
            </footer>
          </div>
        </section>
      </div>

      <nav
        aria-label="Mobile navigation"
        className="fixed inset-x-3 bottom-3 z-40 grid grid-cols-9 rounded-xl border border-border bg-card/95 p-1.5 shadow-lg backdrop-blur-xl lg:hidden"
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-label={item.label}
              className={`grid h-11 place-items-center rounded-lg transition ${active ? 'bg-muted font-semibold text-primary' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <Icon className="size-4" />
              <span className="sr-only">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </main>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3 px-2">
      <div className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
        <ChartNoAxesCombined className="size-[18px]" strokeWidth={2.4} />
      </div>
      {!compact && (
        <div>
          <p className="text-[17px] font-semibold tracking-[-0.035em]">
            Tessera
          </p>
          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Portfolio tracker
          </p>
        </div>
      )}
    </div>
  );
}

function NavItem({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string;
  label: string;
  icon: typeof Activity;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex w-full items-center gap-3 rounded-lg px-3.5 py-3 text-[14px] transition ${active ? 'bg-muted font-semibold text-foreground' : 'text-muted-foreground hover:bg-muted/65 hover:text-foreground'}`}
    >
      <Icon className={`size-4 ${active ? 'text-primary' : ''}`} />
      {label}
    </Link>
  );
}

function MarketStatus({
  state,
  lastUpdated,
}: {
  state: RefreshState;
  lastUpdated: number;
}) {
  const label =
    state === 'loading'
      ? 'Updating market prices'
      : state === 'error'
        ? 'Cached prices'
        : state === 'warning'
          ? 'Partially updated'
          : lastUpdated
            ? `Prices synced ${relativeTime(lastUpdated)}`
            : 'Ready to sync';
  return (
    <div className="mt-1.5 flex items-center gap-1.5 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
      <span
        className={`size-1.5 rounded-full ${state === 'error' ? 'bg-destructive' : state === 'warning' ? 'bg-[var(--warning)]' : 'bg-[var(--positive)]'}`}
      />
      {label}
    </div>
  );
}

function LoadingScreen() {
  return (
    <main className="grid min-h-screen place-items-center bg-background text-foreground">
      <div className="text-center">
        <div className="mx-auto grid size-11 place-items-center rounded-xl bg-primary text-primary-foreground">
          <ChartNoAxesCombined className="size-5" />
        </div>
        <p className="mt-4 text-xs font-medium">Opening Tessera</p>
        <div className="mx-auto mt-3 h-0.5 w-24 overflow-hidden rounded-full bg-muted">
          <div className="h-full w-1/2 animate-pulse rounded-full bg-primary" />
        </div>
      </div>
    </main>
  );
}
