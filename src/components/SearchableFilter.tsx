import { Check, ChevronDown, Search, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

export interface SearchableFilterOption {
  label: string;
  value: string;
}

interface SearchableFilterProps {
  label: string;
  options: SearchableFilterOption[];
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  clearable?: boolean;
  allowCustomValue?: boolean;
  onSearch?: (query: string) => void | Promise<void>;
}

export function SearchableFilter({ label, options, placeholder, value, onChange, className, clearable = true, allowCustomValue = false, onSearch }: SearchableFilterProps) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [executedQuery, setExecutedQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const selected = options.find((option) => option.value === value)
    ?? (allowCustomValue && value ? { label: value, value } : undefined);
  const matches = options.filter((option) => option.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));

  useEffect(() => {
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, []);

  const choose = (option: SearchableFilterOption | null) => {
    onChange(option?.value ?? '');
    setQuery('');
    setExecutedQuery('');
    setOpen(false);
  };

  const executeSearch = async () => {
    const search = query.trim();
    if ((!onSearch && !allowCustomValue) || search.length < 2 || searching) return;
    if (allowCustomValue) {
      choose({ label: search, value: search });
      return;
    }
    if (!onSearch) return;
    setOpen(true);
    setSearching(true);
    try {
      await onSearch(search);
      setExecutedQuery(search);
      setActiveIndex(0);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div
      className={`searchable-filter${className ? ` ${className}` : ''}`}
      ref={rootRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <span className="filter-label">{label}</span>
      <div className="searchable-filter__control">
        <button type="button" disabled={query.trim().length < 2 || searching || (!onSearch && !allowCustomValue)} onClick={() => void executeSearch()} aria-label={`Execute ${label} search`} title={`Search ${label}`}>
          <Search size={14} aria-hidden="true" />
        </button>
        <input
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={open}
          aria-label={`Search ${label}`}
          role="combobox"
          value={open ? query : (selected?.label ?? '')}
          placeholder={placeholder}
          onChange={(event) => { setQuery(event.target.value); setExecutedQuery(''); setActiveIndex(0); setOpen(true); }}
          onFocus={() => { setQuery(''); setExecutedQuery(''); setActiveIndex(0); setOpen(true); }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false);
            if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActiveIndex((index) => Math.min(index + 1, Math.max(matches.length - 1, 0))); }
            if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((index) => Math.max(index - 1, 0)); }
            if (event.key === 'Enter' && query.trim().length >= 2) {
              event.preventDefault();
              if (query.trim() === executedQuery && matches[activeIndex]) choose(matches[activeIndex]);
              else void executeSearch();
            }
          }}
        />
        {value && clearable ? <button type="button" onClick={() => choose(null)} aria-label={`Clear ${label}`}><X size={14} /></button> : <ChevronDown size={14} aria-hidden="true" />}
      </div>
      {open && <div className="searchable-filter__menu" id={listboxId} role="listbox">
        {clearable && <button type="button" className={!value ? 'selected' : ''} role="option" aria-selected={!value} onClick={() => choose(null)}>
          <span>{placeholder}</span>{!value && <Check size={14} />}
        </button>}
        {matches.map((option, index) => <button type="button" className={`${option.value === value ? 'selected ' : ''}${index === activeIndex ? 'active' : ''}`} key={option.value} role="option" aria-selected={option.value === value} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(option)}>
          <span>{option.label}</span>{option.value === value && <Check size={14} />}
        </button>)}
        {searching ? <p>Searching…</p> : !matches.length && <p>{executedQuery === query.trim() ? 'No matches' : 'Press Enter or use search'}</p>}
      </div>}
    </div>
  );
}