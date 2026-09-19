'use client';

import Image from 'next/image';
import { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  ChartNoAxesCombined,
  FileImage,
  ImageUp,
  Plus,
  ScanText,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import type { Worker } from 'tesseract.js';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Progress, ProgressLabel } from '@/components/ui/progress';
import {
  PLATFORMS,
  formatMoney,
  type AssetOption,
  type ImportProfile,
} from '@/lib/portfolio';
import {
  dedupeDetectedPositions,
  findExactAsset,
  normalizeTicker,
  ocrTickerAlternatives,
  parseScreenshotText,
  type DetectedScreenshotPosition,
  type ScreenshotAssetType,
  type ScreenshotImportDestination,
  type ScreenshotPositionImport,
} from '@/lib/screenshot-import';

type ScreenshotImportDialogProps = {
  open: boolean;
  preferredPlatform?: 'Variational';
  onOpenChange: (open: boolean) => void;
  onImport: (
    items: ScreenshotPositionImport[],
    destination: ScreenshotImportDestination,
  ) => void;
  importProfiles: ImportProfile[];
  minimumPositionValue: number;
};

type ImageFile = {
  id: string;
  file: File;
  url: string;
  status: 'ready' | 'reading' | 'done' | 'error';
};

type ReviewPosition = DetectedScreenshotPosition & {
  name: string;
  network: string;
  coinId?: string;
  resolved: boolean;
  selected: boolean;
};

const MAX_FILES = 8;
const MAX_FILE_BYTES = 15 * 1024 * 1024;

