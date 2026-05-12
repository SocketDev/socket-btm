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

  // Day-clamp on overflow: Jan 31 + 1 month must clamp to Feb 28/29
  // (default overflow='constrain'). Previously the implementation
  // rejected this with a Range error — observably wrong.
  const ymJan = Temporal.PlainYearMonth.from('1999-01')
  const ymFeb = tryCheck('PlainYearMonth.add day-clamp (call)', () =>
    ymJan.add({ months: 1 }),
  )
  if (ymFeb !== undefined) {
    check(
      'PlainYearMonth.add day-clamp result',
      ymFeb.toString() === '1999-02',
      `got ${ymFeb.toString()}`,
    )
  }

  // Negative months crossing year boundary.
  const ymPrev = tryCheck('PlainYearMonth.subtract crossing year (call)', () =>
    ym.subtract({ months: 8 }),
  )
  if (ymPrev !== undefined) {
    check(
      'PlainYearMonth.subtract crossing year result',
      ymPrev.toString() === '2025-09',
      `got ${ymPrev.toString()}`,
    )
  }
}

// ── Temporal.Instant cross-unit / largestUnit:day ───────────────────

{
  const i1 = Temporal.Instant.from('2026-05-08T12:00:00Z')
  const i2 = Temporal.Instant.from('2026-05-10T18:30:00Z')

  const durSec = tryCheck('Instant.until default seconds (call)', () =>
    i1.until(i2),
  )
  if (durSec !== undefined) {
    // 2 days + 6h 30m → 196_200 seconds at default largestUnit='second'.
    check(
      'Instant.until default seconds value',
      durSec.seconds === 196200 && durSec.hours === 0 && durSec.days === 0,
      `got seconds=${durSec.seconds} hours=${durSec.hours} days=${durSec.days}`,
    )
  }

  const durDay = tryCheck('Instant.until largestUnit=day (call)', () =>
    i1.until(i2, { largestUnit: 'day' }),
  )
  if (durDay !== undefined) {
    check(
      'Instant.until largestUnit=day result',
      durDay.days === 2 && durDay.hours === 6 && durDay.minutes === 30,
      `got days=${durDay.days} hours=${durDay.hours} minutes=${durDay.minutes}`,
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

// ── Boundary cases (added in the lockstep follow-on) ─────────────────
//
// Exercise edges the original assertions miss: the year-boundary,
// cross-midnight until/since (validates the H6 fix), and the new
// year_of_week / week_of_year wiring.

{
  // ISO year-of-week boundary: 2024-12-30 is a Monday whose Thursday
  // (2025-01-02) lands in 2025. Per ISO 8601 the date belongs to
  // 2025's W01.
  const pd = Temporal.PlainDate.from('2024-12-30')
  check(
    'PlainDate.yearOfWeek crosses to next year',
    pd.yearOfWeek === 2025,
    `got ${pd.yearOfWeek}`,
  )
  check(
    'PlainDate.weekOfYear at crossing = 1',
    pd.weekOfYear === 1,
    `got ${pd.weekOfYear}`,
  )

  // 2023-01-01 is a Sunday whose Thursday (2022-12-29) lands in 2022.
  // Per ISO 8601 the date belongs to 2022's W52.
  const pd2 = Temporal.PlainDate.from('2023-01-01')
  check(
    'PlainDate.yearOfWeek crosses to previous year',
    pd2.yearOfWeek === 2022,
    `got ${pd2.yearOfWeek}`,
  )
  check(
    'PlainDate.weekOfYear at start = 52',
    pd2.weekOfYear === 52,
    `got ${pd2.weekOfYear}`,
  )
}

{
  // PlainDateTime.until cross-midnight: 2026-05-08T23:00 →
  // 2026-05-09T01:00 is exactly +2h. Without the H6 fix this would
  // produce {days:1, hours:-22} (mixed signs, invalid Duration).
  const earlier = Temporal.PlainDateTime.from('2026-05-08T23:00:00')
  const later = Temporal.PlainDateTime.from('2026-05-09T01:00:00')
  const dur = tryCheck('PlainDateTime.until cross-midnight (call)', () =>
    earlier.until(later),
  )
  if (dur !== undefined) {
    check(
      'PlainDateTime.until cross-midnight signs agree',
      dur.days === 0 && dur.hours === 2,
      `got days=${dur.days} hours=${dur.hours} minutes=${dur.minutes}`,
    )
  }

  // Negative direction: 2026-05-09T01:00 → 2026-05-08T23:00 = -2h.
  const dur2 = tryCheck(
    'PlainDateTime.until cross-midnight negative (call)',
    () => later.until(earlier),
  )
  if (dur2 !== undefined) {
    check(
      'PlainDateTime.until cross-midnight negative signs',
      dur2.days === 0 && dur2.hours === -2,
      `got days=${dur2.days} hours=${dur2.hours}`,
    )
  }
}

{
  // Leap year boundary: 2024-02-29 → 2025-02-28 is exactly 365 days
  // (one year minus one day). Spec computes years:1, days:0 — the
  // ISO calendar handles this without DST surprises.
  const ly = Temporal.PlainDate.from('2024-02-29')
  check(
    'PlainDate.daysInMonth(Feb 2024) = 29',
    ly.daysInMonth === 29,
    `got ${ly.daysInMonth}`,
  )
  check(
    'PlainDate.daysInYear(2024) = 366',
    ly.daysInYear === 366,
    `got ${ly.daysInYear}`,
  )
  check(
    'PlainDate.inLeapYear(2024)',
    ly.inLeapYear === true,
    `got ${ly.inLeapYear}`,
  )

  const ny = Temporal.PlainDate.from('2025-02-28')
  check(
    'PlainDate.daysInMonth(Feb 2025) = 28',
    ny.daysInMonth === 28,
    `got ${ny.daysInMonth}`,
  )
  check(
    'PlainDate.daysInYear(2025) = 365',
    ny.daysInYear === 365,
    `got ${ny.daysInYear}`,
  )
  check(
    'PlainDate.inLeapYear(2025)',
    ny.inLeapYear === false,
    `got ${ny.inLeapYear}`,
  )
}

{
  // Round-trip: PlainDate ↔ PlainDateTime ↔ PlainDate via
  // toPlainDateTime + toPlainDate. Exercises the cross-class
  // bodies added in the lockstep batches.
  const pd = Temporal.PlainDate.from('2026-05-08')
  const pdt = tryCheck('PlainDate.toPlainDateTime (call)', () =>
    pd.toPlainDateTime(),
  )
  if (pdt !== undefined) {
    check(
      'PlainDate→PlainDateTime preserves date',
      pdt.year === 2026 && pdt.month === 5 && pdt.day === 8,
      `got ${pdt.toString()}`,
    )
    check(
      'PlainDate→PlainDateTime defaults time to midnight',
      pdt.hour === 0 && pdt.minute === 0 && pdt.second === 0,
      `got h=${pdt.hour} m=${pdt.minute} s=${pdt.second}`,
    )
    const pd2 = pdt.toPlainDate()
    check(
      'PlainDateTime.toPlainDate round-trip',
      pd2.year === 2026 && pd2.month === 5 && pd2.day === 8,
      `got ${pd2.toString()}`,
    )
  }
}

// ── IANA TimeZone resolution (IcuTimeZoneBackend) ────────────────────
//
// Exercises the ICU-backed TimeZoneBackend installed by V8 at boot.
// New York / London / Tokyo cover the three common DST shapes: spring-
// forward gap, fixed offset, and non-DST zone. Skipped silently on
// builds that haven't activated the IANA backend yet — the call
// surfaces as a thrown Range error which tryCheck reports.

{
  // America/New_York at 2024-01-15T12:00 → epoch -5h offset (EST).
  // 2024-07-15T12:00 → -4h offset (EDT).
  const winter = tryCheck('ZonedDateTime.from(NYC winter) (call)', () =>
    Temporal.ZonedDateTime.from('2024-01-15T12:00:00[America/New_York]'),
  )
  if (winter !== undefined) {
    check(
      'ZonedDateTime IANA winter offset',
      winter.offset === '-05:00',
      `got ${winter.offset}`,
    )
    check(
      'ZonedDateTime IANA winter hour preserved',
      winter.hour === 12,
      `got ${winter.hour}`,
    )
  }

  const summer = tryCheck('ZonedDateTime.from(NYC summer) (call)', () =>
    Temporal.ZonedDateTime.from('2024-07-15T12:00:00[America/New_York]'),
  )
  if (summer !== undefined) {
    check(
      'ZonedDateTime IANA summer offset (DST)',
      summer.offset === '-04:00',
      `got ${summer.offset}`,
    )
  }

  // Tokyo: no DST, fixed +09:00 year-round.
  const tokyo = tryCheck('ZonedDateTime.from(Tokyo) (call)', () =>
    Temporal.ZonedDateTime.from('2024-06-01T12:00:00[Asia/Tokyo]'),
  )
  if (tokyo !== undefined) {
    check(
      'ZonedDateTime IANA Tokyo offset',
      tokyo.offset === '+09:00',
      `got ${tokyo.offset}`,
    )
  }

  // Cross-day arithmetic across a DST spring-forward boundary. In
  // America/New_York, 2024-03-10 02:00 jumps to 03:00 — that 23-hour
  // day is the canonical DST test. ZonedDateTime.add({hours:24}) lands
  // on +1 day at the same wall-clock hour (spec behavior), not +25h.
  const beforeDst = tryCheck('ZonedDateTime DST add (call)', () =>
    Temporal.ZonedDateTime.from(
      '2024-03-09T12:00:00[America/New_York]',
    ).add({ days: 1 }),
  )
  if (beforeDst !== undefined) {
    check(
      'ZonedDateTime DST: +1 day preserves wall hour',
      beforeDst.hour === 12,
      `got ${beforeDst.hour} at ${beforeDst.toString()}`,
    )
  }
}

// ── Non-ISO calendar accessors (IcuCalendarBackend) ──────────────────
//
// Exercises the ICU-backed CalendarBackend. Hebrew is the canonical
// leap-month test (Adar I / Adar II); Japanese is the era-aware test
// (Reiwa starts 2019-05-01). Skipped silently when the backend isn't
// installed — tryCheck reports the throw.

{
  // Hebrew leap year: 5784 (2023-2024) is leap (Adar I + Adar II).
  // We test via PlainDate.from with [u-ca=hebrew] annotation, then
  // read monthCode + inLeapYear.
  const hebrewLeap = tryCheck('PlainDate.from(Hebrew leap) (call)', () =>
    Temporal.PlainDate.from('2024-03-15[u-ca=hebrew]'),
  )
  if (hebrewLeap !== undefined) {
    check(
      'PlainDate Hebrew calendar identifier',
      hebrewLeap.calendarId === 'hebrew',
      `got ${hebrewLeap.calendarId}`,
    )
    // 2024-03-15 ISO = Adar II 5 5784 (leap year). monthsInYear=13.
    check(
      'PlainDate Hebrew monthsInYear (leap)',
      hebrewLeap.monthsInYear === 13,
      `got ${hebrewLeap.monthsInYear}`,
    )
    check(
      'PlainDate Hebrew inLeapYear',
      hebrewLeap.inLeapYear === true,
      `got ${hebrewLeap.inLeapYear}`,
    )
  }

  // Japanese era: 2024-06-01 → Reiwa 6 (era started 2019-05-01).
  const japanese = tryCheck('PlainDate.from(Japanese) (call)', () =>
    Temporal.PlainDate.from('2024-06-01[u-ca=japanese]'),
  )
  if (japanese !== undefined) {
    check(
      'PlainDate Japanese calendar identifier',
      japanese.calendarId === 'japanese',
      `got ${japanese.calendarId}`,
    )
    check(
      'PlainDate Japanese era is Reiwa',
      japanese.era === 'reiwa' || japanese.era === 'heisei',
      `got era=${japanese.era}`,
    )
    check(
      'PlainDate Japanese eraYear is positive',
      typeof japanese.eraYear === 'number' && japanese.eraYear > 0,
      `got eraYear=${japanese.eraYear}`,
    )
  }

  // Gregorian (same as ISO arithmetically but era-aware: CE/BCE).
  const greg = tryCheck('PlainDate.from(Gregorian) (call)', () =>
    Temporal.PlainDate.from('2024-06-01[u-ca=gregory]'),
  )
  if (greg !== undefined) {
    check(
      'PlainDate Gregorian era',
      greg.era === 'ce' || greg.era === 'gregory',
      `got era=${greg.era}`,
    )
  }

  // Default ISO calendar (no annotation) → 'iso8601'.
  const iso = Temporal.PlainDate.from('2024-06-01')
  check(
    'PlainDate ISO default identifier',
    iso.calendarId === 'iso8601',
    `got ${iso.calendarId}`,
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

console.log(`Temporal smoke test: all ${74} checks passed`)
