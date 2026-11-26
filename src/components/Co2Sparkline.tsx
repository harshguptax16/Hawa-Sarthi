import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import type { DailyCo2Point, ThemeMode } from '../types.ts';

interface Co2SparklineProps {
  data: DailyCo2Point[];
  theme: ThemeMode;
}

export const Co2Sparkline: React.FC<Co2SparklineProps> = ({ data, theme }) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const total7DayGrams = data.reduce((sum, d) => sum + d.gramsSaved, 0);
  const activeIndex = hoveredIndex !== null ? hoveredIndex : Math.max(0, data.length - 1);
  const activePoint = data[activeIndex];

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl || data.length === 0) return;

    const width = 200;
    const height = 46;
    const padX = 6;
    const padTop = 6;
    const padBottom = 6;

    const strokeColor = theme === 'dark' ? '#2dd4bf' : '#0d9488';
    const areaTopColor = theme === 'dark' ? 'rgba(45, 212, 191, 0.24)' : 'rgba(13, 148, 136, 0.18)';
    const areaBottomColor = theme === 'dark' ? 'rgba(45, 212, 191, 0.0)' : 'rgba(13, 148, 136, 0.0)';
    const baselineColor = theme === 'dark' ? '#1e293b' : '#e2e8f0';
    const dotBgColor = theme === 'dark' ? '#0f172a' : '#ffffff';

    const maxVal = Math.max(100, d3.max(data, (d) => d.gramsSaved) ?? 0);

    const xScale = d3
      .scaleLinear()
      .domain([0, Math.max(1, data.length - 1)])
      .range([padX, width - padX]);

    const yScale = d3
      .scaleLinear()
      .domain([0, maxVal])
      .range([height - padBottom, padTop]);

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const defs = svg.append('defs');
    const gradId = `co2-spark-grad-${theme}`;
    const gradient = defs
      .append('linearGradient')
      .attr('id', gradId)
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');
    gradient.append('stop').attr('offset', '0%').attr('stop-color', areaTopColor);
    gradient.append('stop').attr('offset', '100%').attr('stop-color', areaBottomColor);

    // Subtle baseline rule
    svg
      .append('line')
      .attr('x1', padX)
      .attr('x2', width - padX)
      .attr('y1', height - padBottom)
      .attr('y2', height - padBottom)
      .attr('stroke', baselineColor)
      .attr('stroke-width', 1);

    const areaGen = d3
      .area<DailyCo2Point>()
      .x((_, i) => xScale(i))
      .y0(height - padBottom)
      .y1((d) => yScale(d.gramsSaved))
      .curve(d3.curveMonotoneX);

    const lineGen = d3
      .line<DailyCo2Point>()
      .x((_, i) => xScale(i))
      .y((d) => yScale(d.gramsSaved))
      .curve(d3.curveMonotoneX);

    svg
      .append('path')
      .datum(data)
      .attr('fill', `url(#${gradId})`)
      .attr('d', areaGen);

    svg
      .append('path')
      .datum(data)
      .attr('fill', 'none')
      .attr('stroke', strokeColor)
      .attr('stroke-width', 1.75)
      .attr('stroke-linecap', 'round')
      .attr('stroke-linejoin', 'round')
      .attr('d', lineGen);

    // Highlight active (hovered or latest) point
    const highlightIdx = hoveredIndex !== null ? hoveredIndex : data.length - 1;
    const highlightDatum = data[highlightIdx];
    if (highlightDatum) {
      svg
        .append('circle')
        .attr('cx', xScale(highlightIdx))
        .attr('cy', yScale(highlightDatum.gramsSaved))
        .attr('r', 3)
        .attr('fill', dotBgColor)
        .attr('stroke', strokeColor)
        .attr('stroke-width', 1.75);
    }

    // Invisible interactive hit columns for smooth pointer inspection
    const colWidth = (width - padX * 2) / Math.max(1, data.length);
    svg
      .selectAll('rect.hit-col')
      .data(data)
      .enter()
      .append('rect')
      .attr('class', 'hit-col')
      .attr('x', (_, i) => Math.max(0, xScale(i) - colWidth / 2))
      .attr('y', 0)
      .attr('width', colWidth)
      .attr('height', height)
      .attr('fill', 'transparent')
      .style('cursor', 'pointer')
      .on('mouseenter', (_, d) => {
        const idx = data.indexOf(d);
        if (idx >= 0) setHoveredIndex(idx);
      })
      .on('mouseleave', () => setHoveredIndex(null));
  }, [data, theme, hoveredIndex]);

  const formatGrams = (g: number) =>
    g >= 1000 ? `${(g / 1000).toFixed(2)} kg` : `${g} g`;

  return (
    <div className="mt-2.5 border-t border-slate-200 pt-2.5 dark:border-slate-800">
      <div className="mb-1 flex items-baseline justify-between gap-2 text-[11px]">
        <span className="text-slate-500 dark:text-slate-400">7-day CO₂ trend</span>
        <span className="font-mono font-medium tabular-nums text-slate-900 dark:text-slate-100">
          {activePoint ? `${activePoint.label}: ${formatGrams(activePoint.gramsSaved)}` : '0 g'}
        </span>
      </div>

      <svg
        ref={svgRef}
        viewBox="0 0 200 46"
        className="h-11 w-full overflow-visible"
        role="img"
        aria-label={`7-day CO2 savings sparkline totaling ${formatGrams(total7DayGrams)}`}
      />

      <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400 dark:text-slate-500">
        <span>{data[0]?.label ?? '-6d'}</span>
        <span className="font-mono tabular-nums">
          7d total: {formatGrams(total7DayGrams)}
        </span>
        <span>Today</span>
      </div>
    </div>
  );
};
