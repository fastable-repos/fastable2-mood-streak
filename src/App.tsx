import { useState, useEffect, useRef, useCallback } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface MoodEntry {
  emoji: string
  label: string
  color: string
  timestamp: string
}

interface MoodData {
  [dateKey: string]: MoodEntry
}

interface MoodOption {
  emoji: string
  label: string
  color: string
}

interface TooltipState {
  dateKey: string
  entry: MoodEntry
  x: number
  y: number
}

interface HeatCell {
  dateKey: string
  col: number
  row: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MOODS: MoodOption[] = [
  { emoji: '😄', label: 'Joyful',  color: '#FFD700' },
  { emoji: '😊', label: 'Good',    color: '#86EFAC' },
  { emoji: '😐', label: 'Neutral', color: '#9CA3AF' },
  { emoji: '😔', label: 'Low',     color: '#93C5FD' },
  { emoji: '😢', label: 'Sad',     color: '#60A5FA' },
  { emoji: '😡', label: 'Angry',   color: '#EF4444' },
  { emoji: '😰', label: 'Anxious', color: '#FB923C' },
  { emoji: '😴', label: 'Tired',   color: '#A78BFA' },
]

const POSITIVITY: Record<string, number> = {
  Joyful: 8, Good: 7, Neutral: 5, Low: 4, Tired: 4, Anxious: 3, Sad: 2, Angry: 1,
}

const STORAGE_KEY = 'moodData'
const DAYS_IN_HEATMAP = 84
const EMPTY_CELL_COLOR = '#E5E7EB'
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// ─── Storage Helpers ──────────────────────────────────────────────────────────

function loadMoodData(): MoodData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as MoodData
  } catch (err) {
    console.error('Failed to load mood data:', err)
    return {}
  }
}

function saveMoodData(data: MoodData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch (err) {
    console.error('Failed to save mood data:', err)
  }
}

// ─── Date Helpers ─────────────────────────────────────────────────────────────

function getDateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function getTodayKey(): string {
  return getDateKey(new Date())
}

function formatDateLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
}

