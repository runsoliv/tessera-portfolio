'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import { CalendarDays } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import type { CustomHistoryRange, PresetRange, Range } from '@/lib/analytics';

const STORAGE_KEY = 'tessera.chart-range.v1';
const STORAGE_EVENT = 'tessera-chart-range-change';
export const HISTORY_PRESETS: PresetRange[] = ['1D', '1W', '1M', '1Y', 'ALL'];

type StoredRange =
  | { version: 1; mode: 'preset'; preset: PresetRange }
  | { version: 1; mode: 'custom'; start: string; end: string };

const DEFAULT_STORED_RANGE: StoredRange = {
  version: 1,
  mode: 'preset',
  preset: '1M',
};
const DEFAULT_STORED_RANGE_JSON = JSON.stringify(DEFAULT_STORED_RANGE);
const TODAY_INPUT = toDateInput(Date.now());
const DEFAULT_START_INPUT = (() => {
  const date = new Date();
  date.setDate(date.getDate() - 30);
  return toDateInput(date.getTime());
})();

export function usePersistentHistoryRange() {
  const raw = useSyncExternalStore(
    subscribeToStoredRange,
    readStoredRange,
    () => DEFAULT_STORED_RANGE_JSON,
  );
  const stored = useMemo(
    () => parseStoredRange(raw) ?? DEFAULT_STORED_RANGE,
    [raw],
  );
  const resolvedCustomRange =
    stored.mode === 'custom'
      ? resolveCustomRange(stored.start, stored.end)
      : null;
  const range: Range = resolvedCustomRange
    ? 'CUSTOM'
    : stored.mode === 'preset'
      ? stored.preset
      : '1M';
  const customRange = resolvedCustomRange;

  const label = useMemo(
    () => historyRangeLabel(range, customRange),
    [customRange, range],
  );

  return {
    range,
    customRange,
    label,
    selectPreset: (preset: PresetRange) => {
      saveStoredRange({ version: 1, mode: 'preset', preset });
    },
    selectCustom: (start: string, end: string) => {
      const resolved = resolveCustomRange(start, end);
      if (!resolved) return 'Choose a valid start and end date.';
      if (resolved.start > resolved.end)
        return 'Start date must be before end date.';
      if (resolved.end > endOfLocalDay(Date.now()))
        return 'End date cannot be in the future.';
      saveStoredRange({ version: 1, mode: 'custom', start, end });
      return null;
    },
  };
}

export function HistoryRangeControl({
  range,
  customRange,
  onPreset,
  onCustom,
}: {
  range: Range;
  customRange: CustomHistoryRange | null;
  onPreset: (preset: PresetRange) => void;
  onCustom: (start: string, end: string) => string | null;
}) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(
    customRange ? toDateInput(customRange.start) : DEFAULT_START_INPUT,
  );
  const [end, setEnd] = useState(
    customRange ? toDateInput(customRange.end) : TODAY_INPUT,
  );
  const [error, setError] = useState('');

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-lg bg-muted p-0.5 text-[10px] text-muted-foreground">
      {HISTORY_PRESETS.map((preset) => (
        <button
          key={preset}
          type="button"
          onClick={() => onPreset(preset)}
          className={`rounded-md px-2 py-1 transition ${range === preset ? 'bg-card text-foreground shadow-sm' : 'hover:text-foreground'}`}
        >
          {preset}
        </button>
      ))}
      <Popover
        open={open}
        onOpenChange={(nextOpen) => {
          if (nextOpen) {
            setStart(
              customRange
                ? toDateInput(customRange.start)
                : DEFAULT_START_INPUT,
            );
            setEnd(customRange ? toDateInput(customRange.end) : TODAY_INPUT);
            setError('');
          }
          setOpen(nextOpen);
        }}
      >
        <PopoverTrigger
          className={`inline-flex items-center gap-1 rounded-md px-2 py-1 transition ${range === 'CUSTOM' ? 'bg-card text-foreground shadow-sm' : 'hover:text-foreground'}`}
        >
          <CalendarDays className="size-3" /> Custom
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 gap-3 p-4">
          <div>
            <p className="text-[13px] font-semibold text-foreground">
              Custom chart range
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              This selection is reused on Overview and Analytics.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label
              htmlFor="history-range-start"
              className="space-y-1.5 text-[10px] font-medium text-muted-foreground"
            >
              Start
              <Input
                id="history-range-start"
                type="date"
                value={start}
                max={TODAY_INPUT}
                onChange={(event) => {
                  setStart(event.target.value);
                  setError('');
                }}
                className="h-9 text-[11px] text-foreground"
              />
            </label>
            <label
              htmlFor="history-range-end"
              className="space-y-1.5 text-[10px] font-medium text-muted-foreground"
            >
              End
              <Input
                id="history-range-end"
                type="date"
                value={end}
                max={TODAY_INPUT}
                onChange={(event) => {
                  setEnd(event.target.value);
                  setError('');
                }}
                className="h-9 text-[11px] text-foreground"
              />
            </label>
          </div>
          {error && <p className="text-[10px] text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                const nextError = onCustom(start, end);
                if (nextError) {
                  setError(nextError);
                  return;
                }
                setOpen(false);
              }}
            >
              Apply range
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function parseStoredRange(raw: string | null): StoredRange | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredRange>;
    if (value.version !== 1) return null;
    if (
      value.mode === 'preset' &&
      HISTORY_PRESETS.includes(value.preset as PresetRange)
    )
      return value as StoredRange;
    if (
      value.mode === 'custom' &&
      typeof value.start === 'string' &&
      typeof value.end === 'string'
    )
      return value as StoredRange;
  } catch {
    return null;
  }
  return null;
}

function subscribeToStoredRange(callback: () => void) {
  if (typeof window === 'undefined') return () => undefined;
  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) callback();
  };
  const handleLocalChange = () => callback();
  window.addEventListener('storage', handleStorage);
  window.addEventListener(STORAGE_EVENT, handleLocalChange);
  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(STORAGE_EVENT, handleLocalChange);
  };
}

function readStoredRange() {
  if (typeof window === 'undefined') return DEFAULT_STORED_RANGE_JSON;
  return window.localStorage.getItem(STORAGE_KEY) ?? DEFAULT_STORED_RANGE_JSON;
}

function saveStoredRange(value: StoredRange) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  window.dispatchEvent(new Event(STORAGE_EVENT));
}

function resolveCustomRange(
  start: string,
  end: string,
): CustomHistoryRange | null {
  const startTimestamp = parseLocalDate(start, false);
  const endTimestamp = parseLocalDate(end, true);
  if (startTimestamp == null || endTimestamp == null) return null;
  return { start: startTimestamp, end: endTimestamp };
}

function parseLocalDate(value: string, endOfDay: boolean) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  )
    return null;
  if (!endOfDay) return date.getTime();
  return new Date(year, month - 1, day + 1).getTime() - 1;
}

function endOfLocalDay(timestamp: number) {
  const date = new Date(timestamp);
  return (
    new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate() + 1,
    ).getTime() - 1
  );
}

function toDateInput(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function historyRangeLabel(
  range: Range,
  customRange: CustomHistoryRange | null,
) {
  if (range !== 'CUSTOM' || !customRange) return `${range} range`;
  const start = new Date(customRange.start);
  const end = new Date(customRange.end);
  const format = (date: Date, includeYear: boolean) =>
    date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: includeYear ? 'numeric' : undefined,
    });
  const sameYear = start.getFullYear() === end.getFullYear();
  return `${format(start, !sameYear)} – ${format(end, true)}`;
}
