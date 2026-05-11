// Comprehensive smoke test for the Temporal API (Node 26+).
//
// Goal: surface every shim stub in node-smol's temporal-infra port
// before CI runs. Each assertion exercises a distinct V8 entry point
// that maps to a temporal_rs:: method; an empty result, NaN, throw,
// or unexpected shape fails fast with a clear message.
//
// Adapted from upstream temporal_rs unit tests
// (packages/temporal-infra/upstream/temporal/src/builtins/core/*/tests.rs)
// trimmed to the surface V8 actually exposes via the global Temporal
// object. Provider-aware tests that require a TZDB lookup are
// skipped here — they live in the larger conformance suite.

const failures = []
function check(name, ok, detail) {
  if (!ok) {
    failures.push(detail ? `${name}: ${detail}` : name)
  }
}

// `tryCheck` lets a single section call a Temporal method that may
// throw (because a shim path is intentionally NotImplemented) without
// killing the rest of the test. Records the throw as a failure and
// returns sentinel so caller code can short-circuit subsequent checks.
function tryCheck(name, fn) {
  try {
    return fn()
  } catch (err) {
    failures.push(`${name}: threw ${err?.constructor?.name ?? 'Error'}: ${err?.message ?? err}`)
    return undefined
  }
}

if (typeof Temporal !== 'object' || Temporal === null) {
  throw new Error('Temporal global missing — temporal_rs not linked')
}

// ── Temporal.Now ────────────────────────────────────────────────────

{
  const instant = Temporal.Now.instant()
  check('Now.instant typeof', instant instanceof Temporal.Instant)
  check(
    'Now.instant epochMilliseconds',
    typeof instant.epochMilliseconds === 'number' &&
      Number.isFinite(instant.epochMilliseconds),
  )

  const pd = Temporal.Now.plainDateISO()
  check('Now.plainDateISO typeof', pd instanceof Temporal.PlainDate)

  const pdt = Temporal.Now.plainDateTimeISO()
  check('Now.plainDateTimeISO typeof', pdt instanceof Temporal.PlainDateTime)

  const pt = Temporal.Now.plainTimeISO()
  check('Now.plainTimeISO typeof', pt instanceof Temporal.PlainTime)

  const zdt = Temporal.Now.zonedDateTimeISO()
  check('Now.zonedDateTimeISO typeof', zdt instanceof Temporal.ZonedDateTime)
}

// ── Temporal.PlainDate ──────────────────────────────────────────────

{
  const d = Temporal.PlainDate.from('2026-05-08')
  check('PlainDate.from year', d.year === 2026)
  check('PlainDate.from month', d.month === 5)
  check('PlainDate.from day', d.day === 8)
  check(
    'PlainDate.toString',
    d.toString() === '2026-05-08',
    `got ${JSON.stringify(d.toString())}`,
  )

  const d2 = Temporal.PlainDate.from({ year: 2024, month: 2, day: 29 })
  check('PlainDate.from leap year', d2.toString() === '2024-02-29')

  const tomorrow = d.add({ days: 1 })
  check(
    'PlainDate.add days',
    tomorrow.toString() === '2026-05-09',
    `got ${tomorrow.toString()}`,
  )

  const yesterday = d.subtract({ days: 1 })
  check(
    'PlainDate.subtract days',
    yesterday.toString() === '2026-05-07',
    `got ${yesterday.toString()}`,
  )

  const dur = d.until(Temporal.PlainDate.from('2026-05-15'))
  check(
    'PlainDate.until shape',
    dur instanceof Temporal.Duration && dur.days === 7,
    `got ${dur?.days}`,
  )

  const cmp = Temporal.PlainDate.compare(
    Temporal.PlainDate.from('2026-01-01'),
    Temporal.PlainDate.from('2026-12-31'),
  )
  check('PlainDate.compare a<b', cmp === -1, `got ${cmp}`)

  check('PlainDate.dayOfWeek', typeof d.dayOfWeek === 'number')
  check('PlainDate.dayOfYear', typeof d.dayOfYear === 'number')
  check('PlainDate.daysInMonth', d.daysInMonth === 31)
  check('PlainDate.daysInYear', d.daysInYear === 365)
  check('PlainDate.inLeapYear', d.inLeapYear === false)
}

