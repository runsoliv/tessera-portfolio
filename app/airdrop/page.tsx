'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ArrowUpRight,
  BookOpen,
  Clock3,
  Coins,
  Gift,
  RefreshCw,
} from 'lucide-react';
import { PageIntro, Panel, PanelHeader } from '@/components/page-primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AIRDROP_DOCS_CHECKED,
  AIRDROP_SOURCES,
  RH_AIRDROP_POOL,
  airdropDeadlineUtc,
  estimateAirdrop,
  parseAirdropNumber,
  type AirdropQuote,
} from '@/lib/airdrop';

const PREFS_KEY = 'tessera-rh-airdrop-planner-v1';
const QUOTE_KEY = 'tessera-rh-airdrop-lit-quote-v1';
const INITIAL = {
  mode: 'points' as 'points' | 'tokens',
  points: '',
  totalPoints: '',
  pool: String(RH_AIRDROP_POOL),
  tokens: '',
  manualPrice: '',
  targetPrice: '',
  costs: '',
  deadline: '',
};
type Preferences = typeof INITIAL;

export default function AirdropPage() {
  const [prefs, setPrefs] = useState<Preferences>(INITIAL);
  const [ready, setReady] = useState(false);
  const [quote, setQuote] = useState<AirdropQuote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [now, setNow] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/airdrop', { cache: 'no-store' });
      if (!response.ok) throw new Error('Price refresh unavailable');
      const next = (await response.json()) as AirdropQuote;
      if (!validQuote(next)) throw new Error('Invalid LIT quote');
      setQuote(next);
      try {
        window.localStorage.setItem(QUOTE_KEY, JSON.stringify(next));
      } catch {
        /* Device storage is optional. */
      }
    } catch {
      setError(
        'Price refresh unavailable. Keeping the last saved quote, if available.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const start = window.setTimeout(() => {
      try {
        const saved: unknown = JSON.parse(
          window.localStorage.getItem(PREFS_KEY) ?? 'null',
        );
        if (saved && typeof saved === 'object') {
          const restored = { ...INITIAL };
          for (const key of Object.keys(INITIAL) as (keyof Preferences)[]) {
            const value = (saved as Record<string, unknown>)[key];
            if (key === 'mode') {
              if (value === 'points' || value === 'tokens')
                restored.mode = value;
            } else if (typeof value === 'string') restored[key] = value;
          }
          setPrefs(restored);
        }
      } catch {
        /* Use empty inputs if saved preferences are unreadable. */
      }
      try {
        const cached = JSON.parse(
          window.localStorage.getItem(QUOTE_KEY) ?? 'null',
        );
        if (validQuote(cached)) setQuote(cached);
      } catch {
        /* Fetch a fresh quote. */
      }
      setReady(true);
      setNow(Date.now());
      void refresh();
    }, 0);
    const clock = window.setInterval(() => setNow(Date.now()), 1_000);
    const prices = window.setInterval(() => void refresh(), 60_000);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(clock);
      window.clearInterval(prices);
    };
  }, [refresh]);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* Session remains usable. */
    }
  }, [prefs, ready]);

  const update = (key: keyof Preferences, value: string) =>
    setPrefs((current) => ({ ...current, [key]: value }));
  const currentPrice =
    prefs.manualPrice !== ''
      ? parseAirdropNumber(prefs.manualPrice)
      : (quote?.price ?? null);
  const result = estimateAirdrop({
    mode: prefs.mode,
    points: parseAirdropNumber(prefs.points),
    totalPoints: parseAirdropNumber(prefs.totalPoints),
    pool: parseAirdropNumber(prefs.pool),
    tokens: parseAirdropNumber(prefs.tokens),
    currentPrice,
    targetPrice: parseAirdropNumber(prefs.targetPrice),
    costs: parseAirdropNumber(prefs.costs),
  });
  const points = parseAirdropNumber(prefs.points);
  const total = parseAirdropNumber(prefs.totalPoints);
  const invalidTotal =
    prefs.mode === 'points' &&
    total !== null &&
    (total === 0 || (points !== null && points > total));
  const deadline = airdropDeadlineUtc(prefs.deadline);
  const remaining =
    deadline !== null && now !== null ? Math.max(0, deadline - now) : null;
  const expired = remaining === 0;
  const stale =
    Boolean(error) ||
    (quote !== null && now !== null && now - quote.fetchedAt > 120_000);
  const nextFriday = now === null ? null : new Date(now);
  if (nextFriday)
    nextFriday.setUTCDate(
      nextFriday.getUTCDate() + ((5 - nextFriday.getUTCDay() + 7) % 7),
    );
  const scenarios =
    currentPrice !== null && currentPrice > 0
      ? [0.5, 1, 1.5, 2].map((multiple) => ({
          label: multiple === 1 ? 'Current' : `${multiple}× current`,
          price: currentPrice * multiple,
        }))
      : [];
  const target = parseAirdropNumber(prefs.targetPrice);
  if (target !== null) scenarios.push({ label: 'Your target', price: target });

  return (
    <>
      <PageIntro
        eyebrow="Robinhood Chain rewards"
        title="Lighter airdrop calculator"
        description="Turn your points into a LIT allocation scenario. Compare today's price with your target and plan around your own payout date."
        actions={
          <Button
            variant="outline"
            onClick={() => void refresh()}
            disabled={loading}
          >
            <RefreshCw
              className={`size-3.5 ${loading ? 'animate-spin' : ''}`}
            />{' '}
            Refresh LIT price
          </Button>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <span
            className={`size-2 rounded-full ${quote && !stale ? 'bg-[var(--positive)]' : 'bg-[var(--warning)]'}`}
          />
          {quote
            ? `${stale ? 'Last saved' : 'Latest'} LIT mark ${usd(quote.price, 4)}`
            : loading
              ? 'Fetching LIT price…'
              : 'Live price unavailable'}
        </span>
        {quote && (
          <span>
            {quote.source} · {new Date(quote.fetchedAt).toLocaleString()}
          </span>
        )}
        <span className="sm:ml-auto">Inputs saved on this device</span>
      </div>
      {error && (
        <output className="mb-4 block rounded-lg border border-[var(--warning)]/30 bg-[var(--warning)]/5 px-4 py-3 text-xs text-muted-foreground">
          {error} You can also enter a price below.
        </output>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.35fr)]">
        <Panel>
          <PanelHeader
            title="Your allocation"
            description="Use your recorded RH points or enter an estimated LIT allocation."
          />
          <div className="space-y-5 p-5">
            <div
              className="flex gap-1 rounded-lg bg-muted p-1"
              aria-label="Allocation method"
            >
              {(['points', 'tokens'] as const).map((mode) => (
                <Button
                  key={mode}
                  aria-pressed={prefs.mode === mode}
                  variant={prefs.mode === mode ? 'default' : 'ghost'}
                  className="flex-1"
                  onClick={() => update('mode', mode)}
                >
                  {mode === 'points' ? 'From my points' : 'Enter LIT amount'}
                </Button>
              ))}
            </div>
            {prefs.mode === 'points' ? (
              <>
                <Field
                  id="my-points"
                  label="Your RH points"
                  value={prefs.points}
                  onChange={(v) => update('points', v)}
                  placeholder="Enter points shown in your account"
                />
                <Field
                  id="total-points"
                  label="Estimated final program points"
                  value={prefs.totalPoints}
                  onChange={(v) => update('totalPoints', v)}
                  placeholder="Total across all eligible participants"
                  invalid={invalidTotal}
                  hint={
                    invalidTotal
                      ? 'Total points must be greater than zero and at least your points.'
                      : 'Your assumption for the final total, including real-time and weekly points.'
                  }
                />
                <Field
                  id="token-pool"
                  label="Reward pool · LIT"
                  value={prefs.pool}
                  onChange={(v) => update('pool', v)}
                  hint="11 million LIT announced for the Robinhood community. Editable for scenarios."
                />
                <p className="rounded-lg bg-muted/60 p-3 text-xs leading-5 text-muted-foreground">
                  Uses a proportional-share assumption: your points ÷ final
                  program points × LIT pool. Lighter has not published a
                  conversion ratio. Recorded points already include any awarded
                  boost; they are not doubled here.
                </p>
              </>
            ) : (
              <Field
                id="lit-tokens"
                label="Estimated allocation · LIT"
                value={prefs.tokens}
                onChange={(v) => update('tokens', v)}
                placeholder="Enter LIT amount"
              />
            )}

            <div className="grid gap-4 border-t border-border pt-5 sm:grid-cols-2">
              <div>
                <Field
                  id="current-price"
                  label="Current LIT price · USD"
                  value={
                    prefs.manualPrice !== ''
                      ? prefs.manualPrice
                      : quote
                        ? String(quote.price)
                        : ''
                  }
                  onChange={(v) => update('manualPrice', v)}
                  placeholder="Waiting for quote"
                  step="0.0001"
                  hint={
                    prefs.manualPrice !== ''
                      ? 'Manual price override'
                      : quote
                        ? 'Auto · venue perpetual mark reference'
                        : 'Enter a reference price if offline'
                  }
                />
                {prefs.manualPrice !== '' && (
                  <Button
                    size="xs"
                    variant="link"
                    className="mt-1 px-0"
                    onClick={() => update('manualPrice', '')}
                  >
                    Use live price
                  </Button>
                )}
              </div>
              <Field
                id="target-price"
                label="Target LIT price · USD"
                value={prefs.targetPrice}
                onChange={(v) => update('targetPrice', v)}
                placeholder="Your price at distribution"
                step="0.01"
                hint="Your scenario, not a price forecast"
              />
            </div>
            <Field
              id="airdrop-costs"
              label="Total participation costs · USD"
              value={prefs.costs}
              onChange={(v) => update('costs', v)}
              placeholder="0"
              step="0.01"
              hint="Optional: fees, net funding paid, gas and other costs you want to deduct."
            />
          </div>
        </Panel>

        <div className="space-y-5">
          <section className="overflow-hidden rounded-xl border border-primary/30 bg-primary/[0.055] p-6 sm:p-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-sm font-medium text-primary">
                <Gift className="size-4" /> Estimated allocation
              </p>
              <span className="rounded-full border border-primary/25 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-primary">
                Scenario
              </span>
            </div>
            <p className="mt-5 break-words font-mono text-[clamp(2rem,4vw,3.5rem)] font-semibold tracking-[-0.05em]">
              {result.tokens === null ? '—' : number(result.tokens)}{' '}
              <span className="text-lg font-medium text-muted-foreground">
                LIT
              </span>
            </p>
            <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
              {result.share !== null
                ? `${number(result.share * 100, 6)}% of the modeled reward pool`
                : prefs.mode === 'points'
                  ? 'Enter your points and the estimated program total to calculate.'
                  : 'Enter your LIT allocation to compare prices.'}
            </p>
            <div className="mt-6 grid gap-5 border-t border-primary/20 pt-5 sm:grid-cols-2">
              <Result
                label="Value at current price"
                value={usd(result.currentValue)}
                detail={
                  currentPrice === null
                    ? 'Awaiting a price'
                    : `${usd(currentPrice, 4)} per LIT`
                }
              />
              <Result
                label="Value at target price"
                value={usd(result.targetValue)}
                accent
                detail={
                  result.targetChange === null
                    ? 'Enter your target price'
                    : `${result.targetChange >= 0 ? '+' : ''}${number(result.targetChange)}% vs current price`
                }
              />
              <Result
                label="Target value after costs"
                value={usd(result.targetNet)}
                detail={`${usd(parseAirdropNumber(prefs.costs) ?? 0)} costs deducted`}
              />
              <Result
                label="Break-even LIT price"
                value={usd(result.breakEvenPrice, 4)}
                detail="Price needed to cover entered costs"
              />
            </div>
          </section>

          <Panel>
            <PanelHeader
              title={
                deadline === null
                  ? 'Airdrop date · not announced'
                  : 'Your planning countdown'
              }
              description={
                deadline === null
                  ? 'No final token distribution date appears in the official sources checked below.'
                  : 'This date is your assumption. It is not an official payout schedule.'
              }
              aside={<Clock3 className="size-5 shrink-0 text-primary" />}
            />
            <div className="space-y-4 p-5">
              <div
                className="grid grid-cols-4 gap-2"
                aria-label={
                  deadline === null
                    ? 'No confirmed countdown'
                    : 'Time until your estimated distribution date'
                }
              >
                {[
                  [
                    'Days',
                    remaining === null
                      ? null
                      : Math.floor(remaining / 86_400_000),
                  ],
                  [
                    'Hours',
                    remaining === null
                      ? null
                      : Math.floor(remaining / 3_600_000) % 24,
                  ],
                  [
                    'Min',
                    remaining === null
                      ? null
                      : Math.floor(remaining / 60_000) % 60,
                  ],
                  [
                    'Sec',
                    remaining === null
                      ? null
                      : Math.floor(remaining / 1_000) % 60,
                  ],
                ].map(([label, value]) => (
                  <div
                    key={String(label)}
                    className="rounded-lg border border-border bg-muted/40 px-2 py-4 text-center"
                  >
                    <p className="font-mono text-2xl font-semibold sm:text-3xl">
                      {value === null ? '—' : String(value).padStart(2, '0')}
                    </p>
                    <p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                      {label}
                    </p>
                  </div>
                ))}
              </div>
              {expired && (
                <p className="text-xs text-primary">
                  Your estimated date has passed. This does not confirm a
                  distribution.
                </p>
              )}
              <Label htmlFor="airdrop-date" className="text-xs">
                Your estimated payout date / time · UTC
              </Label>
              <div className="flex gap-2">
                <Input
                  id="airdrop-date"
                  type="datetime-local"
                  value={prefs.deadline}
                  onChange={(e) => update('deadline', e.target.value)}
                  className="h-10 flex-1"
                />
                {prefs.deadline && (
                  <Button
                    variant="outline"
                    className="h-10"
                    onClick={() => update('deadline', '')}
                  >
                    Clear
                  </Button>
                )}
              </div>
              <p className="border-t border-border pt-3 text-xs leading-5 text-muted-foreground">
                Weekly points drop:{' '}
                <span className="font-medium text-foreground">
                  Friday
                  {nextFriday
                    ? `, ${nextFriday.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`
                    : ''}
                </span>
                . The docs give no exact payout time. Weekly points credit and
                the LIT distribution are separate events.
              </p>
            </div>
          </Panel>
        </div>
      </div>

      <Panel className="mt-5 overflow-hidden">
        <PanelHeader
          title="What your allocation could be worth"
          description="Same token allocation, different LIT prices. Each bar shows the gross value before your entered costs."
        />
        <div className="space-y-4 p-5">
          {scenarios.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              A current or target price is needed to show scenarios.
            </p>
          ) : (
            scenarios.map((scenario) => (
              <div
                key={scenario.label}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 sm:grid-cols-[140px_minmax(0,1fr)_120px]"
              >
                <div>
                  <p className="text-xs font-medium">{scenario.label}</p>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {usd(scenario.price, 4)} / LIT
                  </p>
                </div>
                <div className="order-last col-span-2 h-2 overflow-hidden rounded-full bg-muted sm:order-none sm:col-span-1">
                  <div
                    className={`h-full rounded-full ${scenario.label === 'Your target' ? 'bg-primary' : 'bg-[var(--positive)]/60'}`}
                    style={{
                      width:
                        result.tokens !== null && result.tokens > 0
                          ? `${(scenario.price / Math.max(...scenarios.map((item) => item.price), 0.000001)) * 100}%`
                          : '0%',
                    }}
                  />
                </div>
                <p className="text-right font-mono text-sm font-semibold">
                  {usd(
                    result.tokens === null
                      ? null
                      : result.tokens * scenario.price,
                  )}
                </p>
              </div>
            ))
          )}
        </div>
      </Panel>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Fact
          icon={Coins}
          title="11 million LIT committed"
          href={AIRDROP_SOURCES.announcement}
          source="Robinhood announcement"
        >
          Robinhood announced this reward pool for its community. Eligible perp
          activity earns points, with 2× through Robinhood Wallet and 1× through
          Lighter’s web app, subject to Lighter’s terms.
        </Fact>
        <Fact
          icon={Clock3}
          title="Live points + Friday drops"
          href={AIRDROP_SOURCES.points}
          source="Lighter RH points docs"
        >
          Points accrue during eligible activity, with an additional weekly drop
          every Friday. The first weekly drop was August 21, 2026. Scoring may
          change; a fixed LIT-per-point ratio is not published here.
        </Fact>
        <Fact
          icon={BookOpen}
          title="Program rules & eligibility"
          href={AIRDROP_SOURCES.points}
          source="Lighter program terms"
        >
          Lighter sets eligibility and can revise points after review. Its terms
          exclude artificial trading, Sybil activity and referral abuse, and
          list restricted regions. Check these terms for your account.
        </Fact>
      </div>
      <p className="mt-4 text-xs leading-5 text-muted-foreground">
        Official sources checked {AIRDROP_DOCS_CHECKED}. Prices refresh every
        minute; program details are a dated summary.{' '}
        <a
          href={AIRDROP_SOURCES.support}
          target="_blank"
          rel="noreferrer"
          className="text-primary underline underline-offset-4"
        >
          Robinhood’s points explanation
        </a>
        . These estimates stay separate from your portfolio balances and P&L.
      </p>
    </>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  hint,
  placeholder,
  step = 'any',
  invalid = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  placeholder?: string;
  step?: string;
  invalid?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        min="0"
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-invalid={invalid}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="h-11 bg-background font-mono"
      />
      {hint && (
        <p
          id={`${id}-hint`}
          className={`text-[11px] leading-5 ${invalid ? 'text-[var(--negative)]' : 'text-muted-foreground'}`}
        >
          {hint}
        </p>
      )}
    </div>
  );
}

