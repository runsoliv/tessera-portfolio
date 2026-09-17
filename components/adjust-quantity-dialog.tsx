'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Calculator } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { formatMoney, formatNumber, type Holding } from '@/lib/portfolio';
import type { QuantityAdjustment } from '@/lib/wallet-import';

type Props = {
  holding: Holding | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdjust: (holding: Holding, adjustment: QuantityAdjustment) => void;
};

export function AdjustQuantityDialog({ holding, open, onOpenChange, onAdjust }: Props) {
  const [operation, setOperation] = useState<'increase' | 'decrease'>('increase');
  const [quantity, setQuantity] = useState('');
  const [executionPrice, setExecutionPrice] = useState('');
  const [margin, setMargin] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      setOperation('increase');
      setQuantity('');
      setExecutionPrice('');
      setMargin('');
      setError('');
    });
  }, [open, holding]);

  const preview = useMemo(() => {
    const amount = Number(quantity);
    if (!holding || !(amount > 0)) return holding?.amount ?? 0;
    return operation === 'increase' ? holding.amount + amount : Math.max(0, holding.amount - amount);
  }, [holding, operation, quantity]);

  function submit(event: { preventDefault: () => void }) {
    event.preventDefault();
    if (!holding) return;
    const amount = Number(quantity);
    const price = executionPrice ? Number(executionPrice) : undefined;
    const addedMargin = margin ? Number(margin) : undefined;
    if (!Number.isFinite(amount) || amount <= 0) return setError('Enter a quantity greater than zero.');
    if (operation === 'decrease' && amount >= holding.amount) return setError('The decrease must be smaller than the current quantity. Remove the position to reduce it to zero.');
    if (price !== undefined && (!Number.isFinite(price) || price <= 0)) return setError('Execution price must be greater than zero.');
    if (addedMargin !== undefined && (!Number.isFinite(addedMargin) || addedMargin <= 0)) return setError('Added margin must be greater than zero.');
    onAdjust(holding, { operation, quantity: amount, executionPrice: price, marginAmount: addedMargin });
    onOpenChange(false);
  }

  const isPerp = holding?.positionType === 'perp';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border border-white/10 bg-[#111412] p-0 sm:max-w-[480px]">
        <DialogHeader className="border-b border-white/[0.07] px-6 py-5">
          <DialogTitle className="text-lg font-semibold tracking-[-0.035em]">Adjust {holding?.symbol} quantity</DialogTitle>
          <DialogDescription className="text-xs text-white/40">Record a manual increase or decrease without reconnecting the original wallet.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <div className="space-y-5 px-6 py-5">
            <div className="grid grid-cols-2 gap-1 rounded-xl border border-white/[0.07] bg-black/20 p-1">
              <button type="button" onClick={() => setOperation('increase')} className={`flex h-10 items-center justify-center gap-2 rounded-lg text-[10px] font-semibold transition ${operation === 'increase' ? 'bg-[#d8ff58]/10 text-[#d8ff58]' : 'text-white/30 hover:text-white/60'}`}><ArrowUp className="size-3.5" /> Increase</button>
              <button type="button" onClick={() => setOperation('decrease')} className={`flex h-10 items-center justify-center gap-2 rounded-lg text-[10px] font-semibold transition ${operation === 'decrease' ? 'bg-[#ff7777]/10 text-[#ff8585]' : 'text-white/30 hover:text-white/60'}`}><ArrowDown className="size-3.5" /> Decrease</button>
            </div>

            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.05]">
              <Summary label="Current quantity" value={`${formatNumber(holding?.amount ?? 0)} ${holding?.symbol ?? ''}`} />
              <Summary label="Quantity after" value={`${formatNumber(preview)} ${holding?.symbol ?? ''}`} />
            </div>

            <label htmlFor="adjust-quantity"><span className="mb-2 block text-[8px] font-medium uppercase tracking-[0.15em] text-white/30">Quantity to {operation}</span><Input id="adjust-quantity" value={quantity} onChange={(event) => { setQuantity(event.target.value); setError(''); }} type="number" min="0" step="any" placeholder="0.00" className="form-input font-mono" /></label>

            {operation === 'increase' && (
              <div className={`grid gap-4 ${isPerp ? 'sm:grid-cols-2' : ''}`}>
                <label htmlFor="adjust-execution-price"><span className="mb-2 block text-[8px] font-medium uppercase tracking-[0.15em] text-white/30">{isPerp ? 'Execution price' : 'Purchase price'} (optional)</span><Input id="adjust-execution-price" value={executionPrice} onChange={(event) => setExecutionPrice(event.target.value)} type="number" min="0" step="any" placeholder={holding?.price ? formatMoney(holding.price).replace('$', '') : '0.00'} className="form-input font-mono" /></label>
                {isPerp && <label htmlFor="adjust-margin"><span className="mb-2 block text-[8px] font-medium uppercase tracking-[0.15em] text-white/30">Added margin (optional)</span><Input id="adjust-margin" value={margin} onChange={(event) => setMargin(event.target.value)} type="number" min="0" step="any" placeholder="Calculated from leverage" className="form-input font-mono" /></label>}
              </div>
            )}

            <div className="flex items-start gap-2 rounded-xl border border-white/[0.06] bg-white/[0.025] p-3 text-[9px] leading-4 text-white/30"><Calculator className="mt-0.5 size-3.5 shrink-0 text-[#d8ff58]/60" />{isPerp ? operation === 'increase' ? 'Entry price is volume-weighted when an execution price is supplied. Margin is added explicitly or estimated from leverage.' : 'Entry price stays unchanged and allocated margin is reduced in proportion to the quantity.' : operation === 'increase' ? 'Average cost is volume-weighted when a purchase price is supplied.' : 'Average cost per coin stays unchanged.'}</div>
            {error && <p role="alert" className="rounded-xl border border-[#ff7777]/20 bg-[#ff7777]/[0.06] px-3 py-2 text-[10px] text-[#ff9999]">{error}</p>}
          </div>
          <DialogFooter className="m-0 flex-row justify-end rounded-none border-white/[0.07] bg-black/15 px-6 py-4"><Button type="button" variant="ghost" onClick={() => onOpenChange(false)} className="text-white/45">Cancel</Button><Button type="submit" className="bg-[#d8ff58] text-[#090b0b] hover:bg-[#e4ff83]">Save adjustment</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className="bg-[#0d100f] p-3"><p className="text-[7px] uppercase tracking-[0.14em] text-white/22">{label}</p><p className="mt-1.5 font-mono text-[9px] text-white/65">{value}</p></div>;
}