function formatTime(timestamp: string): string {
  try {
    return new Date(timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  } catch {
    return ''
  }
}

// ─── Computation Helpers ──────────────────────────────────────────────────────

function computeCurrentStreak(data: MoodData): number {
  const today = new Date()
  const todayKey = getDateKey(today)
  // If today has no entry, start counting from yesterday (ongoing streak)
  const startOffset = data[todayKey] ? 0 : 1
  let streak = 0
  for (let i = startOffset; i < 365; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    if (data[getDateKey(d)]) {
      streak++
    } else {
      break
    }
  }
  return streak
}

function computeBestStreak(data: MoodData): number {
  const keys = Object.keys(data).sort()
  if (keys.length === 0) return 0
  let best = 1
  let current = 1
  for (let i = 1; i < keys.length; i++) {
    const [y1, m1, d1] = keys[i - 1].split('-').map(Number)
    const [y2, m2, d2] = keys[i].split('-').map(Number)
    const prev = new Date(y1, m1 - 1, d1)
    const curr = new Date(y2, m2 - 1, d2)
    const diffDays = Math.round((curr.getTime() - prev.getTime()) / 86_400_000)
    if (diffDays === 1) {
      current++
      if (current > best) best = current
    } else {
      current = 1
    }
  }
  // Also compare with current streak (handles today-not-logged edge case)
  const cs = computeCurrentStreak(data)
  return Math.max(best, cs)
}

function getWeekEntries(data: MoodData, startDaysAgo: number): MoodEntry[] {
  const entries: MoodEntry[] = []
  const today = new Date()
  for (let i = startDaysAgo; i < startDaysAgo + 7; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    const entry = data[getDateKey(d)]
    if (entry) entries.push(entry)
  }
  return entries
}

function avgPositivity(entries: MoodEntry[]): number {
  if (entries.length === 0) return 0
  return entries.reduce((sum, e) => sum + (POSITIVITY[e.label] ?? 5), 0) / entries.length
}

function getMostFrequentLabel(entries: MoodEntry[]): string | null {
  if (entries.length === 0) return null
  const counts: Record<string, number> = {}
  for (const e of entries) {
    counts[e.label] = (counts[e.label] || 0) + 1
  }
  let best = ''
  let bestCount = 0
  for (const [label, count] of Object.entries(counts)) {
    if (count > bestCount) { best = label; bestCount = count }
  }
  return best || null
}

function getMoodByLabel(label: string): MoodOption | undefined {
  return MOODS.find(m => m.label === label)
}

function getFrequencyIn30Days(data: MoodData): { mood: MoodOption; count: number }[] {
  const today = new Date()
  const counts: Record<string, number> = {}
  for (let i = 0; i < 30; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    const entry = data[getDateKey(d)]
    if (entry) {
      counts[entry.label] = (counts[entry.label] || 0) + 1
    }
  }
  return MOODS
    .map(mood => ({ mood, count: counts[mood.label] || 0 }))
    .filter(m => m.count > 0)
    .sort((a, b) => b.count - a.count)
}

// ─── Heatmap Helpers ──────────────────────────────────────────────────────────

function buildHeatmapCells(): (HeatCell | null)[][] {
  const today = new Date()
  const todayDow = today.getDay() // 0=Sun, 6=Sat
  // grid[row=dow][col=week], col 11 = most recent week
  const grid: (HeatCell | null)[][] = Array(7).fill(null).map(() => Array(12).fill(null))
  for (let i = 0; i < DAYS_IN_HEATMAP; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    // absolute position in grid counting from top-left (row=0, col=0)
    const pos = todayDow + 77 - i
    if (pos < 0) continue
    const col = Math.floor(pos / 7)
    const row = pos % 7
    if (col >= 0 && col < 12 && row >= 0 && row < 7) {
      grid[row][col] = { dateKey: getDateKey(d), col, row }
    }
  }
  return grid
}

function getMonthLabels(): { label: string; col: number }[] {
  const today = new Date()
  const todayDow = today.getDay()
  const labels: { label: string; col: number }[] = []
  let lastMonth = -1
  for (let col = 0; col < 12; col++) {
    for (let row = 0; row < 7; row++) {
      const pos = col * 7 + row
      const daysAgo = todayDow + 77 - pos
      if (daysAgo < 0 || daysAgo >= DAYS_IN_HEATMAP) continue
      const d = new Date(today)
      d.setDate(today.getDate() - daysAgo)
      const month = d.getMonth()
      if (month !== lastMonth) {
        labels.push({ label: d.toLocaleDateString('en-US', { month: 'short' }), col })
        lastMonth = month
      }
      break
    }
  }
  return labels
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [moodData, setMoodData] = useState<MoodData>(() => loadMoodData())
  const [todayMood, setTodayMood] = useState<MoodOption | null>(() => {
    const data = loadMoodData()
    const entry = data[getTodayKey()]
    return entry ? (MOODS.find(m => m.label === entry.label) ?? null) : null
  })
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const [showReset, setShowReset] = useState(false)
  const [heatmapCells] = useState(() => buildHeatmapCells())
  const [monthLabels] = useState(() => getMonthLabels())
  const tooltipTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync todayMood whenever moodData changes
  useEffect(() => {
    const entry = moodData[getTodayKey()]
    if (entry) {
      setTodayMood(MOODS.find(m => m.label === entry.label) ?? null)
    } else {
      setTodayMood(null)
    }
  }, [moodData])

  const handleMoodSelect = useCallback((mood: MoodOption) => {
    const today = getTodayKey()
    const entry: MoodEntry = {
      emoji: mood.emoji,
      label: mood.label,
      color: mood.color,
      timestamp: new Date().toISOString(),
    }
    const newData = { ...moodData, [today]: entry }
    setMoodData(newData)
    saveMoodData(newData)
    setTodayMood(mood)
  }, [moodData])

  const handleReset = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY)
      setMoodData({})
      setTodayMood(null)
      setTooltip(null)
      setShowReset(false)
    } catch (err) {
      console.error('Failed to reset mood data:', err)
    }
  }, [])

  const handleCellMouseEnter = useCallback((dateKey: string, entry: MoodEntry, e: React.MouseEvent) => {
    if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current)
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setTooltip({ dateKey, entry, x: rect.left + rect.width / 2, y: rect.top })
  }, [])

  const handleCellMouseLeave = useCallback(() => {
    tooltipTimeoutRef.current = setTimeout(() => setTooltip(null), 80)
  }, [])

  // Computed values
  const currentStreak = computeCurrentStreak(moodData)
  const bestStreak = computeBestStreak(moodData)
  const currentWeekEntries = getWeekEntries(moodData, 0)
  const prevWeekEntries = getWeekEntries(moodData, 7)
  const currentWeekTop = getMostFrequentLabel(currentWeekEntries)
  const prevWeekTop = getMostFrequentLabel(prevWeekEntries)
  const currentAvg = avgPositivity(currentWeekEntries)
  const prevAvg = avgPositivity(prevWeekEntries)
  const frequency30 = getFrequencyIn30Days(moodData)
  const maxFreq = frequency30.reduce((max, m) => Math.max(max, m.count), 1)
  const hasAnyData = Object.keys(moodData).length > 0
  const todayKey = getTodayKey()

  // Trend determination
  let trendMessage: string
  let trendIcon: string
  if (currentWeekEntries.length === 0 && prevWeekEntries.length === 0) {
    trendMessage = 'Start logging your moods to see weekly insights!'
    trendIcon = '🌈'
  } else if (currentWeekEntries.length === 0) {
    trendMessage = "No entries yet this week — how are you feeling?"
    trendIcon = '📝'
  } else if (prevWeekEntries.length === 0) {
    trendMessage = "Keep logging to unlock week-over-week comparisons!"
    trendIcon = '✨'
  } else if (currentAvg > prevAvg + 0.5) {
    trendMessage = "You're on an upward trend! Keep shining!"
    trendIcon = '📈'
  } else if (currentAvg < prevAvg - 0.5) {
    trendMessage = "Rough patch? It's okay — better days are coming."
    trendIcon = '📉'
  } else {
    trendMessage = "Steady vibes this week. Balance is beautiful!"
    trendIcon = '➡️'
  }

  const noDataForInsights = currentWeekEntries.length === 0 && prevWeekEntries.length === 0

  return (
    <div className="min-h-screen bg-[#FAFAFA]" style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>

      {/* ── Header ── */}
      <header className="bg-[#1E1E2E] text-white px-6 py-4 flex items-center justify-between shadow-xl">
        <div className="flex items-center gap-3">
          <span className="text-3xl">🔥</span>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight leading-none">Mood Streak</h1>
            <p className="text-xs text-slate-400 mt-0.5">Your daily emotional wellness tracker</p>
          </div>
        </div>
        <button
          onClick={() => setShowReset(true)}
          data-testid="reset-btn"
          className="text-xs text-slate-400 hover:text-red-400 transition-colors px-3 py-1.5 rounded-lg hover:bg-white/10 border border-transparent hover:border-red-400/30"
        >
          Reset Data
        </button>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-8">

        {/* ── Streak Counters ── */}
        <section className="grid grid-cols-2 gap-4" aria-label="Streak counters">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 text-center">
            <div
              className="text-5xl font-black text-gray-800 tabular-nums"
              data-testid="current-streak"
            >
              🔥 {currentStreak}
            </div>
            <div className="text-xs font-semibold text-gray-400 mt-2 uppercase tracking-wide">Current Streak</div>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 text-center">
            <div
              className="text-5xl font-black text-gray-800 tabular-nums"
              data-testid="best-streak"
            >
              ⭐ {bestStreak}
            </div>
            <div className="text-xs font-semibold text-gray-400 mt-2 uppercase tracking-wide">Best Streak</div>
          </div>
        </section>

        {/* ── Daily Check-In ── */}
        <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6" aria-label="Daily check-in">
          <h2 className="text-lg font-bold text-gray-800">
            {!hasAnyData ? '✨ How are you feeling today?' : todayMood ? "Update today's mood" : 'How are you feeling today?'}
          </h2>
          <p className="text-sm text-gray-400 mt-1 mb-5" data-testid="checkin-subtitle">
            {!hasAnyData
              ? 'Log your first mood!'
              : todayMood
                ? `Today: ${todayMood.emoji} ${todayMood.label}`
                : "You haven't logged today yet"}
          </p>
          <div className="grid grid-cols-4 gap-3" data-testid="mood-grid">
            {MOODS.map((mood) => {
              const isSelected = todayMood?.label === mood.label
              return (
                <button
                  key={mood.label}
                  onClick={() => handleMoodSelect(mood)}
                  data-testid={`mood-btn-${mood.label.toLowerCase()}`}
                  aria-label={`Log mood: ${mood.label}`}
                  aria-pressed={isSelected}
                  className={`
                    flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all duration-200
                    hover:scale-105 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2
                  `}
                  style={isSelected ? {
                    backgroundColor: mood.color + '25',
                    borderColor: mood.color,
                    boxShadow: `0 4px 16px ${mood.color}55`,
                  } : {
                    backgroundColor: '#F9FAFB',
                    borderColor: '#E5E7EB',
                  }}
                >
                  <span className="text-3xl leading-none">{mood.emoji}</span>
                  <span className="text-xs font-semibold text-gray-600 leading-none">{mood.label}</span>
                </button>
              )
            })}
          </div>
        </section>

        {/* ── 12-Week Heatmap ── */}
        <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6" aria-label="Mood heatmap">
          <h2 className="text-lg font-bold text-gray-800 mb-4">12-Week Mood History</h2>
          <div className="overflow-x-auto">
            <div className="inline-block">
              {/* Month labels row */}
              <div className="flex mb-2 ml-9">
                {Array(12).fill(null).map((_, col) => {
                  const found = monthLabels.find(l => l.col === col)
                  return (
                    <div key={col} className="w-8 shrink-0 text-xs text-gray-400 font-medium">
                      {found?.label ?? ''}
                    </div>
                  )
                })}
              </div>

              {/* Day rows */}
              {heatmapCells.map((row, rowIdx) => (
                <div key={rowIdx} className="flex items-center mb-1">
                  {/* Day-of-week label */}
                  <div className="w-9 pr-1 text-right text-xs text-gray-400 font-medium shrink-0">
                    {rowIdx % 2 === 1 ? DAY_LABELS[rowIdx] : ''}
                  </div>
                  {/* Cells */}
                  {row.map((cell, colIdx) => {
                    if (!cell) {
                      return <div key={colIdx} className="w-7 h-7 mx-0.5 rounded-md opacity-0 pointer-events-none" />
                    }
                    const entry = moodData[cell.dateKey]
                    const bgColor = entry ? entry.color : EMPTY_CELL_COLOR
                    const isToday = cell.dateKey === todayKey
                    return (
                      <div
                        key={colIdx}
                        data-testid={`heatmap-cell-${cell.dateKey}`}
                        data-date={cell.dateKey}
                        className={`
                          w-7 h-7 mx-0.5 rounded-md transition-all duration-150 relative
                          ${entry ? 'cursor-pointer hover:scale-125 hover:z-10' : 'cursor-default'}
                          ${isToday ? 'ring-2 ring-offset-1 ring-gray-500' : ''}
                        `}
                        style={{ backgroundColor: bgColor }}
                        onMouseEnter={entry ? (e) => handleCellMouseEnter(cell.dateKey, entry, e) : undefined}
                        onMouseLeave={entry ? handleCellMouseLeave : undefined}
                        onClick={entry ? (e) => handleCellMouseEnter(cell.dateKey, entry, e) : undefined}
                        title={entry ? `${entry.emoji} ${entry.label} — ${formatDateLabel(cell.dateKey)}` : formatDateLabel(cell.dateKey)}
                      />
                    )
                  })}
                </div>
              ))}
            </div>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-x-4 gap-y-2 mt-5 pt-4 border-t border-gray-100">
            <div className="flex items-center gap-1.5">
              <div className="w-4 h-4 rounded-sm" style={{ backgroundColor: EMPTY_CELL_COLOR }} />
              <span className="text-xs text-gray-400">No entry</span>
            </div>
            {MOODS.map(m => (
              <div key={m.label} className="flex items-center gap-1.5">
                <div className="w-4 h-4 rounded-sm" style={{ backgroundColor: m.color }} />
                <span className="text-xs text-gray-500">{m.emoji} {m.label}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ── Weekly Insights ── */}
        <section
          className="rounded-2xl p-6 shadow-sm"
          style={{ background: 'linear-gradient(135deg, #EDE9FE 0%, #D1FAE5 100%)' }}
          data-testid="insights-panel"
          aria-label="Weekly insights"
        >
          <h2 className="text-lg font-bold text-gray-800 mb-4">📊 Weekly Insights</h2>

          {noDataForInsights ? (
            <p className="text-sm text-gray-600 font-medium" data-testid="insights-no-data">
              {trendMessage}
            </p>
          ) : (
            <div className="space-y-3">
              {/* This week vs last week cards */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white/70 backdrop-blur-sm rounded-xl p-3">
                  <div className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1.5">This Week</div>
                  {currentWeekTop ? (
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">{getMoodByLabel(currentWeekTop)?.emoji}</span>
                      <div>
                        <div className="text-sm font-bold text-gray-800" data-testid="current-week-top">
                          {currentWeekTop}
                        </div>
                        <div className="text-xs text-gray-400">{currentWeekEntries.length} logged</div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-gray-400">No entries yet</div>
                  )}
                </div>
                <div className="bg-white/70 backdrop-blur-sm rounded-xl p-3">
                  <div className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1.5">Last Week</div>
                  {prevWeekTop ? (
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">{getMoodByLabel(prevWeekTop)?.emoji}</span>
                      <div>
                        <div className="text-sm font-bold text-gray-800">{prevWeekTop}</div>
                        <div className="text-xs text-gray-400">{prevWeekEntries.length} logged</div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-gray-400">No entries</div>
                  )}
                </div>
              </div>

              {/* Trend message */}
              <div className="bg-white/70 backdrop-blur-sm rounded-xl p-3 flex items-start gap-2">
                <span className="text-lg shrink-0" data-testid="trend-icon">{trendIcon}</span>
                <p className="text-sm font-medium text-gray-700">{trendMessage}</p>
              </div>
            </div>
          )}
        </section>

        {/* ── 30-Day Frequency Chart ── */}
        <section
          className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6"
          data-testid="frequency-chart"
          aria-label="Mood frequency chart"
        >
          <h2 className="text-lg font-bold text-gray-800 mb-4">30-Day Mood Frequency</h2>
          {frequency30.length === 0 ? (
            <p className="text-sm text-gray-400">No data yet — start logging your moods!</p>
          ) : (
            <div className="space-y-3">
              {frequency30.map(({ mood, count }) => (
                <div
                  key={mood.label}
                  className="flex items-center gap-3"
                  data-testid={`freq-bar-${mood.label.toLowerCase()}`}
                >
                  <div className="w-24 text-sm text-right text-gray-600 shrink-0 font-medium">
                    {mood.emoji} {mood.label}
                  </div>
                  <div className="flex-1 bg-gray-100 rounded-full h-7 overflow-hidden">
                    <div
                      className="h-full rounded-full flex items-center justify-end px-3 transition-all duration-700"
                      style={{
                        width: `${Math.max((count / maxFreq) * 100, 10)}%`,
                        backgroundColor: mood.color,
                      }}
                    >
                      <span className="text-xs font-bold text-white drop-shadow-sm">{count}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

      </main>

      {/* ── Footer ── */}
      <footer className="text-center py-8 text-xs text-gray-400">
        Mood Streak — Your emotional wellness companion 💜
      </footer>

      {/* ── Tooltip ── */}
      {tooltip && (
        <div
          data-testid="heatmap-tooltip"
          className="fixed z-50 pointer-events-none"
          style={{
            left: tooltip.x,
            top: tooltip.y - 10,
            transform: 'translate(-50%, -100%)',
          }}
        >
          <div className="bg-gray-900 text-white rounded-xl px-4 py-3 shadow-2xl min-w-max">
            <div className="text-xs font-semibold text-gray-400 mb-1">
              {formatDateLabel(tooltip.dateKey)}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-2xl">{tooltip.entry.emoji}</span>
              <span className="font-bold text-sm">{tooltip.entry.label}</span>
            </div>
            <div className="text-xs text-gray-400 mt-1">
              {formatTime(tooltip.entry.timestamp)}
            </div>
          </div>
          {/* Arrow */}
          <div className="absolute left-1/2 -translate-x-1/2 bottom-0 translate-y-full">
            <div className="w-0 h-0 border-l-[8px] border-r-[8px] border-t-[8px] border-l-transparent border-r-transparent border-t-gray-900" />
          </div>
        </div>
      )}

      {/* ── Reset Confirmation Dialog ── */}
      {showReset && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          data-testid="reset-dialog"
          onClick={(e) => { if (e.target === e.currentTarget) setShowReset(false) }}
        >
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full">
            <div className="text-3xl mb-3 text-center">⚠️</div>
            <h3 className="text-lg font-bold text-gray-800 mb-2 text-center">Reset All Data?</h3>
            <p className="text-sm text-gray-500 mb-6 text-center">
              This will permanently delete all your mood history. This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowReset(false)}
                data-testid="reset-cancel"
                className="flex-1 py-2.5 rounded-xl border-2 border-gray-200 text-gray-600 font-semibold hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleReset}
                data-testid="reset-confirm"
                className="flex-1 py-2.5 rounded-xl bg-red-500 text-white font-semibold hover:bg-red-600 transition-colors"
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
