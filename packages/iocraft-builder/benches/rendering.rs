//! Benchmarks for rendering and component tree conversion.
//!
//! These benchmarks measure the performance of node_to_element and related
//! rendering operations, which are the most critical hot paths.

use criterion::{black_box, criterion_group, criterion_main, Criterion};
use iocraft_node::*;

fn create_simple_text_node() -> ComponentNode {
    ComponentNode {
        children: None,
        node_type: "Text".to_string(),
        content: Some("Hello, World!".to_string()),
        border_style: None,
        border_color: None,
        background_color: None,
        color: Some("red".to_string()),
        flex_direction: None,
        justify_content: None,
        align_items: None,
        weight: Some("bold".to_string()),
        align: None,
        wrap: None,
        width_percent: None,
        height_percent: None,
        flex_grow: None,
        flex_shrink: None,
        width: None,
        height: None,
        padding: None,
        padding_top: None,
        padding_right: None,
        padding_bottom: None,
        padding_left: None,
        padding_x: None,
        padding_y: None,
        gap: None,
        row_gap: None,
        column_gap: None,
        margin: None,
        margin_top: None,
        margin_right: None,
        margin_bottom: None,
        margin_left: None,
        margin_x: None,
        margin_y: None,
        underline: Some(true),
        italic: None,
        bold: Some(true),
    }
}

fn create_simple_view_node() -> ComponentNode {
    ComponentNode {
        children: Some(vec![
            create_simple_text_node(),
            create_simple_text_node(),
            create_simple_text_node(),
        ]),
        node_type: "View".to_string(),
        content: None,
        border_style: Some("single".to_string()),
        border_color: Some("blue".to_string()),
        background_color: None,
        color: None,
        flex_direction: Some("column".to_string()),
        justify_content: Some("space-between".to_string()),
        align_items: Some("center".to_string()),
        weight: None,
        align: None,
        wrap: None,
        width_percent: None,
        height_percent: None,
        flex_grow: Some(1.0),
        flex_shrink: None,
        width: Some(80),
        height: Some(24),
        padding: Some(2),
        padding_top: None,
        padding_right: None,
        padding_bottom: None,
        padding_left: None,
        padding_x: None,
        padding_y: None,
        gap: Some(1),
        row_gap: None,
        column_gap: None,
        margin: None,
        margin_top: None,
        margin_right: None,
        margin_bottom: None,
        margin_left: None,
        margin_x: None,
        margin_y: None,
        underline: None,
        italic: None,
        bold: None,
    }
}

fn create_nested_view_tree(depth: usize) -> ComponentNode {
    if depth == 0 {
        create_simple_text_node()
    } else {
        ComponentNode {
            children: Some(vec![
                create_nested_view_tree(depth - 1),
                create_nested_view_tree(depth - 1),
            ]),
            node_type: "View".to_string(),
            content: None,
            border_style: Some("single".to_string()),
            border_color: Some("#00FF00".to_string()),
            background_color: None,
            color: None,
            flex_direction: Some("row".to_string()),
            justify_content: None,
            align_items: None,
            weight: None,
            align: None,
            wrap: None,
            width_percent: None,
            height_percent: None,
            flex_grow: None,
            flex_shrink: None,
            width: None,
            height: None,
            padding: Some(1),
            padding_top: None,
            padding_right: None,
            padding_bottom: None,
            padding_left: None,
            padding_x: None,
            padding_y: None,
            gap: None,
            row_gap: None,
            column_gap: None,
            margin: None,
            margin_top: None,
            margin_right: None,
            margin_bottom: None,
            margin_left: None,
            margin_x: None,
            margin_y: None,
            underline: None,
            italic: None,
            bold: None,
        }
    }
}

fn bench_text_node_conversion(c: &mut Criterion) {
    let node = create_simple_text_node();
    c.bench_function("text_node_conversion", |b| {
        b.iter(|| {
            black_box(node_to_element(black_box(&node)))
        });
    });
}

fn bench_view_node_conversion(c: &mut Criterion) {
    let node = create_simple_view_node();
    c.bench_function("view_node_conversion", |b| {
        b.iter(|| {
            black_box(node_to_element(black_box(&node)))
        });
    });
}

fn bench_nested_tree_conversion(c: &mut Criterion) {
    let mut group = c.benchmark_group("nested_tree_conversion");

    for depth in [1, 2, 3, 4].iter() {
        group.bench_with_input(
            format!("depth_{}", depth),
            &create_nested_view_tree(*depth),  // Create once, not per iteration
            |b, node| {
                b.iter(|| {
                    black_box(node_to_element(black_box(node)))
                });
            },
        );
    }

    group.finish();
}

fn bench_hex_color_in_tree(c: &mut Criterion) {
    let mut node = create_simple_view_node();
    node.border_color = Some("#ABCDEF".to_string());
    node.background_color = Some("#123456".to_string());

    c.bench_function("hex_color_in_tree", |b| {
        b.iter(|| {
            black_box(node_to_element(black_box(&node)))
        });
    });
}

criterion_group!(
    benches,
    bench_text_node_conversion,
    bench_view_node_conversion,
    bench_nested_tree_conversion,
    bench_hex_color_in_tree,
);
criterion_main!(benches);
