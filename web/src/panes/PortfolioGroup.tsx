import { useEffect, useState } from 'react';
import { getJson } from '../store';
import { Icon } from '../Icon';
import { press } from '../press';
import { SITE_DEFAULT } from '../../../shared/portfolio';
import { PORTFOLIO_CHANGED, RunMark, openPortfolio, runTitle } from './Portfolio';
import { SHOWN_RUNS, newCount, type PortfolioView } from './portfolioState';

// The Portfolio group in the sidebar: one row per Framer site (richadesign.in) with a Count pill of new finished
// work, and the last 3 runs under it. It heads the tree, never under a project: the site is not a Figma file.

export function PortfolioGroup() {
  const [view, setView] = useState<PortfolioView | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => void getJson<PortfolioView>('/api/portfolio').then((v) => live && setView(v)).catch(() => {});
    load();
    window.addEventListener(PORTFOLIO_CHANGED, load);
    const t = setInterval(load, 60_000);
    return () => {
      live = false;
      window.removeEventListener(PORTFOLIO_CHANGED, load);
      clearInterval(t);
    };
  }, []);

  const n = newCount(view);
  const site = view?.config?.site ?? SITE_DEFAULT;
  return (
    <>
      <div className="row group-row pf-group" role="heading" aria-level={3}>Portfolio</div>
      <div className="row session pf-site-row" title={`Update portfolio: ${site}`} onClick={() => openPortfolio()} {...press(() => openPortfolio())}>
        <span className="twistie"><Icon name="globe" small /></span>
        <span className="name">{site}</span>
        {n > 0 && <span className="meta"><span className="badge" title={`${n} new to add`} aria-label={`${n} new`}>{n}</span></span>}
      </div>
      {view?.runs.slice(0, SHOWN_RUNS).map((r) => (
        <div key={r.id} className="row session recent pf-run-row" title={runTitle(r)} onClick={() => openPortfolio(r.id)} {...press(() => openPortfolio(r.id))}>
          <RunMark state={r.state} />
          <span className="name">{runTitle(r)}</span>
        </div>
      ))}
    </>
  );
}
