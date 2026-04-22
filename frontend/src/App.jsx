import { useEffect, useMemo, useState } from 'react'
import plotlyFactory from 'react-plotly.js/factory'
import Plotly from 'plotly.js-dist-min'
import './App.css'

const createPlotlyComponent = plotlyFactory?.default ?? plotlyFactory
const Plot = createPlotlyComponent(Plotly)

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const formatDateInput = (date) => date.toISOString().slice(0, 10)

const toIsoStart = (dateString) => `${dateString}T00:00:00Z`
const toIsoEnd = (dateString) => `${dateString}T23:00:00Z`

const formatPercent = (value) => `${value > 0 ? '+' : ''}${value.toFixed(1)}%`
const formatPrice = (value) => `${value.toFixed(2)} EUR/MWh`
const toDayKey = (date) => date.toISOString().slice(0, 10)

function App() {
  const [countries, setCountries] = useState([])
  const [country, setCountry] = useState('DE')
  const [spreadCountry, setSpreadCountry] = useState('FR')
  const [startDate, setStartDate] = useState(() => {
    const start = new Date()
    start.setDate(start.getDate() - 7)
    return formatDateInput(start)
  })
  const [endDate, setEndDate] = useState(() => formatDateInput(new Date()))
  const [points, setPoints] = useState([])
  const [spreadPoints, setSpreadPoints] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [spreadLoading, setSpreadLoading] = useState(false)
  const [spreadError, setSpreadError] = useState('')
  const [showMix, setShowMix] = useState(true)
  const [mixSeries, setMixSeries] = useState([])
  const [mixLoading, setMixLoading] = useState(false)
  const [mixError, setMixError] = useState('')

  useEffect(() => {
    const fetchCountries = async () => {
      try {
        const response = await fetch(`${API_BASE}/countries`)
        if (!response.ok) {
          throw new Error('Failed to load countries')
        }
        const data = await response.json()
        setCountries(data.countries || [])
        if (data.countries?.length) {
          setCountry((current) => current || data.countries[0])
          setSpreadCountry((current) =>
            current && current !== data.countries[0]
              ? current
              : data.countries[1] || data.countries[0],
          )
        }
      } catch (err) {
        setError('Unable to reach the API. Is the backend running?')
      }
    }

    fetchCountries()
  }, [])

  const loadGenerationMix = async () => {
    if (!showMix) {
      return
    }
    setMixLoading(true)
    setMixError('')

    try {
      const params = new URLSearchParams({
        country,
        start: toIsoStart(startDate),
        end: toIsoEnd(endDate),
      })
      const response = await fetch(
        `${API_BASE}/generation?${params.toString()}`,
      )
      if (!response.ok) {
        throw new Error('Failed to load generation mix')
      }
      const data = await response.json()
      setMixSeries(data.series || [])
    } catch (err) {
      setMixError('Generation mix is unavailable for this range.')
    } finally {
      setMixLoading(false)
    }
  }

  const loadPrices = async () => {
    setLoading(true)
    setError('')

    try {
      const params = new URLSearchParams({
        country,
        start: toIsoStart(startDate),
        end: toIsoEnd(endDate),
      })
      const response = await fetch(`${API_BASE}/prices?${params.toString()}`)
      if (!response.ok) {
        throw new Error('Failed to load prices')
      }
      const data = await response.json()
      setPoints(data.points || [])
    } catch (err) {
      setError('Could not load price data. Check the API response.')
    } finally {
      setLoading(false)
    }

    if (showMix) {
      await loadGenerationMix()
    }

    await loadSpreadPrices()
  }

  const loadSpreadPrices = async () => {
    if (!spreadCountry || spreadCountry === country) {
      setSpreadPoints([])
      return
    }

    setSpreadLoading(true)
    setSpreadError('')

    try {
      const params = new URLSearchParams({
        country: spreadCountry,
        start: toIsoStart(startDate),
        end: toIsoEnd(endDate),
      })
      const response = await fetch(`${API_BASE}/prices?${params.toString()}`)
      if (!response.ok) {
        throw new Error('Failed to load spread prices')
      }
      const data = await response.json()
      setSpreadPoints(data.points || [])
    } catch (err) {
      setSpreadError('Could not load comparison market data.')
    } finally {
      setSpreadLoading(false)
    }
  }

  useEffect(() => {
    if (country) {
      loadPrices()
    }
  }, [country])

  useEffect(() => {
    if (country && spreadCountry) {
      loadSpreadPrices()
    }
  }, [spreadCountry])

  useEffect(() => {
    if (showMix && country) {
      loadGenerationMix()
    }
  }, [showMix])

  const stats = useMemo(() => {
    if (!points.length) {
      return null
    }

    const values = points.map((point) => point.price_eur_mwh)
    const max = Math.max(...values)
    const min = Math.min(...values)
    const avg = values.reduce((sum, value) => sum + value, 0) / values.length
    const variance =
      values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length
    const volatility = Math.sqrt(variance)

    let maxJump = 0
    let maxJumpFrom = null
    let maxJumpTo = null

    for (let i = 1; i < points.length; i += 1) {
      const prev = points[i - 1]
      const current = points[i]
      const jump = Math.abs(current.price_eur_mwh - prev.price_eur_mwh)
      if (jump > maxJump) {
        maxJump = jump
        maxJumpFrom = prev
        maxJumpTo = current
      }
    }

    const dailyBuckets = points.reduce((acc, point) => {
      const key = toDayKey(new Date(point.timestamp))
      if (!acc[key]) {
        acc[key] = []
      }
      acc[key].push(point.price_eur_mwh)
      return acc
    }, {})

    const dayKeys = Object.keys(dailyBuckets).sort()
    const lastDayKey = dayKeys[dayKeys.length - 1]
    const prevDayKey = dayKeys[dayKeys.length - 2]
    const firstDayKey = dayKeys[0]

    const averageOfDay = (key) => {
      const valuesForDay = dailyBuckets[key] || []
      if (!valuesForDay.length) {
        return null
      }
      return (
        valuesForDay.reduce((sum, value) => sum + value, 0) /
        valuesForDay.length
      )
    }

    const lastDayAvg = averageOfDay(lastDayKey)
    const prevDayAvg = averageOfDay(prevDayKey)
    const firstDayAvg = averageOfDay(firstDayKey)

    const dayChange =
      prevDayAvg !== null && lastDayAvg !== null && prevDayAvg !== 0
        ? ((lastDayAvg - prevDayAvg) / prevDayAvg) * 100
        : null
    const weekChange =
      firstDayAvg !== null && lastDayAvg !== null && firstDayAvg !== 0
        ? ((lastDayAvg - firstDayAvg) / firstDayAvg) * 100
        : null

    const maxPoint = points.reduce(
      (current, point) =>
        point.price_eur_mwh > current.price_eur_mwh ? point : current,
      points[0],
    )
    const minPoint = points.reduce(
      (current, point) =>
        point.price_eur_mwh < current.price_eur_mwh ? point : current,
      points[0],
    )

    return {
      max,
      min,
      avg,
      volatility,
      maxPoint,
      minPoint,
      maxJump,
      maxJumpFrom,
      maxJumpTo,
      dayChange,
      weekChange,
      lastDayAvg,
      prevDayAvg,
      firstDayAvg,
      lastDayKey,
    }
  }, [points])

  const mixStats = useMemo(() => {
    if (!mixSeries.length) {
      return null
    }

    const totals = mixSeries.map((series) => {
      const sum = series.points.reduce((acc, point) => acc + point.value_mw, 0)
      const avg = sum / Math.max(series.points.length, 1)
      return { fuel: series.fuel_type, avg }
    })

    const totalAvg = totals.reduce((acc, item) => acc + item.avg, 0)
    const top = totals.reduce(
      (current, item) => (item.avg > current.avg ? item : current),
      totals[0],
    )

    const renewables = new Set([
      'Wind Offshore',
      'Wind Onshore',
      'Solar',
      'Hydro Run-of-river',
      'Hydro Reservoir',
      'Hydro Pumped Storage',
      'Biomass',
      'Other renewable',
      'Geothermal',
      'Marine',
    ])

    const renewableAvg = totals
      .filter((item) => renewables.has(item.fuel))
      .reduce((acc, item) => acc + item.avg, 0)

    return {
      topFuel: top.fuel,
      topShare: totalAvg > 0 ? (top.avg / totalAvg) * 100 : 0,
      renewableShare: totalAvg > 0 ? (renewableAvg / totalAvg) * 100 : 0,
    }
  }, [mixSeries])

  const chartData = useMemo(() => {
    return [
      {
        x: points.map((point) => point.timestamp),
        y: points.map((point) => point.price_eur_mwh),
        type: 'scatter',
        mode: 'lines',
        line: { color: '#ff5a1f', width: 3 },
        hovertemplate: '%{x}<br>%{y:.2f} EUR/MWh<extra></extra>',
      },
    ]
  }, [points])

  const mixChartData = useMemo(() => {
    if (!mixSeries.length) {
      return []
    }

    const timestamps = mixSeries[0].points.map((point) => point.timestamp)
    const seriesWithAvg = mixSeries.map((series) => {
      const avg =
        series.points.reduce((acc, point) => acc + point.value_mw, 0) /
        Math.max(series.points.length, 1)
      return { ...series, avg }
    })

    const sorted = [...seriesWithAvg].sort((a, b) => b.avg - a.avg)
    const top = sorted.slice(0, 6)
    const rest = sorted.slice(6)

    const colorPalette = [
      '#0ea5e9',
      '#38bdf8',
      '#22c55e',
      '#a3e635',
      '#f97316',
      '#facc15',
      '#cbd5f5',
    ]

    const buildSeriesValues = (series) => {
      const map = new Map(
        series.points.map((point) => [point.timestamp, point.value_mw]),
      )
      return timestamps.map((time) => map.get(time) ?? 0)
    }

    const traces = top.map((series, index) => ({
      x: timestamps,
      y: buildSeriesValues(series),
      type: 'scatter',
      mode: 'lines',
      name: series.fuel_type,
      stackgroup: 'one',
      line: { width: 0.5, color: colorPalette[index] || '#94a3b8' },
      hovertemplate: '%{x}<br>%{y:.1f} MW<extra></extra>',
    }))

    if (rest.length) {
      const combined = timestamps.map((timestamp, idx) => {
        return rest.reduce((acc, series) => {
          const map = new Map(
            series.points.map((point) => [point.timestamp, point.value_mw]),
          )
          return acc + (map.get(timestamp) ?? 0)
        }, 0)
      })
      traces.push({
        x: timestamps,
        y: combined,
        type: 'scatter',
        mode: 'lines',
        name: 'Other',
        stackgroup: 'one',
        line: { width: 0.5, color: '#94a3b8' },
        hovertemplate: '%{x}<br>%{y:.1f} MW<extra></extra>',
      })
    }

    return traces
  }, [mixSeries])

  const spreadSeries = useMemo(() => {
    if (!points.length || !spreadPoints.length) {
      return { x: [], y: [] }
    }

    const spreadMap = new Map(
      spreadPoints.map((point) => [
        new Date(point.timestamp).toISOString(),
        point.price_eur_mwh,
      ]),
    )

    const x = []
    const y = []
    points.forEach((point) => {
      const key = new Date(point.timestamp).toISOString()
      if (!spreadMap.has(key)) {
        return
      }
      x.push(point.timestamp)
      y.push(point.price_eur_mwh - spreadMap.get(key))
    })

    return { x, y }
  }, [points, spreadPoints])

  const spreadChartData = useMemo(() => {
    if (!spreadSeries.x.length) {
      return []
    }
    return [
      {
        x: spreadSeries.x,
        y: spreadSeries.y,
        type: 'scatter',
        mode: 'lines',
        line: { color: '#0ea5e9', width: 3 },
        hovertemplate: '%{x}<br>%{y:.2f} EUR/MWh<extra></extra>',
      },
    ]
  }, [spreadSeries])

  const annotations = useMemo(() => {
    if (!points.length || !stats) {
      return []
    }

    const topSpikes = [...points]
      .sort((a, b) => b.price_eur_mwh - a.price_eur_mwh)
      .slice(0, 2)
    const annotationsList = topSpikes.map((point, index) => ({
      x: point.timestamp,
      y: point.price_eur_mwh,
      text: `Spike ${index + 1}: ${point.price_eur_mwh.toFixed(1)}`,
      showarrow: true,
      arrowhead: 4,
      ax: 0,
      ay: -40 - index * 20,
      font: { color: '#0f172a', size: 11 },
      bgcolor: 'rgba(255,255,255,0.9)',
      bordercolor: 'rgba(15, 23, 42, 0.15)',
    }))

    annotationsList.push({
      x: stats.minPoint.timestamp,
      y: stats.minPoint.price_eur_mwh,
      text: `Low: ${stats.minPoint.price_eur_mwh.toFixed(1)}`,
      showarrow: true,
      arrowhead: 4,
      ax: 0,
      ay: 40,
      font: { color: '#0f172a', size: 11 },
      bgcolor: 'rgba(255,255,255,0.9)',
      bordercolor: 'rgba(15, 23, 42, 0.15)',
    })

    return annotationsList
  }, [points, stats])

  const mixByTime = useMemo(() => {
    if (!mixSeries.length) {
      return null
    }
    const map = new Map()
    mixSeries.forEach((series) => {
      series.points.forEach((point) => {
        const key = new Date(point.timestamp).toISOString()
        if (!map.has(key)) {
          map.set(key, [])
        }
        map.get(key).push({ fuel: series.fuel_type, value: point.value_mw })
      })
    })
    return map
  }, [mixSeries])

  const spikeMix = useMemo(() => {
    if (!stats || !mixByTime) {
      return null
    }
    const topAt = (timestamp) => {
      const key = new Date(timestamp).toISOString()
      const entries = mixByTime.get(key) || []
      return [...entries]
        .sort((a, b) => b.value - a.value)
        .slice(0, 3)
    }
    return {
      peak: topAt(stats.maxPoint.timestamp),
      trough: topAt(stats.minPoint.timestamp),
    }
  }, [stats, mixByTime])

  const chartLayout = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { color: '#0f172a' },
    margin: { l: 40, r: 24, t: 16, b: 40 },
    xaxis: {
      title: 'Date',
      gridcolor: 'rgba(15, 23, 42, 0.08)',
      showline: false,
    },
    yaxis: {
      title: 'EUR/MWh',
      gridcolor: 'rgba(15, 23, 42, 0.08)',
      zeroline: false,
    },
    annotations,
  }

  const mixLayout = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { color: '#0f172a' },
    margin: { l: 40, r: 24, t: 16, b: 40 },
    xaxis: {
      title: 'Date',
      gridcolor: 'rgba(15, 23, 42, 0.08)',
      showline: false,
    },
    yaxis: {
      title: 'MW',
      gridcolor: 'rgba(15, 23, 42, 0.08)',
      zeroline: false,
    },
    legend: { orientation: 'h' },
  }

  const spreadLayout = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { color: '#0f172a' },
    margin: { l: 40, r: 24, t: 16, b: 40 },
    xaxis: {
      title: 'Date',
      gridcolor: 'rgba(15, 23, 42, 0.08)',
      showline: false,
    },
    yaxis: {
      title: 'EUR/MWh spread',
      gridcolor: 'rgba(15, 23, 42, 0.08)',
      zeroline: true,
      zerolinecolor: 'rgba(15, 23, 42, 0.25)',
    },
  }

  const marketNotes = useMemo(() => {
    if (!stats) {
      return []
    }
    const notes = []
    const peakHour = new Date(stats.maxPoint.timestamp).getUTCHours()
    const troughHour = new Date(stats.minPoint.timestamp).getUTCHours()

    if (stats.min < 0) {
      notes.push('Negative prices appeared, often a signal of excess supply.')
    }
    if (stats.maxJump > 40) {
      notes.push(
        `Large hourly swing of ${stats.maxJump.toFixed(
          1,
        )} EUR/MWh suggests a sharp shift in supply or demand.`,
      )
    }
    if (peakHour >= 17 && peakHour <= 20) {
      notes.push('Evening peak aligns with typical demand ramp at dusk.')
    }
    if (troughHour >= 10 && troughHour <= 14) {
      notes.push('Midday trough could indicate stronger solar or lighter load.')
    }
    if (mixStats) {
      notes.push(
        `Top generation source: ${mixStats.topFuel} (${mixStats.topShare.toFixed(
          0,
        )}% of average output).`,
      )
      notes.push(
        `Estimated renewable share: ${mixStats.renewableShare.toFixed(0)}%.`,
      )
    }
    if (!notes.length) {
      notes.push('Prices stayed within a relatively narrow band for the window.')
    }

    return notes
  }, [stats, mixStats])

  return (
    <div className="app">
      <header className="hero">
        <div>
          <p className="eyebrow">Energy Lens</p>
          <h1>European day-ahead electricity prices</h1>
          <p className="subtitle">
            Explore hourly price swings across key markets and see how volatility
            builds across the week.
          </p>
        </div>
        <div className="hero-card">
          <div>
            <p className="metric-label">Country</p>
            <p className="metric-value">{country || '—'}</p>
          </div>
          <div>
            <p className="metric-label">Range</p>
            <p className="metric-value">{startDate} → {endDate}</p>
          </div>
        </div>
      </header>

      <main className="dashboard">
        <section className="panel price-panel">
          <div className="controls">
            <label>
              Market
              <select
                value={country}
                onChange={(event) => setCountry(event.target.value)}
              >
                {countries.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Compare to
              <select
                value={spreadCountry}
                onChange={(event) => setSpreadCountry(event.target.value)}
              >
                {countries
                  .filter((code) => code !== country)
                  .map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Start date
              <input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </label>
            <label>
              End date
              <input
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </label>
            <button className="primary" onClick={loadPrices} disabled={loading}>
              {loading ? 'Loading...' : 'Update chart'}
            </button>
          </div>

          {error ? <p className="error">{error}</p> : null}

          <div className="chart-wrap">
            <Plot
              data={chartData}
              layout={chartLayout}
              style={{ width: '100%', height: '360px' }}
              useResizeHandler
              config={{ displayModeBar: false }}
            />
          </div>

          <div className="stats">
            <div>
              <p className="metric-label">Average</p>
              <p className="metric-value">
                {stats ? formatPrice(stats.avg) : '—'}
              </p>
            </div>
            <div>
              <p className="metric-label">Peak</p>
              <p className="metric-value">
                {stats ? formatPrice(stats.max) : '—'}
              </p>
            </div>
            <div>
              <p className="metric-label">Low</p>
              <p className="metric-value">
                {stats ? formatPrice(stats.min) : '—'}
              </p>
            </div>
            <div>
              <p className="metric-label">Volatility</p>
              <p className="metric-value">
                {stats ? formatPrice(stats.volatility) : '—'}
              </p>
            </div>
            <div>
              <p className="metric-label">Max hourly jump</p>
              <p className="metric-value">
                {stats ? formatPrice(stats.maxJump) : '—'}
              </p>
            </div>
            <div>
              <p className="metric-label">Latest day avg</p>
              <p className="metric-value">
                {stats?.lastDayAvg ? formatPrice(stats.lastDayAvg) : '—'}
              </p>
            </div>
          </div>
        </section>

        <section className="panel spread-panel">
        <div className="panel-header">
          <div>
            <h2>Price spread</h2>
            <p className="subtitle">
              Difference between {country} and {spreadCountry} for the same hours.
            </p>
          </div>
          {spreadLoading ? <span className="pill">Loading spread</span> : null}
        </div>

        {spreadError ? <p className="error">{spreadError}</p> : null}

        {spreadChartData.length ? (
          <div className="chart-wrap">
            <Plot
              data={spreadChartData}
              layout={spreadLayout}
              style={{ width: '100%', height: '300px' }}
              useResizeHandler
              config={{ displayModeBar: false }}
            />
          </div>
        ) : (
          <p className="muted">
            Select a comparison market to view the spread.
          </p>
        )}
      </section>

        <section className="panel mix-panel">
          <div className="panel-header">
            <div>
              <h2>Generation mix</h2>
              <p className="subtitle">
                Stack of hourly output by fuel. Top sources are shown individually.
              </p>
            </div>
            <label className="toggle">
              <span>Show mix</span>
              <input
                type="checkbox"
                checked={showMix}
                onChange={(event) => setShowMix(event.target.checked)}
              />
              <span className="toggle-track">
                <span className="toggle-thumb"></span>
              </span>
            </label>
          </div>

          {showMix ? (
            mixError ? (
              <p className="error">{mixError}</p>
            ) : (
              <div className="chart-wrap">
                <Plot
                  data={mixChartData}
                  layout={mixLayout}
                  style={{ width: '100%', height: '320px' }}
                  useResizeHandler
                  config={{ displayModeBar: false }}
                />
                {mixLoading ? (
                  <p className="muted">Loading generation mix...</p>
                ) : null}
              </div>
            )
          ) : (
            <p className="muted">Turn on the toggle to load the mix data.</p>
          )}
        </section>

        <section className="panel insights">
        <div>
          <h2>Market insights</h2>
          <p className="subtitle">
            Quick reads based on the selected range and hourly movements.
          </p>
        </div>
        <div className="insight-grid">
          <div className="insight-card">
            <p className="metric-label">Day-over-day change</p>
            <p className="metric-value">
              {stats && stats.dayChange !== null
                ? formatPercent(stats.dayChange)
                : '—'}
            </p>
            <p className="insight-detail">
              {stats?.prevDayAvg && stats?.lastDayAvg
                ? `${formatPrice(stats.prevDayAvg)} → ${formatPrice(
                    stats.lastDayAvg,
                  )}`
                : 'Need at least two full days to compare.'}
            </p>
          </div>
          <div className="insight-card">
            <p className="metric-label">Week trend</p>
            <p className="metric-value">
              {stats && stats.weekChange !== null
                ? formatPercent(stats.weekChange)
                : '—'}
            </p>
            <p className="insight-detail">
              {stats?.firstDayAvg && stats?.lastDayAvg
                ? `${formatPrice(stats.firstDayAvg)} → ${formatPrice(
                    stats.lastDayAvg,
                  )}`
                : 'Need a wider range for week-over-week.'}
            </p>
          </div>
          <div className="insight-card">
            <p className="metric-label">Peak hour</p>
            <p className="metric-value">
              {stats
                ? new Date(stats.maxPoint.timestamp).toUTCString().slice(17, 22)
                : '—'}
            </p>
            <p className="insight-detail">
              {stats ? formatPrice(stats.maxPoint.price_eur_mwh) : '—'}
            </p>
          </div>
          <div className="insight-card">
            <p className="metric-label">Trough hour</p>
            <p className="metric-value">
              {stats
                ? new Date(stats.minPoint.timestamp).toUTCString().slice(17, 22)
                : '—'}
            </p>
            <p className="insight-detail">
              {stats ? formatPrice(stats.minPoint.price_eur_mwh) : '—'}
            </p>
          </div>
        </div>
        <div className="notes">
          <p className="metric-label">Market notes</p>
          <ul>
            {marketNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
        <div className="notes">
          <p className="metric-label">Generation at spike hours</p>
          {spikeMix ? (
            <div className="mix-overlay">
              <div>
                <p className="mix-title">Peak price mix</p>
                <ul>
                  {spikeMix.peak.map((item) => (
                    <li key={`peak-${item.fuel}`}>
                      {item.fuel}: {item.value.toFixed(0)} MW
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="mix-title">Low price mix</p>
                <ul>
                  {spikeMix.trough.map((item) => (
                    <li key={`trough-${item.fuel}`}>
                      {item.fuel}: {item.value.toFixed(0)} MW
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <p className="muted">Load generation mix to see spike overlays.</p>
          )}
        </div>
        </section>
      </main>
    </div>
  )
}

export default App