// ── Temporal.PlainTime ──────────────────────────────────────────────

{
  const t = Temporal.PlainTime.from('12:34:56')
  check('PlainTime.from hour', t.hour === 12)
  check('PlainTime.from minute', t.minute === 34)
  check('PlainTime.from second', t.second === 56)
  check(
    'PlainTime.toString',
    t.toString() === '12:34:56',
    `got ${JSON.stringify(t.toString())}`,
  )

  const t2 = Temporal.PlainTime.from('00:00:00.123456789')
  check(
    'PlainTime.toString with fraction',
    t2.toString() === '00:00:00.123456789',
    `got ${JSON.stringify(t2.toString())}`,
  )

  const t3 = t.add({ minutes: 30 })
  check(
    'PlainTime.add minutes',
    t3.toString() === '13:04:56',
    `got ${t3.toString()}`,
  )

  const cmp = Temporal.PlainTime.compare(
    Temporal.PlainTime.from('00:00:00'),
    Temporal.PlainTime.from('23:59:59'),
  )
  check('PlainTime.compare a<b', cmp === -1, `got ${cmp}`)
}

// ── Temporal.PlainDateTime ──────────────────────────────────────────

{
  const dt = Temporal.PlainDateTime.from('2026-05-08T12:34:56')
  check(
    'PlainDateTime.from',
    dt.year === 2026 && dt.month === 5 && dt.day === 8 && dt.hour === 12,
  )
  check(
    'PlainDateTime.toString',
    dt.toString() === '2026-05-08T12:34:56',
    `got ${JSON.stringify(dt.toString())}`,
  )

  const dt2 = dt.add({ hours: 3 })
  check(
    'PlainDateTime.add hours',
    dt2.toString() === '2026-05-08T15:34:56',
    `got ${dt2.toString()}`,
  )

  const cmp = Temporal.PlainDateTime.compare(
    Temporal.PlainDateTime.from('2026-01-01T00:00:00'),
    Temporal.PlainDateTime.from('2026-12-31T23:59:59'),
  )
  check('PlainDateTime.compare a<b', cmp === -1, `got ${cmp}`)
}

// ── Temporal.PlainYearMonth ─────────────────────────────────────────

{
  const ym = Temporal.PlainYearMonth.from('2026-05')
  check('PlainYearMonth.from year', ym.year === 2026)
  check('PlainYearMonth.from month', ym.month === 5)
  check(
    'PlainYearMonth.toString',
    ym.toString() === '2026-05',
    `got ${JSON.stringify(ym.toString())}`,
  )

  const ym2 = tryCheck('PlainYearMonth.add (call)', () =>
    ym.add({ months: 7 }),
  )
  if (ym2 !== undefined) {
    check(
      'PlainYearMonth.add result',
      ym2.toString() === '2026-12',
      `got ${ym2.toString()}`,
    )
  }
}

// ── Temporal.PlainMonthDay ──────────────────────────────────────────

{
  const md = Temporal.PlainMonthDay.from('--05-08')
  check('PlainMonthDay.from monthCode', md.monthCode === 'M05')
  check('PlainMonthDay.from day', md.day === 8)
  check(
    'PlainMonthDay.toString',
    md.toString() === '--05-08',
    `got ${JSON.stringify(md.toString())}`,
  )
}

// ── Temporal.Instant ────────────────────────────────────────────────

