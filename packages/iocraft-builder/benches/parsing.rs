//! Benchmarks for parsing functions.
//!
//! These benchmarks measure the performance of hot-path parsing functions
//! that are called on every render.

use criterion::{black_box, criterion_group, criterion_main, Criterion};
use iocraft_node::*;

fn bench_hex_color_parsing(c: &mut Criterion) {
    let mut group = c.benchmark_group("hex_color_parsing");

    // Benchmark with hash prefix
    group.bench_function("with_hash", |b| {
        b.iter(|| {
            // Use black_box to prevent compiler from optimizing away the call
            black_box(parse_hex_color(black_box("#FF0000")))
        });
    });

    // Benchmark without hash prefix
    group.bench_function("without_hash", |b| {
        b.iter(|| {
            black_box(parse_hex_color(black_box("00FF00")))
        });
    });

    // Benchmark lowercase
    group.bench_function("lowercase", |b| {
        b.iter(|| {
            black_box(parse_hex_color(black_box("#abcdef")))
        });
    });

    // Benchmark uppercase
    group.bench_function("uppercase", |b| {
        b.iter(|| {
            black_box(parse_hex_color(black_box("#ABCDEF")))
        });
    });

    // Benchmark invalid (fast failure path)
    group.bench_function("invalid_length", |b| {
        b.iter(|| {
            black_box(parse_hex_color(black_box("#FF")))
        });
    });

    group.bench_function("invalid_chars", |b| {
        b.iter(|| {
            black_box(parse_hex_color(black_box("#GGGGGG")))
        });
    });

    group.finish();
}

fn bench_named_color_parsing(c: &mut Criterion) {
    let mut group = c.benchmark_group("named_color_parsing");

    // Fast path: exact lowercase match
    group.bench_function("lowercase_exact", |b| {
        b.iter(|| {
            black_box(parse_named_color(black_box("red")))
        });
    });

    // Slow path: case conversion needed
    group.bench_function("uppercase_fallback", |b| {
        b.iter(|| {
            black_box(parse_named_color(black_box("RED")))
        });
    });

    // Mixed case (slow path)
    group.bench_function("mixed_case_fallback", |b| {
        b.iter(|| {
            black_box(parse_named_color(black_box("Red")))
        });
    });

    // Hex color fallback
    group.bench_function("hex_fallback", |b| {
        b.iter(|| {
            black_box(parse_named_color(black_box("#FF0000")))
        });
    });

    // Invalid color
    group.bench_function("invalid", |b| {
        b.iter(|| {
            black_box(parse_named_color(black_box("notacolor")))
        });
    });

    group.finish();
}

fn bench_border_style_parsing(c: &mut Criterion) {
    let mut group = c.benchmark_group("border_style_parsing");

    // Fast path: exact lowercase match
    group.bench_function("lowercase_exact", |b| {
        b.iter(|| {
            black_box(parse_border_style(black_box("single")))
        });
    });

    // Slow path: case conversion
    group.bench_function("uppercase_fallback", |b| {
        b.iter(|| {
            black_box(parse_border_style(black_box("SINGLE")))
        });
    });

    // Invalid (returns default)
    group.bench_function("invalid", |b| {
        b.iter(|| {
            black_box(parse_border_style(black_box("invalid")))
        });
    });

    group.finish();
}

fn bench_flex_direction_parsing(c: &mut Criterion) {
    let mut group = c.benchmark_group("flex_direction_parsing");

    group.bench_function("simple", |b| {
        b.iter(|| {
            black_box(parse_flex_direction(black_box("row")))
        });
    });

    group.bench_function("with_dash", |b| {
        b.iter(|| {
            black_box(parse_flex_direction(black_box("row-reverse")))
        });
    });

    group.bench_function("uppercase_fallback", |b| {
        b.iter(|| {
            black_box(parse_flex_direction(black_box("ROW")))
        });
    });

    group.finish();
}

fn bench_justify_content_parsing(c: &mut Criterion) {
    let mut group = c.benchmark_group("justify_content_parsing");

    group.bench_function("simple", |b| {
        b.iter(|| {
            black_box(parse_justify_content(black_box("center")))
        });
    });

    group.bench_function("with_dash", |b| {
        b.iter(|| {
            black_box(parse_justify_content(black_box("space-between")))
        });
    });

    group.bench_function("without_dash", |b| {
        b.iter(|| {
            black_box(parse_justify_content(black_box("spacebetween")))
        });
    });

    group.finish();
}

fn bench_align_items_parsing(c: &mut Criterion) {
    let mut group = c.benchmark_group("align_items_parsing");

    group.bench_function("simple", |b| {
        b.iter(|| {
            black_box(parse_align_items(black_box("center")))
        });
    });

    group.bench_function("with_dash", |b| {
        b.iter(|| {
            black_box(parse_align_items(black_box("flex-start")))
        });
    });

    group.finish();
}

fn bench_hex_digit_conversion(c: &mut Criterion) {
    let mut group = c.benchmark_group("hex_digit_conversion");

    group.bench_function("digit", |b| {
        b.iter(|| {
            black_box(hex_to_u8(black_box(b'5')))
        });
    });

    group.bench_function("lowercase", |b| {
        b.iter(|| {
            black_box(hex_to_u8(black_box(b'a')))
        });
    });

    group.bench_function("uppercase", |b| {
        b.iter(|| {
            black_box(hex_to_u8(black_box(b'A')))
        });
    });

    group.bench_function("invalid", |b| {
        b.iter(|| {
            black_box(hex_to_u8(black_box(b'G')))
        });
    });

    group.finish();
}

criterion_group!(
    benches,
    bench_hex_color_parsing,
    bench_named_color_parsing,
    bench_border_style_parsing,
    bench_flex_direction_parsing,
    bench_justify_content_parsing,
    bench_align_items_parsing,
    bench_hex_digit_conversion,
);
criterion_main!(benches);
