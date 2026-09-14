import type { LucideIcon } from 'lucide-react';

import { KqlViewer, type KqlEntry } from '@/components/KqlViewer';

interface MetricCardProps {
  label: string;
  value: string;
  detail: string;
  tone: 'good' | 'warn' | 'critical' | 'neutral';
  icon: LucideIcon;
  queries: KqlEntry[];
}

export function MetricCard({ label, value, detail, tone, icon: Icon, queries }: MetricCardProps) {
  return (
    <article className={`metric-card metric-card--${tone}`}>
      <div className="metric-card__top">
        <span>{label}</span>
        <div><KqlViewer title={label} queries={queries} /><Icon size={17} aria-hidden="true" /></div>
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}