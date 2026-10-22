import { useState } from 'react';
import { DropdownMenu } from 'radix-ui';

const PRESETS = [10, 11, 12, 14, 15, 16, 18, 20, 24, 28, 32, 36, 40, 48, 64, 96, 128];

/** Editable value plus an accessible Radix menu (the primitives used by shadcn). */
export function NumericSetting({ value, onChange, id, label, unit, min, max, presets }: {
  value: number; onChange: (value: number) => void; id: string; label: string; unit: string;
  min: number; max: number; presets: readonly number[];
}) {
  const [draft, setDraft] = useState(String(value));
  const choose = (size: number) => { onChange(size); setDraft(String(size)); };
  return <div className="font-size-settings">
    <label className="font-size-control" htmlFor={id}>{label} <span>({unit})</span></label>
    <div className="font-size-field">
      <input id={id} className="font-size-input" type="text" inputMode="decimal" value={draft}
        onChange={event => {
          const text = event.target.value;
          setDraft(text);
          const size = Number(text);
          if (text.trim() && Number.isFinite(size) && size >= min && size <= max) onChange(size);
        }}
        onBlur={() => setDraft(String(value))}
        onKeyDown={event => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') { setDraft(String(value)); event.currentTarget.blur(); }
        }}
        />
      <DropdownMenu.Root>
        <DropdownMenu.Trigger className="font-size-trigger" aria-label={`Choose ${label.toLowerCase()}`}>▾</DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="font-size-menu export-ui" align="end" sideOffset={4} collisionPadding={12}>
            <DropdownMenu.RadioGroup value={String(value)} onValueChange={size => choose(Number(size))}>
              {presets.map(size => <DropdownMenu.RadioItem key={size} value={String(size)} className="font-size-option">
                <span>{size}</span><DropdownMenu.ItemIndicator aria-hidden="true">✓</DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>)}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  </div>;
}

export function FontSize({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return <NumericSetting value={value} onChange={onChange} id="document-font-size" label="Font size" unit="px" min={10} max={128} presets={PRESETS} />;
}