function Result({
  label,
  value,
  detail,
  accent = false,
}: {
  label: string;
  value: string;
  detail: string;
  accent?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={`mt-2 break-words font-mono text-2xl font-semibold tracking-tight ${accent ? 'text-primary' : ''}`}
      >
        {value}
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">{detail}</p>
    </div>
  );
}

function Fact({
  icon: Icon,
  title,
  children,
  href,
  source,
}: {
  icon: typeof Gift;
  title: string;
  children: React.ReactNode;
  href: string;
  source: string;
}) {
  return (
    <Panel className="p-5">
      <Icon className="mb-3 size-5 text-primary" />
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mt-2 text-xs leading-6 text-muted-foreground">{children}</p>
      <a
        className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        href={href}
        target="_blank"
        rel="noreferrer"
      >
        {source} <ArrowUpRight className="size-3.5" />
      </a>
    </Panel>
  );
}

function validQuote(value: unknown): value is AirdropQuote {
  if (!value || typeof value !== 'object') return false;
  const quote = value as AirdropQuote;
  return (
    Number.isFinite(quote.price) &&
    quote.price > 0 &&
    Number.isFinite(quote.fetchedAt) &&
    quote.fetchedAt > 0 &&
    typeof quote.source === 'string'
  );
}
function number(value: number, decimals = 2) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: decimals,
  }).format(value);
}
function usd(value: number | null, decimals = 2) {
  return value === null || !Number.isFinite(value)
    ? '—'
    : new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: decimals,
      }).format(value);
}