export function ScreenshotImportDialog({
  open,
  preferredPlatform,
  onOpenChange,
  onImport,
  importProfiles,
  minimumPositionValue,
}: ScreenshotImportDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const [images, setImages] = useState<ImageFile[]>([]);
  const [positions, setPositions] = useState<ReviewPosition[]>([]);
  const [platformChoice, setPlatformChoice] = useState(
    preferredPlatform ?? 'Robinhood',
  );
  const [customPlatform, setCustomPlatform] = useState('');
  const [destinationProfileId, setDestinationProfileId] = useState('__new');
  const [profileName, setProfileName] = useState(
    preferredPlatform ?? 'Robinhood',
  );
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('Preparing local OCR');
  const [rawText, setRawText] = useState('');
  const [error, setError] = useState('');

  const selectedPositions = useMemo(
    () => positions.filter((item) => item.selected),
    [positions],
  );
  const selectedValue = selectedPositions.reduce(
    (sum, item) => sum + Number(item.totalValue ?? 0),
    0,
  );
  const resolvedPlatform =
    platformChoice === '__custom' ? customPlatform.trim() : platformChoice;
  const screenshotProfiles = useMemo(
    () => importProfiles.filter((profile) => profile.source === 'screenshot'),
    [importProfiles],
  );
  const destinationProfile = screenshotProfiles.find(
    (profile) => profile.id === destinationProfileId,
  );
  const importPlatform = destinationProfile?.platform ?? resolvedPlatform;
  const invalidRows = selectedPositions.filter(
    (item) =>
      !normalizeTicker(item.symbol) ||
      !(Number(item.amount) > 0) ||
      (item.positionType === 'perp' &&
        (!(Number(item.leverage) >= 1) || Number(item.leverage) > 100)),
  );

  function addFiles(files: File[]) {
    const accepted = files.filter(
      (file) =>
        ['image/png', 'image/jpeg', 'image/webp'].includes(file.type) &&
        file.size <= MAX_FILE_BYTES,
    );
    if (!accepted.length) {
      setError('Choose PNG, JPG or WebP screenshots up to 15 MB each.');
      return;
    }
    setImages((current) => {
      const room = Math.max(0, MAX_FILES - current.length);
      return [
        ...current,
        ...accepted.slice(0, room).map((file) => ({
          id: crypto.randomUUID(),
          file,
          url: URL.createObjectURL(file),
          status: 'ready' as const,
        })),
      ];
    });
    setPositions([]);
    setRawText('');
    setError(
      files.length > accepted.length
        ? 'Some files were skipped because their type or size is unsupported.'
        : '',
    );
  }

  function removeImage(id: string) {
    setImages((current) => {
      const target = current.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return current.filter((item) => item.id !== id);
    });
    setPositions([]);
    setRawText('');
  }

  function updatePosition(id: string, patch: Partial<ReviewPosition>) {
    setPositions((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }

  function chooseDestinationProfile(id: string) {
    setDestinationProfileId(id);
    const profile = screenshotProfiles.find((item) => item.id === id);
    if (!profile) return;
    setProfileName(profile.name);
    const knownPlatform = PLATFORMS.find(
      (platform) => platform === profile.platform,
    );
    if (knownPlatform) {
      setPlatformChoice(knownPlatform);
      setCustomPlatform('');
    } else {
      setPlatformChoice('__custom');
      setCustomPlatform(profile.platform);
    }
  }

  function choosePlatform(value: string) {
    const previousPlatform = importPlatform;
    setPlatformChoice(value);
    setDestinationProfileId('__new');
    if (
      !profileName.trim() ||
      profileName === destinationProfile?.name ||
      profileName === previousPlatform
    ) {
      setProfileName(value === '__custom' ? '' : value);
    }
  }

  async function readScreenshots() {
    if (!images.length || processing) return;
    setProcessing(true);
    setProgress(0);
    setProgressLabel('Loading OCR engine');
    setError('');
    setPositions([]);
    setRawText('');
    try {
      const { createWorker, PSM } = await import('tesseract.js');
      const worker = await createWorker('eng', 1, {
        logger: (message) => {
          setProgressLabel(humanizeStatus(message.status));
          if (Number.isFinite(message.progress))
            setProgress(Math.max(1, Math.round(message.progress * 20)));
        },
      });
      workerRef.current = worker;
      await worker.setParameters({
        preserve_interword_spaces: '1',
        user_defined_dpi: '300',
        tessedit_pageseg_mode: PSM.AUTO,
      });
      const allDetected: DetectedScreenshotPosition[] = [];
      const textBlocks: string[] = [];

      for (let index = 0; index < images.length; index += 1) {
        const image = images[index];
        setImages((current) =>
          current.map((item) =>
            item.id === image.id ? { ...item, status: 'reading' } : item,
          ),
        );
        setProgressLabel(`Enhancing ${image.file.name}`);
        const enhanced = await enhanceScreenshot(image.file);
        setProgressLabel(`Reading ${image.file.name} · structured pass`);
        await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
        const structured = await worker.recognize(
          enhanced,
          { rotateAuto: true },
          { text: true, blocks: true },
        );
        const structuredText = [
          structured.data.text ?? '',
          textFromBlocks(structured.data.blocks),
        ]
          .filter(Boolean)
          .join('\n');
        const structuredPositions = parseScreenshotText(
          structuredText,
          `${image.id}-structured`,
        );

        setProgressLabel(`Reading ${image.file.name} · sparse-text pass`);
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
        const sparse = await worker.recognize(
          image.file,
          { rotateAuto: true },
          { text: true, blocks: true },
        );
        const sparseText = [
          sparse.data.text ?? '',
          textFromBlocks(sparse.data.blocks),
        ]
          .filter(Boolean)
          .join('\n');
        const text = `${structuredText}\n${sparseText}`.trim();
        textBlocks.push(`${image.file.name}\n${text}`);
        allDetected.push(
          ...structuredPositions,
          ...parseScreenshotText(sparseText, `${image.id}-sparse`),
        );
        setImages((current) =>
          current.map((item) =>
            item.id === image.id
              ? { ...item, status: text ? 'done' : 'error' }
              : item,
          ),
        );
        setProgress(Math.round(((index + 1) / images.length) * 82));
      }

      await worker.terminate();
      workerRef.current = null;
      const detected = dedupeDetectedPositions(allDetected);
      setProgressLabel('Resolving market tickers');
      const enriched = await enrichPositions(detected, minimumPositionValue);
      setPositions(enriched);
      const combinedText = textBlocks.join('\n\n———\n\n');
      setRawText(combinedText);
      const detectedPlatform = detectPlatform(combinedText);
      if (detectedPlatform && !preferredPlatform) {
        setPlatformChoice(detectedPlatform);
        setProfileName((current) =>
          !current.trim() || current === resolvedPlatform
            ? detectedPlatform
            : current,
        );
      }
      setProgress(100);
      if (!enriched.length)
        setError(
          'No position rows were found. Try a clearer screenshot or crop it to the holdings list.',
        );
    } catch (cause) {
      await workerRef.current?.terminate().catch(() => undefined);
      workerRef.current = null;
      setError(
        cause instanceof Error
          ? `Screenshot reading failed: ${cause.message}`
          : 'Screenshot reading failed.',
      );
    } finally {
      setProcessing(false);
    }
  }

  async function importSelected() {
    if (!importPlatform) {
      setError('Select the platform shown in the screenshots.');
      return;
    }
    if (!profileName.trim()) {
      setError('Name the saved import before adding these positions.');
      return;
    }
    if (!selectedPositions.length) {
      setError('Select at least one detected position.');
      return;
    }
    if (invalidRows.length) {
      setError(
        `Correct the ticker, quantity or leverage for ${invalidRows.map((item) => item.symbol || 'the incomplete row').join(', ')}.`,
      );
      return;
    }
    setProcessing(true);
    setProgressLabel('Confirming ticker matches');
    setProgress(90);
    try {
      const refreshed = await enrichPositions(selectedPositions, 0);
      const unresolved = refreshed.filter((item) => !item.resolved);
      if (unresolved.length) {
        setPositions((current) =>
          current.map(
            (item) => refreshed.find((match) => match.id === item.id) ?? item,
          ),
        );
        setError(
          `No exact live-market match was found for ${unresolved.map((item) => item.symbol || 'the incomplete row').join(', ')}. Correct the ticker or asset type and try again.`,
        );
        return;
      }
      const invalidPerps = refreshed.filter(
        (item) =>
          item.positionType === 'perp' && !(effectiveEntryPrice(item) > 0),
      );
      if (invalidPerps.length) {
        setError(
          `Enter an entry price for ${invalidPerps.map((item) => item.symbol).join(', ')} before importing the perpetual position.`,
        );
        return;
      }
      const imports: ScreenshotPositionImport[] = refreshed.map((item) => {
        return {
          ...item,
          symbol: normalizeTicker(item.symbol),
          platform: importPlatform,
          priceEstimate: undefined,
          entryPrice:
            item.positionType === 'perp' ? Number(item.entryPrice) : undefined,
        };
      });
      onImport(imports, {
        profileId: destinationProfile?.id,
        profileName: profileName.trim(),
      });
      reset();
      onOpenChange(false);
    } finally {
      setProcessing(false);
    }
  }

  function reset() {
    for (const image of images) URL.revokeObjectURL(image.url);
    setImages([]);
    setPositions([]);
    setRawText('');
    setProgress(0);
    setProgressLabel('Preparing local OCR');
    setError('');
    setDestinationProfileId('__new');
    setProfileName('Robinhood');
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] overflow-y-auto border border-white/10 bg-[#111412] p-0 sm:max-w-[940px]">
        <DialogHeader className="border-b border-white/[0.07] px-6 py-5">
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#d8ff58]/10 text-[#d8ff58]">
              <ScanText className="size-4" />
            </span>
            <div>
              <DialogTitle className="text-lg font-semibold tracking-[-0.035em]">
                Import position screenshots
              </DialogTitle>
              <DialogDescription className="mt-1 text-xs text-white/40">
                Read ticker and quantity locally, resolve the live market, then
                add into matching portfolio positions.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="p-5 sm:p-6">
          {!positions.length ? (
            <>
              <button
                type="button"
                aria-label="Choose portfolio screenshots"
                disabled={processing}
                onClick={() => inputRef.current?.click()}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  addFiles(Array.from(event.dataTransfer.files));
                }}
                className="group grid min-h-44 w-full place-items-center rounded-2xl border border-dashed border-white/10 bg-black/15 px-6 text-center transition hover:border-[#d8ff58]/30 hover:bg-[#d8ff58]/[0.025] disabled:pointer-events-none disabled:opacity-50"
              >
                <span>
                  <span className="mx-auto grid size-11 place-items-center rounded-2xl border border-white/[0.07] bg-white/[0.035] text-white/30 transition group-hover:text-[#d8ff58]">
                    <ImageUp className="size-5" />
                  </span>
                  <span className="mt-4 block text-[11px] font-semibold text-white/70">
                    Drop portfolio screenshots here
                  </span>
                  <span className="mt-1.5 block text-[9px] text-white/28">
                    or click to choose up to {MAX_FILES} images from the same
                    platform
                  </span>
                </span>
              </button>
              <input
                ref={inputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                className="hidden"
                onChange={(event) => {
                  addFiles(Array.from(event.target.files ?? []));
                  event.target.value = '';
                }}
              />

              {images.length > 0 && (
                <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {images.map((image) => (
                    <div
                      key={image.id}
                      className="group relative flex items-center gap-2.5 rounded-xl border border-white/[0.07] bg-white/[0.025] p-2"
                    >
                      <Image
                        src={image.url}
                        alt="Screenshot preview"
                        width={40}
                        height={40}
                        unoptimized
                        className="size-10 rounded-lg object-cover opacity-70"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[9px] text-white/55">
                          {image.file.name}
                        </p>
                        <p className="mt-1 text-[7px] uppercase tracking-[0.1em] text-white/22">
                          {image.status === 'reading'
                            ? 'Reading…'
                            : image.status === 'done'
                              ? 'Read'
                              : image.status === 'error'
                                ? 'No text'
                                : formatFileSize(image.file.size)}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={processing}
                        onClick={() => removeImage(image.id)}
                        aria-label={`Remove ${image.file.name}`}
                        className="grid size-7 place-items-center rounded-lg text-white/20 hover:bg-[#ff7777]/10 hover:text-[#ff8585]"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {processing && (
                <div className="mt-5 rounded-2xl border border-[#d8ff58]/12 bg-[#d8ff58]/[0.03] p-4">
                  <Progress value={progress} className="gap-2">
                    <ProgressLabel className="text-[9px] text-white/45">
                      {progressLabel}
                    </ProgressLabel>
                    <span className="ml-auto font-mono text-[9px] text-[#d8ff58]">
                      {progress}%
                    </span>
                  </Progress>
                  <p className="mt-2 text-[8px] leading-4 text-white/24">
                    The first scan may take longer while the free OCR language
                    model loads.
                  </p>
                </div>
              )}

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <InfoTile
                  icon={ShieldCheck}
                  title="Private by design"
                  detail="Image bytes stay in this browser and are discarded after review."
                />
                <InfoTile
                  icon={ChartNoAxesCombined}
                  title="Always live-priced"
                  detail="Detected dollar values are ignored for pricing. Stocks use Yahoo Finance and crypto uses CoinGecko."
                />
                <InfoTile
                  icon={FileImage}
                  title="Adds to matching tickers"
                  detail="A resolved spot ticker adds to the same ticker on that platform instead of creating a duplicate row."
                />
              </div>
            </>
          ) : (
            <>
              <div className="grid gap-3 rounded-2xl border border-white/[0.07] bg-black/15 p-4 sm:grid-cols-[minmax(0,1fr)_210px_210px] sm:items-end">
                <div className="sm:self-center">
                  <p className="text-[10px] font-semibold text-white/70">
                    Review {positions.length} detected position
                    {positions.length === 1 ? '' : 's'}
                  </p>
                  <p className="mt-1 text-[8px] leading-4 text-white/28">
                    Correct any OCR mistakes. Every row must resolve to an exact
                    live stock or crypto ticker. Positions below your{' '}
                    {formatMoney(minimumPositionValue)} cutoff are found but
                    deselected by default. Use one platform per import batch.
                  </p>
                </div>
                <label>
                  <span className="mb-2 block text-[8px] font-medium uppercase tracking-[0.14em] text-white/28">
                    Platform / venue
                  </span>
                  <select
                    value={platformChoice}
                    onChange={(event) => choosePlatform(event.target.value)}
                    disabled={Boolean(destinationProfile)}
                    className="h-10 w-full rounded-xl border border-white/10 bg-[#151816] px-3 text-[10px] text-white outline-none focus:border-[#d8ff58]/50"
                  >
                    {PLATFORMS.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                    <option value="__custom">Other / custom platform</option>
                  </select>
                </label>
                <label>
                  <span className="mb-2 block text-[8px] font-medium uppercase tracking-[0.14em] text-white/28">
                    Add to saved import
                  </span>
                  <select
                    value={destinationProfileId}
                    onChange={(event) =>
                      chooseDestinationProfile(event.target.value)
                    }
                    className="h-10 w-full rounded-xl border border-white/10 bg-[#151816] px-3 text-[10px] text-white outline-none focus:border-[#d8ff58]/50"
                  >
                    <option value="__new">Create new saved import</option>
                    {screenshotProfiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name} · {profile.platform}
                      </option>
                    ))}
                  </select>
                </label>
                {platformChoice === '__custom' && (
                  <Input
                    value={customPlatform}
                    onChange={(event) => {
                      setCustomPlatform(event.target.value);
                      setDestinationProfileId('__new');
                    }}
                    placeholder="Platform name"
                    disabled={Boolean(destinationProfile)}
                    className="h-10 rounded-xl border-white/10 bg-white/[0.03] text-[10px] sm:col-start-2"
                  />
                )}
                <label
                  htmlFor="screenshot-profile-name"
                  className="sm:col-start-3"
                >
                  <span className="mb-2 block text-[8px] font-medium uppercase tracking-[0.14em] text-white/28">
                    Saved import name
                  </span>
                  <Input
                    id="screenshot-profile-name"
                    value={profileName}
                    onChange={(event) => setProfileName(event.target.value)}
                    placeholder="e.g. Robinhood f"
                    maxLength={80}
                    className="h-10 rounded-xl border-white/10 bg-white/[0.03] text-[10px]"
                  />
                </label>
              </div>

              <div className="mt-4 overflow-hidden rounded-2xl border border-white/[0.07]">
                <div className="hidden grid-cols-[28px_minmax(150px,1fr)_110px_165px_115px_32px] gap-3 border-b border-white/[0.06] bg-white/[0.025] px-4 py-2 text-[7px] uppercase tracking-[0.13em] text-white/22 lg:grid">
                  <span />
                  <span>Asset</span>
                  <span>Quantity</span>
                  <span>Type</span>
                  <span>Detected value</span>
                  <span />
                </div>
                <div className="max-h-[430px] divide-y divide-white/[0.05] overflow-y-auto">
                  {positions.map((item) => (
                    <ReviewRow
                      key={item.id}
                      item={item}
                      onChange={(patch) => updatePosition(item.id, patch)}
                      onRemove={() =>
                        setPositions((current) =>
                          current.filter((position) => position.id !== item.id),
                        )
                      }
                    />
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={() =>
                  setPositions((current) => [
                    ...current,
                    emptyReviewPosition(current.length),
                  ])
                }
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[8px] text-white/32 transition hover:bg-white/[0.04] hover:text-white/65"
              >
                <Plus className="size-3" /> Add a missed row
              </button>

              <div className="mt-4 flex flex-col gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex gap-4 text-[8px] text-white/30">
                  <span>
                    <b className="font-mono text-white/65">
                      {selectedPositions.length}
                    </b>{' '}
                    selected
                  </span>
                  <span>
                    <b className="font-mono text-white/65">
                      {selectedValue
                        ? formatMoney(selectedValue, true)
                        : 'Unpriced'}
                    </b>{' '}
                    detected value · never used as market price
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setPositions((current) =>
                        current.map((item) => ({ ...item, selected: true })),
                      )
                    }
                    className="text-[8px] text-white/35 hover:text-white"
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setPositions((current) =>
                        current.map((item) => ({ ...item, selected: false })),
                      )
                    }
                    className="text-[8px] text-white/35 hover:text-white"
                  >
                    Clear
                  </button>
                </div>
              </div>

              {rawText && (
                <details className="mt-3 rounded-xl border border-white/[0.06] bg-black/10 px-4 py-3">
                  <summary className="cursor-pointer text-[8px] uppercase tracking-[0.13em] text-white/28">
                    View raw OCR text
                  </summary>
                  <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[8px] leading-4 text-white/30">
                    {rawText}
                  </pre>
                </details>
              )}
            </>
          )}

          {error && (
            <p
              role="alert"
              className="mt-4 flex items-start gap-2 rounded-xl border border-[#ff7777]/18 bg-[#ff7777]/[0.05] px-3 py-2.5 text-[9px] leading-4 text-[#ff9a9a]"
            >
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {error}
            </p>
          )}
        </div>

        <DialogFooter className="m-0 flex-row justify-between rounded-none border-white/[0.07] bg-black/15 px-6 py-4">
          <Button
            type="button"
            variant="ghost"
            onClick={() => (positions.length ? reset() : onOpenChange(false))}
            className="h-9 px-4 text-[9px] text-white/40 hover:bg-white/5 hover:text-white"
          >
            {positions.length ? 'Start over' : 'Cancel'}
          </Button>
          {positions.length ? (
            <Button
              disabled={processing || !selectedPositions.length}
              onClick={() => void importSelected()}
              className="h-9 bg-[#d8ff58] px-5 text-[9px] text-[#090b0b] hover:bg-[#e6ff91]"
            >
              Import {selectedPositions.length} position
              {selectedPositions.length === 1 ? '' : 's'}{' '}
              <ArrowRight className="size-3.5" />
            </Button>
          ) : (
            <Button
              disabled={processing || !images.length}
              onClick={() => void readScreenshots()}
              className="h-9 bg-[#d8ff58] px-5 text-[9px] text-[#090b0b] hover:bg-[#e6ff91]"
            >
              <ScanText className="size-3.5" />{' '}
              {processing ? 'Reading…' : 'Read screenshots'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReviewRow({
  item,
  onChange,
  onRemove,
}: {
  item: ReviewPosition;
  onChange: (patch: Partial<ReviewPosition>) => void;
  onRemove: () => void;
}) {
  const priceSource =
    item.assetType === 'stock'
      ? item.resolved
        ? `${item.name} · Yahoo Finance live`
        : 'Exact Yahoo Finance ticker required'
      : item.coinId
        ? `${item.name} · CoinGecko live`
        : 'Exact CoinGecko ticker required';
  return (
    <div
      className={`grid gap-3 px-4 py-3.5 transition lg:grid-cols-[28px_minmax(150px,1fr)_110px_165px_115px_32px] lg:items-center ${item.selected ? 'bg-transparent' : 'opacity-45'}`}
    >
      <Checkbox
        checked={item.selected}
        onCheckedChange={(checked) => onChange({ selected: checked })}
        aria-label={`Select ${item.symbol}`}
      />
      <div className="min-w-0">
        <div className="flex gap-2">
          <Input
            value={item.symbol}
            onChange={(event) =>
              onChange({
                symbol: normalizeTicker(event.target.value),
                name: normalizeTicker(event.target.value),
                coinId: undefined,
                resolved: false,
              })
            }
            className="h-8 w-24 rounded-lg border-white/[0.08] bg-white/[0.025] px-2 font-mono text-[10px] uppercase"
          />
          <select
            value={item.assetType}
            onChange={(event) =>
              onChange({
                assetType: event.target.value as ScreenshotAssetType,
                name: item.symbol,
                coinId: undefined,
                resolved: false,
                network:
                  event.target.value === 'stock' ? 'US market' : 'Crypto',
                positionType:
                  event.target.value === 'stock' ? 'spot' : item.positionType,
                leverage: event.target.value === 'stock' ? 1 : item.leverage,
              })
            }
            className="h-8 rounded-lg border border-white/[0.08] bg-[#151816] px-2 text-[8px] text-white/50"
          >
            <option value="crypto">Crypto</option>
            <option value="stock">Stock / ETF</option>
          </select>
        </div>
        <p className="mt-1.5 truncate text-[7px] text-white/24">
          {priceSource} ·{' '}
          {item.confidence === 'review'
            ? 'review classification'
            : 'high-confidence row'}
        </p>
      </div>
      <div>
        <span className="mb-1 block text-[7px] uppercase tracking-[0.1em] text-white/20 lg:hidden">
          Quantity
        </span>
        <Input
          value={item.amount}
          onChange={(event) => onChange({ amount: Number(event.target.value) })}
          type="number"
          min="0"
          step="any"
          className="h-8 rounded-lg border-white/[0.08] bg-white/[0.025] px-2 font-mono text-[9px]"
        />
      </div>
      <div
        className={`grid gap-1 ${item.positionType === 'perp' ? 'grid-cols-3' : 'grid-cols-2'}`}
      >
        <select
          value={item.positionType}
          onChange={(event) =>
            onChange({
              positionType: event.target.value as 'spot' | 'perp',
              leverage:
                event.target.value === 'perp' ? Math.max(2, item.leverage) : 1,
            })
          }
          className="h-8 rounded-lg border border-white/[0.08] bg-[#151816] px-2 text-[8px] text-white/50"
        >
          <option value="spot">Spot</option>
          <option value="perp">Perp</option>
        </select>
        {item.positionType === 'perp' ? (
          <>
            <select
              value={item.side}
              onChange={(event) =>
                onChange({ side: event.target.value as 'long' | 'short' })
              }
              aria-label={`${item.symbol} direction`}
              className="h-8 rounded-lg border border-white/[0.08] bg-[#151816] px-1 text-[7px] uppercase text-white/50"
            >
              <option value="long">Long</option>
              <option value="short">Short</option>
            </select>
            <Input
              value={item.leverage}
              onChange={(event) =>
                onChange({ leverage: Number(event.target.value) })
              }
              type="number"
              min="1"
              max="100"
              step="0.1"
              aria-label={`${item.symbol} leverage`}
              className="h-8 rounded-lg border-white/[0.08] bg-white/[0.025] px-2 font-mono text-[8px]"
            />
          </>
        ) : (
          <span className="grid h-8 place-items-center rounded-lg bg-white/[0.02] text-[7px] text-white/18">
            No leverage
          </span>
        )}
      </div>
      <div>
        <span className="mb-1 block text-[7px] uppercase tracking-[0.1em] text-white/20 lg:hidden">
          Detected value
        </span>
        <div className="relative">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 font-mono text-[8px] text-white/20">
            $
          </span>
          <Input
            value={item.totalValue ?? ''}
            onChange={(event) =>
              onChange({
                totalValue: event.target.value
                  ? Number(event.target.value)
                  : undefined,
              })
            }
            type="number"
            min="0"
            step="any"
            className="h-8 rounded-lg border-white/[0.08] bg-white/[0.025] pl-5 pr-2 font-mono text-[8px]"
          />
        </div>
        {item.positionType === 'perp' && (
          <Input
            value={item.entryPrice ?? ''}
            onChange={(event) =>
              onChange({
                entryPrice: event.target.value
                  ? Number(event.target.value)
                  : undefined,
              })
            }
            type="number"
            min="0"
            step="any"
            placeholder="Entry price"
            aria-label={`${item.symbol} entry price`}
            className="mt-1 h-7 rounded-lg border-[#ffd166]/12 bg-[#ffd166]/[0.025] px-2 font-mono text-[7px]"
          />
        )}
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${item.symbol}`}
        className="grid size-7 place-items-center rounded-lg text-white/18 hover:bg-[#ff7777]/10 hover:text-[#ff8585]"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}

async function enrichPositions(
  items: Array<DetectedScreenshotPosition | ReviewPosition>,
  minimumPositionValue: number,
): Promise<ReviewPosition[]> {
  const cache = new Map<string, AssetOption | undefined>();
  return Promise.all(
    items.map(async (item) => {
      const enteredSymbol = normalizeTicker(item.symbol);
      const key = `${item.assetType}:${enteredSymbol}`;
      let exact = cache.get(key);
      if (!cache.has(key)) {
        for (const candidate of ocrTickerAlternatives(enteredSymbol)) {
          try {
            const endpoint =
              item.assetType === 'stock' ? '/api/stock/search' : '/api/search';
            const response = await fetch(
              `${endpoint}?q=${encodeURIComponent(candidate)}`,
            );
            if (!response.ok) continue;
            const data = (await response.json()) as { results?: AssetOption[] };
            exact = findExactAsset(data.results ?? [], candidate);
            if (exact) break;
          } catch {
            exact = undefined;
          }
        }
        cache.set(key, exact);
      }
      const existing = item as Partial<ReviewPosition>;
      const symbol = exact?.symbol ?? enteredSymbol;
      const cutoffValue =
        item.totalValue ?? approximateStablecoinValue(item, symbol);
      return {
        ...item,
        symbol,
        name: exact?.name ?? existing.name ?? symbol,
        network:
          exact?.network ??
          existing.network ??
          (item.assetType === 'stock' ? 'US market' : 'Crypto'),
        coinId:
          item.assetType === 'crypto'
            ? (exact?.id ?? existing.coinId)
            : undefined,
        resolved: Boolean(exact),
        selected:
          existing.selected ??
          (cutoffValue == null || cutoffValue >= minimumPositionValue),
      };
    }),
  );
}

const STABLECOIN_TICKERS = new Set([
  'USDC',
  'USDT',
  'DAI',
  'FDUSD',
  'PYUSD',
  'TUSD',
  'USDE',
  'USDS',
]);

function approximateStablecoinValue(
  item: DetectedScreenshotPosition | ReviewPosition,
  symbol: string,
) {
  return item.assetType === 'crypto' && STABLECOIN_TICKERS.has(symbol)
    ? Number(item.amount)
    : undefined;
}

function InfoTile({
  icon: Icon,
  title,
  detail,
}: {
  icon: typeof ShieldCheck;
  title: string;
  detail: string;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.018] p-3">
      <Icon className="size-3.5 text-[#d8ff58]/50" />
      <p className="mt-2 text-[9px] font-medium text-white/55">{title}</p>
      <p className="mt-1 text-[8px] leading-4 text-white/24">{detail}</p>
    </div>
  );
}

function humanizeStatus(status: string) {
  return status
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatFileSize(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.ceil(bytes / 1024)} KB`;
}

function effectiveEntryPrice(item: ReviewPosition) {
  const explicit = Number(item.entryPrice);
  return explicit > 0 ? explicit : 0;
}

function emptyReviewPosition(index: number): ReviewPosition {
  return {
    id: `manual-review-${Date.now()}-${index}`,
    symbol: '',
    name: '',
    amount: 0,
    assetType: 'crypto',
    positionType: 'spot',
    side: 'long',
    leverage: 1,
    confidence: 'review',
    evidence: 'Manually added review row',
    network: 'Crypto',
    resolved: false,
    selected: true,
  };
}

async function enhanceScreenshot(file: File) {
  const bitmap = await createImageBitmap(file);
  const maxPixels = 9_000_000;
  const preferredScale = Math.min(2.25, 2400 / bitmap.width);
  const pixelScale = Math.sqrt(maxPixels / (bitmap.width * bitmap.height));
  const scale = Math.max(1, Math.min(preferredScale, pixelScale));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    bitmap.close();
    throw new Error('This browser could not prepare the screenshot.');
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < pixels.data.length; index += 4) {
    const luminance =
      pixels.data[index] * 0.299 +
      pixels.data[index + 1] * 0.587 +
      pixels.data[index + 2] * 0.114;
    const contrasted = Math.max(
      0,
      Math.min(255, (luminance - 128) * 1.65 + 128),
    );
    pixels.data[index] = contrasted;
    pixels.data[index + 1] = contrasted;
    pixels.data[index + 2] = contrasted;
  }
  context.putImageData(pixels, 0, 0);
  return canvas;
}

function textFromBlocks(
  blocks: Array<{
    paragraphs?: Array<{
      lines?: Array<{ text?: string; bbox?: { y0?: number; x0?: number } }>;
    }>;
  }> | null,
) {
  const lines = (blocks ?? []).flatMap((block) =>
    (block.paragraphs ?? []).flatMap((paragraph) => paragraph.lines ?? []),
  );
  return lines
    .sort(
      (left, right) =>
        Number(left.bbox?.y0 ?? 0) - Number(right.bbox?.y0 ?? 0) ||
        Number(left.bbox?.x0 ?? 0) - Number(right.bbox?.x0 ?? 0),
    )
    .map((line) => line.text?.trim())
    .filter(Boolean)
    .join('\n');
}

function detectPlatform(text: string) {
  const normalized = text.toLowerCase();
  const signatures: Array<[string, string]> = [
    ['variational', 'Variational'],
    ['robinhood', 'Robinhood'],
    ['hyperliquid', 'Hyperliquid'],
    ['lighter', 'Lighter'],
    ['coinbase', 'Coinbase'],
    ['binance', 'Binance'],
    ['kraken', 'Kraken'],
    ['bybit', 'Bybit'],
    ['fidelity', 'Fidelity'],
    ['schwab', 'Charles Schwab'],
    ['interactive brokers', 'Interactive Brokers'],
    ['etrade', 'E*TRADE'],
    ['e*trade', 'E*TRADE'],
    ['webull', 'Webull'],
    ['vanguard', 'Vanguard'],
  ];
  return signatures.find(([signature]) => normalized.includes(signature))?.[1];
}