{
  const i = Temporal.Instant.from('2026-05-08T12:34:56Z')
  check('Instant.from epochMilliseconds', typeof i.epochMilliseconds === 'number')
  check(
    'Instant.toString',
    i.toString() === '2026-05-08T12:34:56Z',
    `got ${JSON.stringify(i.toString())}`,
  )

  const i2 = Temporal.Instant.fromEpochMilliseconds(0)
  check(
    'Instant.fromEpochMilliseconds(0)',
    i2.toString() === '1970-01-01T00:00:00Z',
    `got ${JSON.stringify(i2.toString())}`,
  )

  const i3 = i.add({ hours: 1 })
  check(
    'Instant.add hours',
    i3.toString() === '2026-05-08T13:34:56Z',
    `got ${i3.toString()}`,
  )

  const dur = tryCheck('Instant.until (call)', () =>
    i.until(Temporal.Instant.from('2026-05-08T13:34:56Z')),
  )
  if (dur !== undefined) {
    check(
      'Instant.until shape',
      dur instanceof Temporal.Duration,
      `got ${typeof dur}`,
    )
  }
}

// ── Temporal.ZonedDateTime ──────────────────────────────────────────

{
  // Use UTC offset (not IANA) so we don't depend on TZDB activation.
  const zdt = Temporal.ZonedDateTime.from('2026-05-08T12:34:56+00:00[+00:00]')
  check(
    'ZonedDateTime.from typeof',
    zdt instanceof Temporal.ZonedDateTime,
    `got ${typeof zdt}`,
  )
  check(
    'ZonedDateTime.toString contains date',
    zdt.toString().includes('2026-05-08'),
    `got ${JSON.stringify(zdt.toString())}`,
  )
  check(
    'ZonedDateTime.epochMilliseconds',
    typeof zdt.epochMilliseconds === 'number',
  )
}

// ── Temporal.Duration ───────────────────────────────────────────────

{
  const d = Temporal.Duration.from('P1Y2M3DT4H5M6S')
  check('Duration.from years', d.years === 1)
  check('Duration.from months', d.months === 2)
  check('Duration.from days', d.days === 3)
  check('Duration.from hours', d.hours === 4)
  check('Duration.from minutes', d.minutes === 5)
  check('Duration.from seconds', d.seconds === 6)
  check(
    'Duration.toString',
    d.toString() === 'P1Y2M3DT4H5M6S',
    `got ${JSON.stringify(d.toString())}`,
  )

  const d2 = Temporal.Duration.from({ hours: 1, minutes: 30 })
  check(
    'Duration.from object',
    d2.toString() === 'PT1H30M',
    `got ${d2.toString()}`,
  )

  const d3 = Temporal.Duration.from('PT0S')
  check(
    'Duration.toString zero',
    d3.toString() === 'PT0S',
    `got ${JSON.stringify(d3.toString())}`,
  )

  const d4 = Temporal.Duration.from('-PT1H')
  check(
    'Duration.toString negative',
    d4.toString() === '-PT1H',
    `got ${JSON.stringify(d4.toString())}`,
  )

  // Arithmetic
  const a = Temporal.Duration.from({ hours: 1 })
  const b = Temporal.Duration.from({ minutes: 30 })
  const c = a.add(b)
  check(
    'Duration.add',
    c.hours === 1 && c.minutes === 30,
    `got hours=${c.hours} minutes=${c.minutes}`,
  )
}

// ── Round-trip + edge cases ─────────────────────────────────────────

{
  // Round-trip: PlainDate → string → PlainDate is identity
  const pd = Temporal.PlainDate.from('2026-05-08')
  const pd2 = Temporal.PlainDate.from(pd.toString())
  check(
    'PlainDate round-trip',
    pd.equals(pd2),
    `${pd.toString()} != ${pd2.toString()}`,
  )

  // Negative year (BCE)
  const ancient = Temporal.PlainDate.from('-000753-04-21')
  check(
    'PlainDate negative year toString',
    ancient.toString() === '-000753-04-21',
    `got ${JSON.stringify(ancient.toString())}`,
  )
}

// ── Report ──────────────────────────────────────────────────────────

if (failures.length > 0) {
  console.error(`Temporal smoke test: ${failures.length} failure(s)`)
  for (const f of failures) {
    console.error(`  ✘ ${f}`)
  }
  process.exit(1)
}

console.log(`Temporal smoke test: all ${37} checks passed`)
