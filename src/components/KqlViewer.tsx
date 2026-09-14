import { Check, Clipboard, Code2, X } from 'lucide-react';
import { useRef, useState } from 'react';

export interface KqlEntry {
  label: string;
  text: string;
}

interface KqlViewerProps {
  title: string;
  queries: KqlEntry[];
}

export function KqlViewer({ title, queries }: KqlViewerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [copied, setCopied] = useState('');

  if (!queries.length) return null;

  const copy = async (query: KqlEntry) => {
    await navigator.clipboard.writeText(query.text);
    setCopied(query.label);
    window.setTimeout(() => setCopied(''), 1600);
  };

  return <>
    <button type="button" className="kql-trigger" title={`View KQL for ${title}`} aria-label={`View KQL for ${title}`} onClick={() => dialogRef.current?.showModal()}><Code2 size={15} /></button>
    <dialog className="kql-dialog" ref={dialogRef} onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }}>
      <header><div><small>Executed on Kuskus</small><h2>{title} KQL</h2></div><button type="button" aria-label="Close KQL" title="Close" onClick={() => dialogRef.current?.close()}><X size={17} /></button></header>
      <div className="kql-dialog__body">{queries.map((query) => <section key={query.label}><div><h3>{query.label}</h3><button type="button" onClick={() => void copy(query)}>{copied === query.label ? <Check size={14} /> : <Clipboard size={14} />}{copied === query.label ? 'Copied' : 'Copy KQL'}</button></div><pre>{query.text}</pre></section>)}</div>
    </dialog>
  </>;
}